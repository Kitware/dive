import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { runElevatedInstaller, windowsArgument } from './addonsElevation';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('./processManager', () => ({ observeChild: (child: unknown) => child }));
afterEach(() => { vi.restoreAllMocks(); });

it('quotes spaces, embedded quotes, and trailing Windows path separators', () => {
  expect(windowsArgument('C:\\Program Files\\VIAME\\')).toBe('"C:\\Program Files\\VIAME\\\\"');
  expect(windowsArgument('a"b')).toBe('"a\\"b"');
  expect(windowsArgument('$(literal) & file.zip')).toBe('"$(literal) & file.zip"');
});

it.each([0, 7, 1223])('propagates elevated exit %s, drains output and removes temporary files', async (code) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dive-elevation-test-'));
  vi.spyOn(fs, 'mkdtemp').mockResolvedValueOnce(directory as never);
  const child = Object.assign(new EventEmitter(), { stderr: new PassThrough() });
  vi.mocked(spawn).mockImplementationOnce((...args) => {
    const script = Buffer.from((args[1] as string[])[3], 'base64').toString('utf16le');
    expect(script).toContain('-Verb RunAs');
    expect(script).toContain('exit $p.ExitCode');
    expect(script).not.toContain('$(literal)');
    setTimeout(async () => {
      await fs.writeFile(path.join(directory, 'output.log'), 'VIAME_ADDON_PROGRESS {"phase":"install","done":100,"total":100}\n');
      child.emit('close', code);
    }, 0);
    return child as never;
  });
  const chunks: string[] = [];
  const result = await runElevatedInstaller('C:\\Program Files\\VIAME\\python.exe', ['-u', 'C:\\VIAME\\add_ons.py', '--from-file', 'C:\\$(literal) file.zip'], 'C:\\VIAME', (chunk) => chunks.push(chunk.toString()));
  expect(result).toBe(code);
  expect(chunks.join('')).toContain('"phase":"install"');
  expect(await fs.pathExists(directory)).toBe(false);
});
