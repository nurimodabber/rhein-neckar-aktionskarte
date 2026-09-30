const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function capture(options = {}) {
  const {
    prefix = 'screen',
    desktop = true,
    mobile = true,
    url = 'http://127.0.0.1:8099/index.html',
    outputDir = path.join(__dirname, '../screenshots')
  } = options;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Start static server
  const server = http.createServer((req, res) => {
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
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.json': 'application/json'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });

  await new Promise(r => server.listen(8099, '127.0.0.1', r));

  const cdpPort = 9224;
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${cdpPort}`,
    '--user-data-dir=' + fs.mkdtempSync(path.join('/tmp', 'chrome-snap-'))
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

  if (!list) {
    chrome.kill('SIGKILL');
    server.close();
    throw new Error('Chrome failed to start');
  }

  const page = list.find(p => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  };

  await new Promise(r => ws.onopen = r);
  await send('Page.enable');
  await send('Runtime.enable');

  const targets = [];
  if (desktop) targets.push({ name: 'desktop', width: 1280, height: 800, scale: 1 });
  if (mobile) targets.push({ name: 'mobile', width: 390, height: 844, scale: 2 });

  for (const t of targets) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: t.width,
      height: t.height,
      deviceScaleFactor: t.scale,
      mobile: t.name === 'mobile'
    });
    await send('Page.navigate', { url });
    // Wait for load and Leaflet tiles/polygons render
    await new Promise(r => setTimeout(r, 2200));

    const snap = await send('Page.captureScreenshot', { format: 'png' });
    const snapPath = path.join(outputDir, `${prefix}_${t.name}.png`);
    fs.writeFileSync(snapPath, Buffer.from(snap.data, 'base64'));
    console.log(`Saved screenshot: ${snapPath}`);
  }

  ws.close();
  chrome.kill('SIGKILL');
  server.close();
}

const prefix = process.argv[2] || 'baseline';
capture({ prefix }).catch(err => {
  console.error('Screenshot error:', err);
  process.exit(1);
});
