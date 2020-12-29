import mime from 'mime-types';
import { AddressInfo } from 'net';
import pump from 'pump';
import express from 'express';
import rangeParser from 'range-parser';
import http from 'http';
import fs from 'fs-extra';

import settings from './state/settings';
import common from './native/common';

const app = express();
const apirouter = express.Router();
let server: http.Server;

// Only support certain MIME types.
const supportedMediaTypes = [
  // https://en.wikipedia.org/wiki/HTML5_video
  'video/mp4',
  'video/webm',
  'video/ogg',
  // https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types
  'image/apng',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
];

function makeMediaUrl(filepath: string): string {
  const addr = server.address() as AddressInfo | null;
  if (!addr) {
    throw new Error('server has not initialized yet');
  }
  return `http://localhost:${addr.port}/api/media?path=${filepath}`;
}


function fail(res: express.Response, code: number, message: string) {
  return res.status(code).json({ message }).end();
}

apirouter.get('', (_, res) => {
  res.send('Electron REST backend.');
});

apirouter.get('dataset/:id', async (req, res) => {
  try {
    const ds = await common.loadDataset(settings.get(), req.params.id, makeMediaUrl);
    res.json(ds);
  } catch (err) {
    fail(res, 500, err);
  }
});

apirouter.get('media', (req, res) => {
  const { path } = req.params;
  if (!path) {
    return fail(res, 400, `Invalid path: ${path}`);
  }

  const filestat = fs.statSync(path);
  if (!filestat.isFile()) {
    return fail(res, 404, `Invalid file for path: ${path}`);
  }

  const mimetype = mime.lookup(path);
  if (mimetype === false) {
    return fail(res, 400, `Mime lookup failed for path: ${path}`);
  }
  if (!supportedMediaTypes.includes(mimetype)) {
    return fail(res, 400, 'Cannot request this mime type');
  }

  const ranges = req.headers.range && rangeParser(filestat.size, req.headers.range);
  if (ranges === -1 || ranges === -2) {
    return fail(res, 400, `Range parse failed: ${req.headers.range}`);
  }

  if (ranges === undefined || ranges === '') {
    res.setHeader('Content-Length', filestat.size);
    if (req.method === 'HEAD') {
      return res.end();
    }
    pump(fs.createReadStream(path), res);
    return null;
  }

  const range = ranges[0];
  // eslint-disable-next-line no-param-reassign
  res.status(206);
  res.setHeader('Content-Length', range.end - range.start + 1);
  res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${filestat.size}`);
  if (req.method === 'HEAD') {
    return res.end();
  }
  pump(fs.createReadStream(path, range), res);
  return null;
});

app.use('/api', apirouter);

/* Singleton listen function, will only create a server once */
function listen(cb: (server: http.Server) => void) {
  if (!server) {
    // Security by obscurity: mitigate discovery by spyware
    server = app.listen(0, '127.0.0.23', () => cb(server));
  } else {
    cb(server);
  }
}

function close() {
  if (server) {
    server.close();
  }
}

export { listen, close };
