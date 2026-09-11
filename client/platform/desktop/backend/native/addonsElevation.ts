import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { observeChild } from './processManager';

/** Windows CommandLineToArgvW quoting, before embedding the entire command in PowerShell. */
export function windowsArgument(value: string): string {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

/** Elevate only the installer. DIVE remains unelevated and reads its output from a temporary log. */
export async function runElevatedInstaller(python: string, args: string[], cwd: string, append: (data: Buffer) => void): Promise<number | null> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dive-addon-elevation-'));
  const log = path.join(directory, 'output.log');
  const request = path.join(directory, 'request.json');
  const wrapper = path.join(directory, 'install.py');
  try {
    await fs.writeJSON(request, { args: args.slice(1), log, cwd });
    // Arguments are data in JSON, never executable Python or PowerShell text.
    await fs.writeFile(wrapper, [
      'import json, os, runpy, sys',
      "r = json.load(open(sys.argv[1], encoding='utf-8'))",
      "with open(r['log'], 'w', encoding='utf-8', buffering=1) as output:",
      '    sys.stdout = sys.stderr = output',
      "    os.environ['VIAME_ADDON_PROGRESS'] = '1'",
      "    os.chdir(r['cwd'])",
      "    sys.argv = r['args']",
      '    try:',
      "        runpy.run_path(sys.argv[0], run_name='__main__')",
      '    except SystemExit:',
      '        raise',
      '    except BaseException:',
      '        import traceback',
      '        traceback.print_exc()',
      '        sys.exit(1)',
      '',
    ].join('\n'));
    const payload = Buffer.from(JSON.stringify({ python, arguments: ['-u', wrapper, request].map(windowsArgument).join(' '), cwd })).toString('base64');
    const script = `$ErrorActionPreference = 'Stop'
$r = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
try {
  $p = Start-Process -FilePath $r.python -ArgumentList $r.arguments -WorkingDirectory $r.cwd -Verb RunAs -WindowStyle Hidden -Wait -PassThru
  exit $p.ExitCode
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223) { exit 1223 }
  exit 1
}`;
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return await new Promise<number | null>((resolve, reject) => {
      let offset = 0;
      let pending = Promise.resolve();
      const readOutput = () => {
        pending = pending.then(async () => {
          if (!(await fs.pathExists(log))) return;
          const file = await fs.open(log, 'r');
          try {
            const buffer = Buffer.alloc(65536);
            let count: number;
            do {
              // Drain sequential chunks in file order, including the final output after exit.
              // eslint-disable-next-line no-await-in-loop
              const read = await fs.read(file, buffer, 0, buffer.length, offset);
              count = read.bytesRead;
              if (count) { append(Buffer.from(buffer.subarray(0, count))); offset += count; }
            } while (count === buffer.length);
          } finally { await fs.close(file); }
        });
        return pending;
      };
      const child = observeChild(spawn(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { shell: false, windowsHide: true }));
      const timer = setInterval(() => { readOutput().catch(() => { /* Final drain reports read errors. */ }); }, 250);
      child.stderr?.on('data', append);
      child.on('error', (error) => { clearInterval(timer); reject(error); });
      child.on('close', (code) => {
        clearInterval(timer);
        readOutput().then(() => resolve(code), reject);
      });
    });
  } finally { await fs.remove(directory); }
}
