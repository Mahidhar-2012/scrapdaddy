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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  // The session cookie only travels cross-origin when credentials are allowed,
  // and a browser refuses that alongside a wildcard origin. So when the front
  // end is on another origin, ALLOWED_ORIGINS has to name it explicitly.
  if (origin && res.getHeader('Access-Control-Allow-Origin') === origin) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
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
    if (!applyCors(req, res)) return fail(res, 403, 'This origin is not allowed to call the ScrapHub API.');
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

/**
 * Turns an upstream failure into a message safe to show a user.
 * `body` is the raw error text, used to tell apart failures that share a
 * status code — notably "out of credit" and "too many requests", which both
 * come back as 429 but need completely different action from the operator.
 */
function upstreamMessage(status, provider, body) {
  const hay = errorHaystack(body);

  if (/insufficient_quota|exceeded your current quota|billing|credit|payment required/.test(hay)) {
    return `The ${provider} account has no credit left. Add funds to the ${provider} billing page, then try again.`;
  }
  // Gemini reports a bad key as 400 INVALID_ARGUMENT / API_KEY_INVALID
  if (status === 401 || status === 403 || /api_key_invalid|api key not valid/.test(hay)) {
    return `The ${provider} API key was rejected. Check the key in your environment settings.`;
  }
  // Gemini free-tier caps arrive as RESOURCE_EXHAUSTED and are not a billing problem
  if (/resource_exhausted|rate.?limit|too many requests/.test(hay)) {
    return `${provider} is rate limiting us, or the free-tier daily cap is used up. Please try again later.`;
  }
  if (status === 429) return `${provider} is rate limiting us. Please try again in a moment.`;
  if (status === 404 || /model_not_found|does not exist/.test(hay)) {
    return `The configured ${provider} model was not found. Check the model name in your environment settings.`;
  }
  if (status === 400 && /image|invalid_image|unsupported/.test(hay)) {
    return `${provider} could not read that image. Try a different photo.`;
  }
  if (status >= 500) return `${provider} is having trouble right now. Please try again shortly.`;
  return `The request to ${provider} failed.`;
}

/** A short machine-readable reason, for the client to branch on. */
/**
 * Flattens a provider error body into one lowercase string to match against.
 * Providers disagree on where the machine-readable reason lives: OpenAI uses
 * error.code / error.type, Gemini uses error.status and error.details[].reason.
 */
function errorHaystack(body) {
  if (!body) return '';
  let parsed;
  try { parsed = JSON.parse(body); } catch { return String(body).slice(0, 400).toLowerCase(); }
  const e = (parsed && parsed.error) || parsed || {};
  const bits = [e.code, e.type, e.status, e.message, e.reason];
  if (Array.isArray(e.details)) {
    e.details.forEach(d => { if (d && typeof d === 'object') bits.push(d.reason, d['@type'], d.message); });
  }
  return bits.filter(x => typeof x === 'string' || typeof x === 'number').join(' ').toLowerCase();
}

function upstreamCode(status, body) {
  const hay = errorHaystack(body);
  // "quota" alone is ambiguous: Gemini's free-tier cap says RESOURCE_EXHAUSTED
  // without any billing involved, so only billing words mean "no credit".
  if (/insufficient_quota|exceeded your current quota|billing|credit|payment required/.test(hay)) return 'no_credit';
  if (status === 401 || status === 403 || /api_key_invalid|api key not valid/.test(hay)) return 'bad_key';
  if (status === 429 || /resource_exhausted|rate.?limit|too many requests/.test(hay)) return 'rate_limited';
  if (status === 404 || /model_not_found|not found for api version|is not supported/.test(hay)) return 'bad_model';
  return 'upstream_' + status;
}

module.exports = { handler, send, fail, readJson, readRaw, clientIp, fetchWithTimeout, upstreamMessage, upstreamCode, errorHaystack, applyCors };
