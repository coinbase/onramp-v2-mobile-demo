import app from '../../src/app.js';

export default function handler(req, res) {
  req.url = '/onramp/config';
  return app(req, res);
}
