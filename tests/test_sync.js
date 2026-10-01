const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const syncHandler = require('../api/sync.js');

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

async function startServer(port) {
  server = http.createServer(async (req, res) => {
    let reqUrl = new URL(req.url, `http://localhost:${port}`);
    let reqPath = reqUrl.pathname;

    // Handle /api/sync
    if (reqPath === '/api/sync') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        let parsedBody = null;
        try { parsedBody = bodyStr ? JSON.parse(bodyStr) : null; } catch (e) {}

        const queryObj = Object.fromEntries(reqUrl.searchParams);
        const mockReq = {
          method: req.method,
          query: queryObj,
          headers: req.headers,
          body: parsedBody
        };
        const mockRes = {
          setHeader: (k, v) => res.setHeader(k, v),
          status: (code) => {
            res.statusCode = code;
            return {
              json: (data) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
              },
              end: () => res.end()
            };
          }
        };

        try {
          await syncHandler(mockReq, mockRes);
        } catch (err) {
          console.error("API Error:", err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

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
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[Test Server] Listening on http://127.0.0.1:${port}`);
      resolve();
    });
  });
}

async function startChrome(cdpPort) {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const tmpProfile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'chrome-test-sync-'));

  chrome = spawn(chromePath, [
    '--headless=new',
    `--user-data-dir=${tmpProfile}`,
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

  if (!list || !list.length) throw new Error('Chrome did not start');
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
    if (d.method === 'Runtime.consoleAPICalled') {
      console.log('[Page Console]', d.params.type, ...d.params.args.map(a => a.value || a.description || ''));
    }
    if (d.id && cbs.has(d.id)) {
      const { resolve, reject } = cbs.get(d.id);
      cbs.delete(d.id);
      if (d.error) reject(d.error); else resolve(d.result);
    }
  };

  await new Promise(r => ws.onopen = r);
  await send('Page.enable');
  await send('Runtime.enable');

  return { send };
}

async function run() {
  const SERVER_PORT = 8098;
  const CDP_PORT = 9994;

  try {
    await startServer(SERVER_PORT);
    const { send } = await startChrome(CDP_PORT);

    console.log(`[Page] Navigating to http://127.0.0.1:${SERVER_PORT}/index.html ...`);
    await send('Page.navigate', { url: `http://127.0.0.1:${SERVER_PORT}/index.html` });
    await new Promise(r => setTimeout(r, 2000));

    console.log("Test 1: Verify capsule is initially hidden in local mode...");
    const initCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const capsule = document.getElementById('live-sync-capsule');
        return JSON.stringify({
          capsuleVisible: capsule && capsule.style.display !== 'none',
          roomId: SyncEngine.roomId
        });
      })()`
    });
    const c1 = JSON.parse(initCheck.result.value);
    console.log("Initial state:", c1);
    if (c1.capsuleVisible || c1.roomId !== null) throw new Error("Should start in local mode");

    console.log("Test 2: Create a collaborative room...");
    const testRoomId = 'test-room-' + Date.now();
    await send('Runtime.evaluate', {
      expression: `SyncEngine.joinRoom('${testRoomId}', true);`
    });
    await new Promise(r => setTimeout(r, 2000));

    const roomCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const capsule = document.getElementById('live-sync-capsule');
        const label = document.getElementById('sync-room-label');
        const hash = window.location.hash;
        return JSON.stringify({
          capsuleDisplay: capsule ? capsule.style.display : null,
          label: label ? label.textContent : null,
          roomId: SyncEngine.roomId,
          hash: hash,
          version: SyncEngine.version
        });
      })()`
    });
    const c2 = JSON.parse(roomCheck.result.value);
    console.log("Room joined state:", c2);
    if (!c2.capsuleDisplay.includes('flex') || c2.roomId !== testRoomId || !c2.hash.includes(testRoomId)) {
      throw new Error("Room was not joined properly");
    }

    console.log("Test 3: Make local change (e.g. paint first town) and verify auto-save push...");
    await send('Runtime.evaluate', {
      expression: `(() => {
        const firstTownId = Object.keys(AppState.towns)[0];
        setTownMilestone(firstTownId, 'ipg', null);
      })()`
    });
    // Wait for debounce push (1.2s + fetch)
    await new Promise(r => setTimeout(r, 2500));

    const pushCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const firstTownId = Object.keys(AppState.towns)[0];
        return JSON.stringify({
          version: SyncEngine.version,
          updatedAt: SyncEngine.updatedAt,
          milestone: AppState.towns[firstTownId]?.milestone
        });
      })()`
    });
    const c3 = JSON.parse(pushCheck.result.value);
    console.log("After auto-save push:", c3);
    if (c3.version < 2 || c3.milestone !== 'ipg') {
      throw new Error("State was not pushed properly");
    }

    console.log("Test 4: Modal UI and Link Copy verification...");
    await send('Runtime.evaluate', {
      expression: `(() => {
        openShareModal('live');
      })()`
    });
    const modalCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const modal = document.getElementById('share-modal');
        const input = document.getElementById('room-link-input');
        const connectedView = document.getElementById('room-connected-view');
        return JSON.stringify({
          modalVisible: modal.classList.contains('visible'),
          linkValue: input ? input.value : null,
          connectedViewVisible: connectedView ? connectedView.style.display === 'block' : false
        });
      })()`
    });
    const c4 = JSON.parse(modalCheck.result.value);
    console.log("Modal state:", c4);
    if (!c4.modalVisible || !c4.connectedViewVisible || !c4.linkValue.includes(testRoomId)) {
      throw new Error("Modal did not render connected room properly");
    }

    console.log("Test 4b: Custom Slug editing in modal...");
    const newCustomSlug = 'custom-slug-heidelberg';
    await send('Runtime.evaluate', {
      expression: `(() => {
        const editInput = document.getElementById('edit-room-slug-input');
        const updateBtn = document.getElementById('btn-update-room-slug');
        editInput.value = '${newCustomSlug}';
        updateBtn.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 2000));

    const slugCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const linkInput = document.getElementById('room-link-input');
        return JSON.stringify({
          roomId: SyncEngine.roomId,
          hash: window.location.hash,
          linkValue: linkInput ? linkInput.value : null
        });
      })()`
    });
    const c4b = JSON.parse(slugCheck.result.value);
    console.log("After custom slug edit:", c4b);
    if (c4b.roomId !== newCustomSlug || !c4b.hash.includes(newCustomSlug) || !c4b.linkValue.includes(newCustomSlug)) {
      throw new Error("Custom slug was not updated properly");
    }

    console.log("Test 5: Leaving room returns to local mode...");
    await send('Runtime.evaluate', {
      expression: `SyncEngine.leaveRoom();`
    });
    const leaveCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const capsule = document.getElementById('live-sync-capsule');
        return JSON.stringify({
          capsuleVisible: capsule && capsule.style.display !== 'none',
          roomId: SyncEngine.roomId,
          hash: window.location.hash
        });
      })()`
    });
    const c5 = JSON.parse(leaveCheck.result.value);
    console.log("After leaving room:", c5);
    if (c5.capsuleVisible || c5.roomId !== null) {
      throw new Error("Should have left room");
    }

    console.log("\n======================================================");
    console.log("  ALL COLLABORATIVE SYNC TESTS PASSED SUCCESSFULLY! ✓");
    console.log("======================================================\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err);
    cleanup();
    process.exit(1);
  }
}

run();
