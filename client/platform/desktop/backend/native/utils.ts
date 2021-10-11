import { spawn } from 'child_process';
import fs from 'fs-extra';
import { observeChild } from 'platform/desktop/backend/native/processManager';
import { DesktopJob, DesktopJobUpdater } from 'platform/desktop/constants';

const processChunk = (chunk: Buffer) => chunk
  .toString('utf-8')
  .split('\n')
  .filter((a) => a);

/**
 * Middleware to echo to stdout and write to file
 */
function jobFileEchoMiddleware(
  jobBase: DesktopJob,
  updater: DesktopJobUpdater,
  logfile?: string,
) {
  return (chunk: Buffer) => {
    process.stdout.write(chunk.toString('utf-8'));
    // No way in windows to display and log stdout at same time without 3rd party tools
    if (logfile) {
      fs.appendFile(logfile, chunk.toString('utf-8'), (err) => {
        if (err) throw err;
      });
    }
    updater({
      ...jobBase,
      body: processChunk(chunk),
    });
  };
}

function spawnResult(command: string, shell: boolean | string, args: string[] = []):
Promise<{
  output: null | string;
  exitCode: number | null;
  signal: NodeJS.Signals| null;
  error: string;
}> {
  return new Promise((resolve) => {
    const proc = observeChild(spawn(command, args, { shell }));
    let output = '';
    let error = '';
    proc.stdout.on('data', (chunk) => {
      output = output.concat(chunk.toString('utf-8'));
    });

    proc.stderr.on('data', (chunk) => {
      error = error.concat(chunk.toString('utf-8'));
    });

    proc.on('exit', (exitCode, signal) => {
      resolve({
        output,
        exitCode,
        signal,
        error,
      });
    });
    proc.on('error', (err) => {
      resolve({
        output: null,
        exitCode: -1,
        signal: null,
        error: err.message,
      });
    });
  });
}

export {
  jobFileEchoMiddleware,
  spawnResult,
};
