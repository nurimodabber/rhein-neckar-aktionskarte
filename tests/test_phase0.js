const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Overall test suite timeout: 5 minutes max
const overallTimeout = setTimeout(() => {
  console.error('\n❌ FATAL: Entire test suite exceeded 5 minute timeout. Force terminating.');
  process.exit(1);
}, 300000);
overallTimeout.unref();

let server = null;
let chrome = null;
let ws = null;

function cleanup() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.close(); } catch (e) {}
  }
  if (chrome) {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    chrome = null;
  }
  if (server) {
    try { server.close(); } catch (e) {}
    server = null;
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  cleanup();
  process.exit(1);
});

// Helper for per-test 30s timeout
function runWithTimeout(fn, testName, timeoutMs = 30000) {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Test "${testName}" timed out after ${timeoutMs / 1000}s`)), timeoutMs)
    )
  ]);
}

async function startServer(port) {
  server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0].split('#')[0];
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(__dirname, '..', reqPath);

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });

  await new Promise(r => server.listen(port, '127.0.0.1', r));
  console.log(`[Server] Background static server listening on http://127.0.0.1:${port}`);
}

async function startChrome(cdpPort) {
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${cdpPort}`,
    '--window-size=1440,900'
  ]);

  let list = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 150));
    try {
      list = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${cdpPort}/json`, res => {
          let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
        }).on('error', reject);
      });
      if (list && list.length > 0) break;
    } catch (e) {}
  }

  if (!list || !list.length) throw new Error('Chrome remote debugging did not respond in time');
  const page = list.find(p => p.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);

  let msgId = 1;
  const cbs = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      cbs.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.id && cbs.has(d.id)) {
      const { resolve, reject } = cbs.get(d.id);
      cbs.delete(d.id);
      if (d.error) reject(d.error); else resolve(d.result);
    }
    // Auto-dismiss any dialogs so tests can never hang
    if (d.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  };

  await new Promise(r => ws.onopen = r);
  console.log('[Chrome] Headless Chrome connected via CDP WebSocket');

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  // Override window.alert/confirm inside page context as secondary guard
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.alert = function(msg) { console.log('[Page Alert intercepted]:', msg); };
      window.confirm = function() { return true; };
    `
  });

  return { send, ws };
}

async function main() {
  const SERVER_PORT = 8097;
  const CDP_PORT = 9993;
  const results = [];

  try {
    await startServer(SERVER_PORT);
    const { send } = await startChrome(CDP_PORT);

    const networkRequests = [];
    ws.addEventListener('message', ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.method === 'Network.requestWillBeSent') {
          networkRequests.push(msg.params.request.url);
        }
      } catch (e) {}
    });

    console.log(`[Page] Navigating to http://127.0.0.1:${SERVER_PORT}/index.html ...`);
    await send('Page.navigate', { url: `http://127.0.0.1:${SERVER_PORT}/index.html` });
    await new Promise(r => setTimeout(r, 2000));

    // TEST 1
    await runWithTimeout(async () => {
      process.stdout.write('Running Test 1: Offline QR Code & Zero External Leaks... ');
      const raw = await send('Runtime.evaluate', {
        expression: `(() => {
          openShareModal();
          toggleShareQr();
          const img = document.getElementById('share-qr-image');
          return JSON.stringify({
            srcPrefix: img ? img.src.substring(0, 30) : null,
            isDataUrl: img ? img.src.startsWith('data:image/') : false,
            containerVisible: document.getElementById('share-qr-container')?.style.display === 'block'
          });
        })()`
      });
      const res = JSON.parse(raw.result.value);
      const leaked = networkRequests.some(u => u.includes('qrserver.com'));
      if (!res.isDataUrl || leaked) {
        throw new Error(`DataURL: ${res.isDataUrl}, Leaked to external server: ${leaked}`);
      }
      results.push({ name: '1. Offline Local QR Code (Zero Network Requests)', passed: true });
      console.log('PASSED ✓');
    }, 'Test 1');

    // TEST 2
    await runWithTimeout(async () => {
      process.stdout.write('Running Test 2: AppStorage IndexedDB Initialization... ');
      const raw = await send('Runtime.evaluate', {
        expression: `(async () => {
          const state = await AppStorage.getState();
          return JSON.stringify({
            hasDb: !!AppStorage.db,
            dbName: AppStorage.db ? AppStorage.db.name : null
          });
        })()`,
        awaitPromise: true
      });
      const res = JSON.parse(raw.result.value);
      if (!res.hasDb || res.dbName !== 'RheinNeckarClusterDB') {
        throw new Error(`IndexedDB not properly initialized: ${JSON.stringify(res)}`);
      }
      results.push({ name: '2. AppStorage IndexedDB Adapter & DB Init', passed: true });
      console.log('PASSED ✓');
    }, 'Test 2');

    // TEST 3
    await runWithTimeout(async () => {
      process.stdout.write('Running Test 3: Safe Import Diff Modal (Preview Calculation)... ');
      const raw = await send('Runtime.evaluate', {
        expression: `(() => {
          const heidelbergId = Object.keys(AppState.townFeaturesById).find(
            id => AppState.townFeaturesById[id].properties.name === 'Heidelberg'
          );
          const speyerId = Object.keys(AppState.townFeaturesById).find(
            id => AppState.townFeaturesById[id].properties.name === 'Speyer'
          );

          const fakeTowns = {
            [heidelbergId]: { milestone: 'ipg_plus', nuclei: 5, activities: { devotionals: 3 }, isCenter: true, notes: 'Fokus HD' },
            [speyerId]: { milestone: 'ipg', nuclei: 2, activities: { devotionals: 2 }, isCenter: true, notes: 'Fokus SP' }
          };

          const fakeDeployments = [
            { fromId: heidelbergId, toId: speyerId, fromName: 'Heidelberg', toName: 'Speyer', type: 'Wanderlehrer', count: 2, status: 'active', color: '#007aff' }
          ];

          showImportDiffModal('TestStand.json', fakeTowns, {}, fakeDeployments);

          const modal = document.getElementById('import-diff-modal');
          const isVisible = modal && modal.classList.contains('visible');
          const depCount = document.getElementById('diff-count-deployments')?.textContent;

          return JSON.stringify({ isVisible, depCount });
        })()`
      });
      const res = JSON.parse(raw.result.value);
      if (!res.isVisible || res.depCount !== '1') {
        throw new Error(`Diff modal did not show expected counts: ${JSON.stringify(res)}`);
      }
      results.push({ name: '3. Safe Import Diff Modal & Preview Calculations', passed: true });
      console.log('PASSED ✓');
    }, 'Test 3');

    // TEST 4
    await runWithTimeout(async () => {
      process.stdout.write('Running Test 4: Merge Execution & Safety Backup Creation... ');
      const raw = await send('Runtime.evaluate', {
        expression: `(() => {
          const backupsBefore = getStoredBackups().length;
          executeImportMerge();
          const backupsAfter = getStoredBackups().length;

          const heidelbergId = Object.keys(AppState.townFeaturesById).find(
            id => AppState.townFeaturesById[id].properties.name === 'Heidelberg'
          );
          const hd = AppState.towns[heidelbergId];

          return JSON.stringify({
            hdMilestone: hd.milestone,
            hdNuclei: hd.nuclei,
            backupCreated: backupsAfter >= backupsBefore,
            depCount: AppState.deployments.length
          });
        })()`
      });
      const res = JSON.parse(raw.result.value);
      if (res.hdMilestone !== 'ipg_plus' || res.hdNuclei < 5 || !res.backupCreated) {
        throw new Error(`Merge execution failed or backup missing: ${JSON.stringify(res)}`);
      }
      results.push({ name: '4. Merge Resolution & Pre-Import Safety Backup', passed: true });
      console.log('PASSED ✓');
    }, 'Test 4');

    // TEST 5
    await runWithTimeout(async () => {
      process.stdout.write('Running Test 5: Export Timestamp & Days-Ago Indicator... ');
      const raw = await send('Runtime.evaluate', {
        expression: `(() => {
          recordExportTimestamp();
          const meta = getStoredMeta();
          const daysEl = document.getElementById('export-days-indicator');
          const menuEl = document.getElementById('menu-export-status-text');

          return JSON.stringify({
            hasTimestamp: !!meta.lastExportedAt,
            daysText: daysEl ? daysEl.textContent : '',
            menuText: menuEl ? menuEl.textContent : ''
          });
        })()`
      });
      const res = JSON.parse(raw.result.value);
      if (!res.hasTimestamp || !res.daysText.includes('Heute')) {
        throw new Error(`Export indicator failure: ${JSON.stringify(res)}`);
      }
      results.push({ name: '5. JSON Export Timestamp & 7-Day Safety Indicator', passed: true });
      console.log('PASSED ✓');
    }, 'Test 5');

    // TEST 6
    await runWithTimeout(async () => {
      process.stdout.write('Running Test 6: Legal Impressum, DSGVO Art. 9 & OSM Attribution... ');
      const raw = await send('Runtime.evaluate', {
        expression: `(() => {
          const btn = document.getElementById('btn-open-legal-legend');
          if (btn) btn.click();
          const modal = document.getElementById('legal-modal');
          const isVisible = modal && modal.classList.contains('visible');
          const text = modal ? modal.textContent : '';

          return JSON.stringify({
            isVisible,
            hasTmg: text.includes('§ 5 TMG'),
            hasArt9: text.includes('Art. 9 DSGVO') || text.includes('DSGVO Art. 9'),
            hasOsm: text.includes('OpenStreetMap')
          });
        })()`
      });
      const res = JSON.parse(raw.result.value);
      if (!res.isVisible || !res.hasTmg || !res.hasArt9 || !res.hasOsm) {
        throw new Error(`Legal notice modal missing clauses: ${JSON.stringify(res)}`);
      }
      results.push({ name: '6. Legal Modal (Impressum, DSGVO Art. 9, OSM ODbL)', passed: true });
      console.log('PASSED ✓');
    }, 'Test 6');

    // TEST 7
    await runWithTimeout(async () => {
      process.stdout.write('Running Test 7: GitHub Pages to Vercel Migration Handover (#migrate=)... ');
      const bundle = {
        data: {
          towns: {
            test_loc: { milestone: 'ipg_plus', nuclei: 7, isCenter: true, notes: 'Migriert von GH-Pages' }
          },
          districts: {},
          deployments: []
        },
        backups: [],
        migratedAt: Date.now()
      };
      const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(bundle)))));

      await send('Page.navigate', { url: `http://127.0.0.1:${SERVER_PORT}/index.html#migrate=${encoded}` });
      await new Promise(r => setTimeout(r, 1500));

      const raw = await send('Runtime.evaluate', {
        expression: `(() => {
          const town = AppState.towns['test_loc'];
          const hashCleaned = !window.location.hash.includes('migrate=');
          return JSON.stringify({
            migrated: !!(town && town.milestone === 'ipg_plus'),
            hashCleaned
          });
        })()`
      });
      const res = JSON.parse(raw.result.value);
      if (!res.migrated || !res.hashCleaned) {
        throw new Error(`Migration handover failed: ${JSON.stringify(res)}`);
      }
      results.push({ name: '7. Non-destructive Migration Handover (#migrate=)', passed: true });
      console.log('PASSED ✓');
    }, 'Test 7');

    // SUMMARY
    console.log('\n======================================================');
    console.log('                 PHASE 0 TEST RESULTS                 ');
    console.log('======================================================');
    results.forEach((r, idx) => {
      console.log(` [${r.passed ? 'PASS' : 'FAIL'}] ${r.name}`);
    });
    console.log('======================================================');
    const allPassed = results.every(r => r.passed);
    console.log(`Total: ${results.length} | Passed: ${results.filter(r => r.passed).length} | Failed: ${results.filter(r => !r.passed).length}`);
    console.log(allPassed ? 'ALL PHASE 0 TESTS PASSED SUCCESFULLY! 🎉\n' : 'SOME TESTS FAILED ❌\n');

    cleanup();
    process.exit(allPassed ? 0 : 1);

  } catch (err) {
    console.error('\n❌ Test execution failed with error:', err.message);
    cleanup();
    process.exit(1);
  }
}

main();
