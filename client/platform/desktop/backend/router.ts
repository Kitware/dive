import { IncomingMessage, RequestListener, ServerResponse } from 'http';
import parser from 'url';

class Handler {
    method: RequestListener;

    constructor(method: RequestListener) {
      this.method = method;
    }

    process(req: IncomingMessage, res: ServerResponse) {
      this.method.apply(this, [req, res]);
    }
}

const handlers: Record<string, Handler> = {};

function register(url: string, method: RequestListener) {
  handlers[url] = new Handler(method);
}

function missing() {
  return new Handler((req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.write(`No route registered for ${req.url}`);
    res.end();
  });
}

function route(req: IncomingMessage): Handler {
  let handler;
  if (req.url) {
    const url = parser.parse(req.url, true);
    if (url.pathname) {
      handler = handlers[url.pathname];
    }
  }
  if (handler === undefined) {
    return missing();
  }
  return handler;
}

export default {
  register,
  route,
};
