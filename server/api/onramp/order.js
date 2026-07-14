import app from '../../src/app.js';

export default function handler(req, res) {
  req.url = '/onramp/order';
  return app(req, res);
}
