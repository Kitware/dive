import mime from 'mime-types';
import pump from 'pump';
import rangeParser from 'range-parser';
import http from 'http';
import fs from 'fs';
import parser from 'url';

import router from './router';

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

function fail(res: http.ServerResponse, code: number, message = '') {
  // eslint-disable-next-line no-param-reassign
  res.statusCode = code;
  res.write(message);
  res.end();
}

/* Global error handler middleware. */
const withErrorHandler = (handler: http.RequestListener): http.RequestListener => (req, res) => {
  try {
    return handler(req, res);
  } catch (err) {
    console.error('BAD');
    return fail(res, 500, 'Server error');
  }
};

router.register('/api', withErrorHandler((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write('ELECTRON_BACKEND');
  res.end();
}));

router.register('/api/media', withErrorHandler((req, res) => {
  const { url } = req;
  if (!url) {
    throw new Error('Impossible scenario, req.url was empty');
  }

  const parsedurl = parser.parse(url, true);
  let path = parsedurl.query ? parsedurl.query.path : undefined;

  if (path === undefined || Array.isArray(path)) {
    return fail(res, 404, `Invalid path: ${path}`);
  }

  path = decodeURI(path);
  let filestat;
  try {
    filestat = fs.statSync(path);
    if (!filestat.isFile()) {
      return fail(res, 404, `Invalid file for path: ${path}`);
    }
  } catch (err) {
    return fail(res, 404);
  }

  const type = mime.lookup(path);
  if (type === false) {
    return fail(res, 400, `Mime lookup failed for path: ${path}`);
  }

  if (!supportedMediaTypes.includes(type)) {
    return fail(res, 400, 'Cannot request that mime type');
  }

  const ranges = req.headers.range && rangeParser(filestat.size, req.headers.range);
  if (ranges === -1 || ranges === -2) {
    return fail(res, 400, `Range parse failed: ${req.headers.range}`);
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', type);

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
  res.statusCode = 206;
  res.setHeader('Content-Length', range.end - range.start + 1);
  res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${filestat.size}`);
  if (req.method === 'HEAD') return res.end();
  pump(fs.createReadStream(path, range), res);
  return null;
}));

// We need a server which relies on our router
const server = http.createServer((req, res) => {
  const handler = router.route(req);
  handler.process(req, res);
});

export default server;
