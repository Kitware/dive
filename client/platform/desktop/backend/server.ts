import type { AddressInfo } from 'net';
import http from 'http';

import cors from 'cors';
import mime from 'mime-types';
import pump from 'pump';
import express from 'express';
import bodyparser from 'body-parser';
import rangeParser from 'range-parser';
import fs from 'fs-extra';
import { SaveDetectionsArgs } from 'viame-web-common/apispec';

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
  return `http://${addr.address}:${addr.port}/api/media?path=${filepath}`;
}

function fail(res: express.Response, code: number, message: string) {
  return res.status(code).json({ message }).end();
}

apirouter.get('/', (_, res) => {
  res.send('Electron REST backend.');
});

/* LOAD metadata */
apirouter.get('/dataset/:id/meta', async (req, res) => {
  try {
    const ds = await common.loadMetadata(settings.get(), req.params.id, makeMediaUrl);
    res.json(ds);
  } catch (err) {
    fail(res, 500, err);
  }
});

/* SAVE metadata */
apirouter.post('/dataset/:id/meta', async (req, res) => {
  try {
    await common.saveMetadata(settings.get(), req.params.id, req.body);
    res.status(200);
  } catch (err) {
    fail(res, 500, err);
  }
});

/* SAVE detections */
apirouter.post('/dataset/:id/detections', async (req, res) => {
  try {
    const args = req.body as SaveDetectionsArgs;
    await common.saveDetections(settings.get(), req.params.id, args);
    return res.status(200);
  } catch (err) {
    console.error(err);
    return fail(res, 500, err);
    throw err;
  }
});

/* IMPORT dataset */
apirouter.post('/import', async (req, res) => {
  const { path } = req.query;
  if (!path || Array.isArray(path)) {
    return fail(res, 400, `Invalid path: ${path}`);
  }
  try {
    const meta = await common.importMedia(settings.get(), path.toString());
    return res.json(meta);
  } catch (err) {
    return fail(res, 500, err);
  }
});

/* STREAM media */
apirouter.get('/media', (req, res) => {
  let { path } = req.query;
  if (!path || Array.isArray(path)) {
    return fail(res, 400, `Invalid path: ${path}`);
  }
  path = path.toString();

  let filestat: fs.Stats;
  try {
    filestat = fs.statSync(path);
    if (!filestat.isFile()) {
      return fail(res, 404, `Invalid file for path: ${path}`);
    }
  } catch (err) {
    return fail(res, 404, `No such path ${path}`);
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

app.use(cors({ origin: 'http://localhost:8080' }));
app.use(bodyparser.json());
app.use('/api', apirouter);

/* Singleton listen function will only create a server once */
function listen(callback: (server: http.Server) => void) {
  if (!server) {
    server = app.listen(0, 'localhost', () => callback(server));
  } else {
    callback(server);
  }
}

function close() {
  if (server) {
    server.close();
  }
}

export { listen, close };
