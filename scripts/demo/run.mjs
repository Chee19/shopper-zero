import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const ports = [4001, 4002, 4174];
for (const port of ports) {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the earlier demo before starting this one.`))).listen(port, '127.0.0.1', resolve));
  await new Promise(resolve => probe.close(resolve));
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
function launch(args, env) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
  child.once('error', error => { console.error(error.message); stop(1); });
  child.once('exit', code => { if (!stopping) stop(code ?? 1); });
  children.push(child);
}
for (const [mode, port] of [['before', 4001], ['after', 4002]]) {
  launch(['demos/provence/server.mjs'], { STORE_MODE: mode, PORT: String(port) });
}
// Wait for the catalogue before Next renders its first page.
let ready = false;
for (let attempt = 0; attempt < 50; attempt++) {
  try { ready = (await fetch('http://127.0.0.1:4002/products.json')).ok; } catch { /* booting */ }
  if (ready || stopping) break;
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!ready) { stop(1); throw new Error('Lumière did not start.'); }
launch(['node_modules/next/dist/bin/next', process.argv.includes('--production') ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', '4174'], {
  SHOPPERZERO_MOCK_ENABLED: '1', CHECKOUT_DEMO_STORE: 'provence', PROVENCE_STORE_URL: 'http://127.0.0.1:4002', MOCK_CHECKOUT_APP_URL: 'http://127.0.0.1:4174',
});
console.log('Checkout → http://127.0.0.1:4174/demo/checkout');
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
