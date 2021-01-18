import fs from 'fs-extra';
import { DesktopJob, DesktopJobUpdate } from 'platform/desktop/constants';

/**
 * Get a nice safe string
 */
function cleanString(dirty: string) {
  return dirty.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
function makeid(length: number): string {
  let result = '';
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i += 1) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

const processChunk = (chunk: Buffer) => chunk
  .toString('utf-8')
  .split('\n')
  .filter((a) => a);

/**
 * Middleware to echo to stdout and write to file
 */
function jobFileEchoMiddleware(
  jobBase: DesktopJob,
  updater: (msg: DesktopJobUpdate) => void,
  logfile: string,
) {
  return (chunk: Buffer) => {
    process.stdout.write(chunk.toString('utf-8'));
    // No way in windows to display and log stdout at same time without 3rd party tools
    fs.appendFile(logfile, chunk.toString('utf-8'), (err) => {
      if (err) throw err;
    });
    updater({
      ...jobBase,
      body: processChunk(chunk),
    });
  };
}

export {
  cleanString,
  makeid,
  jobFileEchoMiddleware,
};
