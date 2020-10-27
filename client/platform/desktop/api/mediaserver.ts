// eslint-disable-next-line import/no-extraneous-dependencies
import mime from 'mime-types';
// eslint-disable-next-line import/no-extraneous-dependencies
import pump from 'pump';
// eslint-disable-next-line import/no-extraneous-dependencies
import rangeParser from 'range-parser';
import http from 'http';
import fs from 'fs';

function fail(res: http.ServerResponse, code: number, message = '') {
  // eslint-disable-next-line no-param-reassign
  res.statusCode = code;
  res.write(message);
  res.end();
}

/* If error are uncaught, they get thrown to a GTK Alert :( */
const withErrorHandler = (handler: http.RequestListener): http.RequestListener => (req, res) => {
  try {
    return handler(req, res);
  } catch (err) {
    console.error('BAD');
    return fail(res, 500, 'Server error');
  }
};

const server = http.createServer(withErrorHandler((req, res) => {
  let path = req.url;
  if (path === undefined) {
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
    return fail(res, 404, `Mime lookup failed for path: ${path}`);
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

export default server;
