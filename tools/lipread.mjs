// Starts the local lip-reading service (lipread/server.py) on 127.0.0.1:5340.
// Run `npm run lipread:setup` once before the first start.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../lipread/', import.meta.url));
const python =
  process.platform === 'win32' ? `${dir}.venv\\Scripts\\python.exe` : `${dir}.venv/bin/python`;
if (!existsSync(python)) {
  console.error('Lip reading is not set up yet. Run: npm run lipread:setup');
  process.exit(1);
}
console.log('Lip reading: loading the model, this takes a little while…');
const child = spawn(python, ['server.py'], { cwd: dir, stdio: 'inherit', windowsHide: true });
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
