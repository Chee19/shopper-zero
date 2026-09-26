import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const suite = process.argv[2] || 'unit';
if (!['unit', 'integration', 'browser'].includes(suite)) throw new Error('Unknown test suite');
const base = `tests/${suite}`;
const files = (await readdir(base, { recursive: true })).filter(p => p.endsWith('.test.ts')).sort().map(p => `${base}/${p}`);
if (!files.length) throw new Error(`No tests found in ${base}`);
const child = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--test', ...files], { stdio: 'inherit', env: process.env });
child.on('exit', code => { process.exitCode = code ?? 1; });
