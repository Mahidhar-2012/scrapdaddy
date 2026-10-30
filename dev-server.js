/* Local development server.
 *
 * Serves the static site and runs the /api functions the same way the host
 * will, so you can test the backend before deploying.
 *
 *   node dev-server.js            → http://localhost:3000
 *   PORT=4000 node dev-server.js
 *
 * Reads .env.local or .env if present (simple KEY=VALUE lines, # for comments).
 * Not used in production — the host runs api/ itself.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

for (const file of ['.env.local', '.env']) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) return;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  console.log('loaded ' + file);
  break;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

function loadHandler(routePath) {
  const file = path.join(__dirname, 'api', routePath + '.js');
  if (!fs.existsSync(file)) return null;
  delete require.cache[require.resolve(file)];   // pick up edits without a restart
  const mod = require(file);
  return typeof mod === 'function' ? mod : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  let pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) {
    const route = pathname.slice(5).replace(/\/+$/, '');
    if (route.includes('..')) { res.statusCode = 400; return res.end('bad path'); }
    const handler = loadHandler(route);
    if (!handler) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'No API route at /api/' + route }));
    }
    try { return await handler(req, res); }
    catch (e) {
      console.error('[dev] handler threw:', e);
      if (!res.writableEnded) { res.statusCode = 500; res.end(JSON.stringify({ error: 'handler threw' })); }
      return;
    }
  }

  if (pathname === '/') pathname = '/index.html';
  const file = path.join(__dirname, pathname);
  if (!file.startsWith(__dirname)) { res.statusCode = 403; return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log('ScrapHub dev server → http://localhost:' + port);
  console.log('API health             → http://localhost:' + port + '/api/health');
});
