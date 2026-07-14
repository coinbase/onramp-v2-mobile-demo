import app from '../../src/app.js';

export default function handler(req, res) {
  req.url = '/offramp/session';
  return app(req, res);
}
