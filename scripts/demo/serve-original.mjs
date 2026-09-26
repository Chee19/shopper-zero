import http from 'node:http';
import { readFile } from 'node:fs/promises';
const file = new URL('../../demos/prototypes/original/index.html', import.meta.url);
http.createServer(async (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(await readFile(file));
}).listen(4173, '127.0.0.1', () => console.log('Original prototype → http://127.0.0.1:4173'));
