import type { AddressInfo } from 'net';
import http from 'http';

import cors from 'cors';
import mime from 'mime-types';
import pump from 'pump';
import express from 'express';
import bodyparser from 'body-parser';
import rangeParser from 'range-parser';
import fs from 'fs-extra';
import { SaveAttributeArgs, SaveAttributeTrackFilterArgs, SaveDetectionsArgs } from 'dive-common/apispec';

import settings from './state/settings';
import * as common from './native/common';
import * as geotiffTiles from './tiles/geotiffTiles';

const app = express();
app.use(express.json({ limit: '250MB' }));
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
apirouter.get('/dataset/:id/:camera?/meta', async (req, res, next) => {
  try {
    let { id } = req.params;
    if (req.params.camera) {
      id = `${req.params.id}/${req.params.camera}`;
    }
    const ds = await common.loadMetadata(settings.get(), id, makeMediaUrl);
    res.json(ds);
  } catch (err) {
    err.status = 500;
    next(err);
  }
});

/* SAVE metadata */
apirouter.post('/dataset/:id/:camera?/meta', async (req, res, next) => {
  try {
    let { id } = req.params;
    if (req.params.camera) {
      id = `${req.params.id}/${req.params.camera}`;
    }
    await common.saveMetadata(settings.get(), id, req.body);
    res.status(200).send('done');
  } catch (err) {
    err.status = 500;
    next(err);
  }
});

/* SAVE attributes */
apirouter.post('/dataset/:id/:camera?/attributes', async (req, res, next) => {
  try {
    let { id } = req.params;
    if (req.params.camera) {
      id = `${req.params.id}/${req.params.camera}`;
    }
    const args = req.body as SaveAttributeArgs;
    await common.saveAttributes(settings.get(), id, args);
    res.status(200).send('done');
  } catch (err) {
    err.status = 500;
    next(err);
  }
  return null;
});

apirouter.post('/dataset/:id/:camera?/attribute_track_filters', async (req, res, next) => {
  try {
    let { id } = req.params;
    if (req.params.camera) {
      id = `${req.params.id}/${req.params.camera}`;
    }
    const args = req.body as SaveAttributeTrackFilterArgs;
    await common.saveAttributeTrackFilters(settings.get(), id, args);
    res.status(200).send('done');
  } catch (err) {
    err.status = 500;
    next(err);
  }
  return null;
});

/* SAVE detections */
apirouter.post('/dataset/:id/:camera?/detections', async (req, res, next) => {
  try {
    let { id } = req.params;
    if (req.params.camera) {
      id = `${req.params.id}/${req.params.camera}`;
    }
    const args = req.body as SaveDetectionsArgs;
    await common.saveDetections(settings.get(), id, args);
    res.status(200).send('done');
  } catch (err) {
    err.status = 500;
    next(err);
  }
  return null;
});

/* Large image (GeoTIFF) tiles - compatible with LargeImageAnnotator getTiles/getTileURL */
apirouter.get('/dataset/:id/:camera?/tiles/:level/:x/:y', async (req, res, next) => {
  try {
    const datasetId = req.params.camera
      ? `${req.params.id}/${req.params.camera}`
      : req.params.id;
    const level = parseInt(req.params.level, 10);
    const x = parseInt(req.params.x, 10);
    const y = parseInt(req.params.y, 10);
    console.log(`[tiles] GET tile request: datasetId=${datasetId} level=${level} x=${x} y=${y}`);
    if (Number.isNaN(level) || Number.isNaN(x) || Number.isNaN(y)) {
      return next({ status: 400, statusMessage: 'Invalid level, x, or y' });
    }
    const png = await geotiffTiles.getTilePng(settings.get(), datasetId, level, x, y);
    if (!png) {
      console.warn(`[tiles] GET tile 404: datasetId=${datasetId} level=${level} x=${x} y=${y} (see tile layer logs for reason)`);
      return next({ status: 404, statusMessage: 'Tile not found or dataset is not a large image' });
    }
    console.log(`[tiles] GET tile 200: datasetId=${datasetId} level=${level} x=${x} y=${y} size=${png.length}`);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    console.error('[tiles] GET tile error:', err);
    (err as { status?: number }).status = 500;
    next(err);
  }
  return null;
});

apirouter.get('/dataset/:id/:camera?/tiles', async (req, res, next) => {
  try {
    const datasetId = req.params.camera
      ? `${req.params.id}/${req.params.camera}`
      : req.params.id;
    console.log(`[tiles] GET tiles metadata request: datasetId=${datasetId}`);
    const meta = await geotiffTiles.getTilesMetadata(settings.get(), datasetId);
    if (!meta) {
      console.warn(`[tiles] GET tiles metadata 404: datasetId=${datasetId} (see tile layer logs for reason)`);
      return next({ status: 404, statusMessage: 'Dataset not found or is not a large image' });
    }
    console.log(`[tiles] GET tiles metadata 200: datasetId=${datasetId} sizeX=${meta.sizeX} sizeY=${meta.sizeY} levels=${meta.levels}`);
    res.json(meta);
  } catch (err) {
    console.error('[tiles] GET tiles metadata error:', err);
    (err as { status?: number }).status = 500;
    next(err);
  }
  return null;
});

/* List valid tile z/x/y values for a dataset (for debugging / tooling) */
apirouter.get('/dataset/:id/:camera?/tiles/list', async (req, res, next) => {
  try {
    const datasetId = req.params.camera
      ? `${req.params.id}/${req.params.camera}`
      : req.params.id;
    const limit = Math.min(
      Math.max(0, parseInt(String(req.query.limit), 10) || 10000),
      50000,
    );
    const meta = await geotiffTiles.getTilesMetadata(settings.get(), datasetId);
    if (!meta) {
      return next({ status: 404, statusMessage: 'Dataset not found or is not a large image' });
    }
    const tiles = geotiffTiles.getValidTileList(
      meta.sizeX,
      meta.sizeY,
      meta.levels,
      limit,
    );
    res.json({
      tiles,
      total: tiles.length,
      limit,
      tileRanges: meta.tileRanges,
    });
  } catch (err) {
    console.error('[tiles] GET tiles list error:', err);
    (err as { status?: number }).status = 500;
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: express.NextFunction,
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
