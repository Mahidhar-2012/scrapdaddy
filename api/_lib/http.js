/* Shared HTTP helpers: CORS, JSON bodies, method guards, upstream calls.
   Errors returned to the client are deliberately generic; details go to the
   server log, and secrets go to neither. */
'use strict';

const { config } = require('./config');

function applyCors(req, res) {
  const allowed = config.allowedOrigins();
  const origin = req.headers.origin;
  if (!allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else if (origin && allowed.indexOf(origin) >= 0) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    return false; // origin not permitted
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
const fail = (res, status, error, extra) => send(res, status, Object.assign({ error }, extra || {}));

/** Wraps a handler with CORS, preflight and method checking. */
function handler(methods, fn) {
  return async function (req, res) {
    if (!applyCors(req, res)) return fail(res, 403, 'This origin is not allowed to call the ScrapDaddy API.');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (methods.indexOf(req.method) < 0) {
      res.setHeader('Allow', methods.join(', '));
      return fail(res, 405, 'Method not allowed.');
    }
    try {
      await fn(req, res);
    } catch (err) {
      console.error('[api] unhandled error:', err && err.message);
      if (!res.writableEnded) fail(res, 500, 'Something went wrong on our side.');
    }
  };
}

/** Reads a JSON body. Works whether or not the platform pre-parsed it. */
async function readJson(req, maxBytes) {
  if (req.body && typeof req.body === 'object') return req.body;
  const limit = maxBytes || 12 * 1024 * 1024;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) { const e = new Error('Payload too large'); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { const e = new Error('Body is not valid JSON'); e.status = 400; throw e; }
}

/** Reads the body as raw bytes, needed for webhook signature checks. */
async function readRaw(req) {
  if (req.body && Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/** fetch with a hard timeout, so a slow provider cannot hold the function open. */
async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || config.limits.upstreamTimeoutMs);
  try {
    return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

/** Turns an upstream failure into a message safe to show a user. */
function upstreamMessage(status, provider) {
  if (status === 401 || status === 403) return `The ${provider} API key was rejected. Check the key in your environment settings.`;
  if (status === 429) return `${provider} is rate limiting us. Please try again in a moment.`;
  if (status === 404) return `The configured ${provider} model was not found. Check the model name in your environment settings.`;
  if (status >= 500) return `${provider} is having trouble right now. Please try again shortly.`;
  return `The request to ${provider} failed.`;
}

module.exports = { handler, send, fail, readJson, readRaw, clientIp, fetchWithTimeout, upstreamMessage, applyCors };
