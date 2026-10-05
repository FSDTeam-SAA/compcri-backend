import { Server } from 'node:https';
import Test from 'supertest/lib/test.js';

// supertest serves each request from `app.listen(0)`, which binds every
// interface, and then connects to 127.0.0.1. macOS lets another program hold
// the same port on 127.0.0.1 alone — the editor and Dart tooling run several
// — and when the random port collided, the request reached that program:
// random 404s, 403s, timeouts and "socket hang up" in whichever test was
// running. Connecting over IPv6 loopback reaches only our own server, which
// listens there too. (Binding to 127.0.0.1 instead is not possible: an
// explicit host binds asynchronously, after supertest reads the port.)
Test.prototype.serverAddress = function serverAddress(app, path) {
  if (!app.address()) this._server = app.listen(0);
  const { port } = app.address();
  const protocol = app instanceof Server ? 'https' : 'http';
  return `${protocol}://[::1]:${port}${path}`;
};
