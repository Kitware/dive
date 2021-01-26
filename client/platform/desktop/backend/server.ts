import type { AddressInfo } from 'net';
import http from 'http';

import cors from 'cors';
import mime from 'mime-types';
import pump from 'pump';
import express from 'express';
import bodyparser from 'body-parser';
import rangeParser from 'range-parser';
import fs from 'fs-extra';
import { Attribute, SaveDetectionsArgs } from 'viame-web-common/apispec';

import settings from './state/settings';
import * as common from './native/common';

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

/* LOAD metadata */
apirouter.get('/dataset/:id/meta', async (req, res, next) => {
  try {
    const ds = await common.loadMetadata(settings.get(), req.params.id, makeMediaUrl);
    res.json(ds);
  } catch (err) {
    err.status = 500;
    next(err);
  }
});

/* SAVE metadata */
apirouter.post('/dataset/:id/meta', async (req, res, next) => {
  try {
    await common.saveMetadata(settings.get(), req.params.id, req.body);
    res.status(200).send('done');
  } catch (err) {
    err.status = 500;
    next(err);
  }
});

/* LOAD Attributes */
apirouter.get('/dataset/:id/attribute', async (req, res, next) => {
  try {
    const ds = await common.getAttributes(settings.get(), req.params.id);
    res.json(ds);
  } catch (err) {
    err.status = 500;
    next(err);
  }
});

/* ADD/Update Attribute */
apirouter.post('/dataset/:id/attribute', async (req, res, next) => {
  try {
    const args = req.body as {addNew?: boolean; data: Attribute };
    await common.setAttribute(settings.get(), req.params.id, args);
    res.status(200).send('done');
  } catch (err) {
    err.status = 500;
    next(err);
  }
});

/* Delete Attribute */
apirouter.delete('/dataset/:id/attribute', async (req, res, next) => {
  try {
    const args = { data: req.body } as { data: Attribute };
    await common.deleteAttribute(settings.get(), req.params.id, args);
    res.status(200).send('done');
  } catch (err) {
    err.status = 500;
    next(err);
  }
});

/* SAVE detections */
apirouter.post('/dataset/:id/detections', async (req, res, next) => {
  try {
    const args = req.body as SaveDetectionsArgs;
    await common.saveDetections(settings.get(), req.params.id, args);
    res.status(200).send('done');
  } catch (err) {
    err.status = 500;
    next(err);
  }
  return null;
});

/* STREAM media */
apirouter.get('/media', (req, res, next) => {
  let { path } = req.query;
  if (!path || Array.isArray(path)) {
    return next({
      status: 400,
      statusMessage: `Invalid path: ${path}`,
    });
  }
  path = path.toString();

  let filestat: fs.Stats;
  try {
    filestat = fs.statSync(path);
    if (!filestat.isFile()) {
      return next({
        status: 404,
        statusMessage: `Invalid file for path: ${path}`,
      });
    }
  } catch (err) {
    return next({
      status: 404,
      statusMessage: `No such path ${path}`,
    });
  }

  const mimetype = mime.lookup(path);
  if (mimetype === false) {
    return next({
      status: 400,
      statusMessage: `Mime lookup failed for path: ${path}`,
    });
  }
  if (!supportedMediaTypes.includes(mimetype)) {
    return next({
      status: 400,
      statusMessage: 'Cannot request this mime type',
    });
  }

  const ranges = req.headers.range && rangeParser(filestat.size, req.headers.range);
  if (ranges === -1 || ranges === -2) {
    return next({
      status: 400,
      statusMessage: `Range parse failed: ${req.headers.range}`,
    });
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

if (process.env.NODE_ENV === 'development') {
  /**
   * CORS * is dangerous and should be disabled in production.
   * In prod, the app is loaded from file:/// which is not limited
   * to same-origin policy like pages loaded via http.
   *
   * NOTE: process.env.NODE_ENV doesn't work in production
   * You cannot check the inverse i.e. !== 'production'
  */
  app.use(cors({ origin: '*' }));
}
app.use(bodyparser.json());
app.use('/api', apirouter);

function fail(
  err: { status?: number; statusMessage?: string },
  req: express.Request,
  res: express.Response,
) {
  res.status(err.status || 500).json({ message: err.statusMessage || err });
}

apirouter.get('/', (_, res) => {
  res.send('Electron REST backend.');
});

app.use(fail);

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
