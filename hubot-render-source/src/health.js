import { createServer } from 'node:http';

export async function startHealthServer(port, connected = () => true) {
  const server = createServer((req, res) => {
    const path = req.url?.split('?')[0];
    if (req.method !== 'GET' || !['/', '/healthz'].includes(path)) { res.writeHead(404); res.end('Not found'); return; }
    const ready = connected();
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: ready }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(port), '0.0.0.0', resolve); });
  return server;
}
