import app from '../../src/app.js';

export default function handler(req, res) {
  req.url = '/events/onramp';
  return app(req, res);
}
