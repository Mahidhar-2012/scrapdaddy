/* One-time codes and server-side sessions.
 *
 * Nothing secret is stored in a form that is useful if the database leaks:
 * both the OTP and the session token are kept only as SHA-256 hashes, salted
 * with AUTH_SECRET. A session token exists in plaintext only in the user's
 * httpOnly cookie, and a code only in their email.
 */
'use strict';

const crypto = require('crypto');
const { Users, Otp, Sessions } = require('./db');

const COOKIE_NAME = 'sd_session';
const OTP_TTL_MIN = Number(process.env.OTP_TTL_MINUTES || 10);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const OTP_MAX_PER_15MIN = Number(process.env.OTP_MAX_PER_15MIN || 3);
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);

function secret() {
  const s = (process.env.AUTH_SECRET || '').trim();
  if (!s || s.length < 16) return { ok: false, reason: 'AUTH_SECRET is not set (use a long random string)' };
  return { ok: true, value: s };
}
const configured = () => secret().ok;

const hash = value => {
  const s = secret();
  if (!s.ok) throw new Error(s.reason);
  return crypto.createHmac('sha256', s.value).update(String(value)).digest('hex');
};

/** A 6-digit code from a cryptographic source, never Math.random. */
function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
const newToken = () => crypto.randomBytes(32).toString('base64url');

const normalEmail = e => String(e || '').trim().toLowerCase();
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalEmail(e));

/* ------------------------------------------------------------------ OTP ---- */
/**
 * Creates a code for an address, superseding any outstanding one.
 * @returns {{ok:true, code:string, minutes:number}|{ok:false, status:number, error:string}}
 */
async function issueCode(email, purpose) {
  const e = normalEmail(email);
  const p = purpose || 'signin';

  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const recent = await Otp.countSince(e, since);
  if (recent >= OTP_MAX_PER_15MIN) {
    return { ok: false, status: 429, error: 'Too many codes requested. Please wait about fifteen minutes.' };
  }

  await Otp.consumeAllFor(e, p);           // only the newest code should work
  const code = newCode();
  await Otp.create({
    email: e,
    code_hash: hash(code),
    purpose: p,
    expires_at: new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString(),
  });
  return { ok: true, code, minutes: OTP_TTL_MIN };
}

/**
 * Checks a code. Counts attempts so a 6-digit code cannot be brute-forced.
 * @returns {{ok:true}|{ok:false, status:number, error:string}}
 */
async function verifyCode(email, code, purpose) {
  const e = normalEmail(email);
  const given = String(code || '').replace(/\D/g, '');
  if (given.length !== 6) return { ok: false, status: 400, error: 'Enter the 6-digit code from the email.' };

  const row = await Otp.newestLive(e, purpose || 'signin');
  if (!row) return { ok: false, status: 400, error: 'That code has expired or was already used. Ask for a new one.' };
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await Otp.consume(row.id);
    return { ok: false, status: 429, error: 'Too many wrong attempts. Ask for a new code.' };
  }

  const expected = Buffer.from(row.code_hash, 'utf8');
  const actual = Buffer.from(hash(given), 'utf8');
  const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!match) {
    await Otp.bumpAttempts(row.id, row.attempts + 1);
    const left = OTP_MAX_ATTEMPTS - (row.attempts + 1);
    return { ok: false, status: 400,
      error: left > 0 ? `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.`
                      : 'That code is not right. Ask for a new one.' };
  }
  await Otp.consume(row.id);
  return { ok: true };
}

/* -------------------------------------------------------------- sessions ---- */
async function startSession(userId, req) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await Sessions.create({
    token_hash: hash(token),
    user_id: userId,
    user_agent: String((req && req.headers && req.headers['user-agent']) || '').slice(0, 300),
    ip: String((req && req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim().slice(0, 64),
    expires_at: expiresAt,
  });
  return { token, expiresAt };
}

function readCookie(req, name) {
  const raw = (req.headers && req.headers.cookie) || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * The signed-in user for a request, or null.
 * Expired sessions are deleted rather than merely ignored.
 */
async function currentUser(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  let row;
  try { row = await Sessions.byHash(hash(token)); } catch { return null; }
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    try { await Sessions.destroy(row.token_hash); } catch {}
    return null;
  }
  const user = await Users.byId(row.user_id);
  if (!user || user.status !== 'active') return null;

  // Slide the window when a session is more than a day old.
  const age = Date.now() - new Date(row.created_at).getTime();
  if (age > 864e5) {
    await Sessions.extend(row.token_hash, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString());
  }
  return { user, tokenHash: row.token_hash };
}

async function endSession(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return;
  try { await Sessions.destroy(hash(token)); } catch {}
}

/* Cross-site by design: the front end may sit on a different origin to the
   API, so the cookie needs SameSite=None, which in turn requires Secure. */
function setSessionCookie(res, token, expiresAt) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'Secure', 'SameSite=None',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

/** Strips anything the browser has no business seeing. */
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, role: u.role,
    phone: u.phone || '', locality: u.locality || '', pin: u.pin || '',
    status: u.status, createdAt: u.created_at ? Date.parse(u.created_at) : null,
  };
}

module.exports = {
  COOKIE_NAME, OTP_TTL_MIN, SESSION_DAYS,
  configured, secret, issueCode, verifyCode,
  startSession, currentUser, endSession,
  setSessionCookie, clearSessionCookie, readCookie,
  publicUser, normalEmail, isEmail,
};
