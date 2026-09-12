import { spawn } from 'child_process';
import { createServer } from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import addonRunner from './addonRunner';

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dive-runner-test-')); });
afterEach(async () => { await fs.remove(directory); });

async function run(source: string, onOutput?: (text: string) => void) {
  const runner = path.join(directory, 'runner.py');
  const installer = path.join(directory, 'installer.py');
  await fs.writeFile(runner, addonRunner);
  await fs.writeFile(installer, source);
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-u', runner, installer], {
      env: { ...process.env, VIAME_ADDON_CANCEL_FILE: path.join(directory, 'cancel') },
    });
    let output = '';
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Runner failed to stop')); }, 5000);
    child.stdout.on('data', (chunk) => { output += chunk; onOutput?.(chunk.toString()); });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code) => { clearTimeout(timeout); resolve({ code, output }); });
  });
}

it('reports real byte percentages for a legacy non-terminal HTTP download', async () => {
  const server = createServer((_req, response) => {
    response.writeHead(200, { 'Content-Length': 131072 });
    response.write(Buffer.alloc(65536));
    setTimeout(() => response.end(Buffer.alloc(65536)), 300);
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address() as { port: number };
    const result = await run(`import urllib.request\nwith urllib.request.urlopen('http://127.0.0.1:${address.port}') as response:\n    while response.read(4096): pass\n`);
    expect(result.code).toBe(0);
    const events = result.output.trim().split('\n').map((line) => JSON.parse(line.replace('VIAME_ADDON_PROGRESS ', '')));
    expect(events[0]).toMatchObject({ phase: 'download', done: 0, total: 131072 });
    expect(events.some((event) => event.done > 0 && event.done < event.total)).toBe(true);
    expect(events.at(-1)).toMatchObject({ phase: 'download', done: 131072, total: 131072 });
  } finally { server.close(); }
});

it('hard cancels blocked installation code without cooperative installer support', async () => {
  const result = await run("import time\nprint('READY', flush=True)\ntime.sleep(60)\n", (text) => {
    if (text.includes('READY')) fs.writeFileSync(path.join(directory, 'cancel'), 'cancel');
  });
  expect(result.code).toBe(130);
});

it('hard cancels a blocked HTTP read', async () => {
  const server = createServer((_req, response) => {
    response.writeHead(200, { 'Content-Length': 1000000 });
    response.write('partial');
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address() as { port: number };
    const result = await run(`import urllib.request\nwith urllib.request.urlopen('http://127.0.0.1:${address.port}') as response:\n    print('READY', flush=True)\n    response.read()\n`, (text) => {
      if (text.includes('READY')) fs.writeFileSync(path.join(directory, 'cancel'), 'cancel');
    });
    expect(result.code).toBe(130);
  } finally { server.closeAllConnections(); server.close(); }
});

it('does not execute the installer if cancellation preceded startup or UAC approval', async () => {
  await fs.writeFile(path.join(directory, 'cancel'), 'cancel');
  const result = await run("raise RuntimeError('must not run')\n");
  expect(result).toEqual({ code: 130, output: '' });
});
