import app from '../../src/app.js';

export default function handler(req, res) {
  req.url = '/onramp/limits';
  return app(req, res);
}
