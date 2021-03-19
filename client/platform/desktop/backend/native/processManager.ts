/**
 * ProcessManager keeps track of the subprocesses opened
 * by varios parts of the application and provides controls
 * to make sure they exit.
 */

import { ChildProcess } from 'child_process';

const children: ChildProcess[] = [];

/**
 * Add child to list of outstanding processes,
 * remove it when the process exits
 */
function observeChild<T extends ChildProcess>(child: T) {
  if (child.exitCode === null) {
    children.push(child);
    child.on('exit', () => {
      children.splice(children.indexOf(child), 1);
    });
  }
  return child;
}

/**
 * close a child, and return a promise
 */
function close(child: ChildProcess): Promise<void> {
  const onclose = new Promise<void>((resolve) => {
    child.on('exit', (code, signal) => {
      console.warn(`pid=${child.pid} exited with code=${code} and signal=${signal}`);
      resolve();
    });
  });

  child.kill('SIGTERM');
  return onclose;
}

/**
 * Stop all remaining child processes
 */
function closeAll() {
  console.warn(`killing ${children.length} remaining child processes`);
  return Promise.all(children.slice().map((child) => close(child)));
}

export {
  observeChild,
  close,
  closeAll,
};
