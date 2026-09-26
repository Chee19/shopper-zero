// Starts the "before" (4001) and "after" (4002) stores side by side.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('./server.mjs', import.meta.url));
const children = [['before', 4001], ['after', 4002]].map(([mode, port]) =>
  spawn(process.execPath, [server], { stdio: 'inherit', env: { ...process.env, STORE_MODE: mode, PORT: String(port) } }));

const stop = () => { children.forEach(c => c.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
