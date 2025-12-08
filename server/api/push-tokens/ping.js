import app from '../../src/app.js';

export default function handler(req, res) {
  req.url = '/push-tokens/ping';
  return app(req, res);
}
