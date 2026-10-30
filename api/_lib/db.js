/* Supabase access over its REST API (PostgREST).
 *
 * Deliberately no Postgres driver: the project has zero dependencies and
 * deploys without an install step, and plain fetch keeps it that way.
 *
 * Every call here uses the SERVICE ROLE key, which bypasses Row Level
 * Security. It is read from the environment on the server and must never be
 * sent to a browser. The anon key is not used at all.
 */
'use strict';

const { config } = require('./config');
const { fetchWithTimeout } = require('./http');

function creds() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url) return { ok: false, reason: 'SUPABASE_URL is not set' };
  // Hosted Supabase is https://<ref>.supabase.co, but self-hosted installs and
  // custom domains are legitimate too, so require https rather than that exact
  // shape. Plain http is allowed only for localhost, for local development.
  const localhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
  if (!/^https:\/\//.test(url) && !localhost) {
    return { ok: false, reason: 'SUPABASE_URL must start with https:// (e.g. https://xxxx.supabase.co)' };
  }
  if (!key) return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY is not set' };
  if (key.length < 40) return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY looks too short' };
  return { ok: true, url, key };
}
const configured = () => creds().ok;

class DbError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'DbError';
    this.status = status || 500;
    this.detail = detail || null;
  }
}

/**
 * One PostgREST request.
 * @param {string} path   e.g. "app_users?email=eq.a%40b.com&select=*"
 * @param {object} opts   { method, body, prefer }
 */
async function rest(path, opts) {
  const c = creds();
  if (!c.ok) throw new DbError('The database is not configured.', 503, c.reason);
  const o = opts || {};
  const headers = {
    apikey: c.key,
    Authorization: 'Bearer ' + c.key,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (o.prefer) headers.Prefer = o.prefer;

  let res;
  try {
    res = await fetchWithTimeout(c.url + '/rest/v1/' + path, {
      method: o.method || 'GET',
      headers,
      body: o.body ? JSON.stringify(o.body) : undefined,
    }, 12000);
  } catch (e) {
    throw new DbError('Could not reach the database.', 503,
      e.name === 'AbortError' ? 'timed out' : String(e.message || e));
  }

  const text = await res.text().catch(() => '');
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }

  if (!res.ok) {
    // PostgREST reports a missing table as 404 with PGRST205, which almost
    // always means the schema has not been run yet.
    const code = data && data.code;
    if (res.status === 404 || code === 'PGRST205' || code === '42P01') {
      throw new DbError('The database tables are missing. Run db/schema.sql in Supabase.', 503, code || '404');
    }
    if (res.status === 401 || res.status === 403) {
      throw new DbError('The database rejected our key.', 503, 'check SUPABASE_SERVICE_ROLE_KEY');
    }
    if (code === '23505') throw new DbError('That record already exists.', 409, 'unique violation');
    throw new DbError('The database request failed.', 502, (data && data.message) || ('HTTP ' + res.status));
  }
  return data;
}

const enc = v => encodeURIComponent(String(v));

/* ---------------------------------------------------------------- users ---- */
const Users = {
  async byEmail(email) {
    const rows = await rest(`app_users?email=eq.${enc(String(email).trim().toLowerCase())}&limit=1`);
    return (rows && rows[0]) || null;
  },
  async byId(id) {
    const rows = await rest(`app_users?id=eq.${enc(id)}&limit=1`);
    return (rows && rows[0]) || null;
  },
  async list(limit) {
    return (await rest(`app_users?select=*&order=created_at.desc&limit=${Number(limit) || 200}`)) || [];
  },
  async create(user) {
    const rows = await rest('app_users', { method: 'POST', body: user, prefer: 'return=representation' });
    return (rows && rows[0]) || null;
  },
  async update(id, patch) {
    const rows = await rest(`app_users?id=eq.${enc(id)}`, {
      method: 'PATCH', body: patch, prefer: 'return=representation',
    });
    return (rows && rows[0]) || null;
  },
  async touch(id) {
    try { await rest(`app_users?id=eq.${enc(id)}`, { method: 'PATCH', body: { last_seen: new Date().toISOString() } }); }
    catch { /* last_seen is not worth failing a request over */ }
  },
};

/* ------------------------------------------------------------ otp codes ---- */
const Otp = {
  async create(row) {
    const rows = await rest('otp_codes', { method: 'POST', body: row, prefer: 'return=representation' });
    return (rows && rows[0]) || null;
  },
  /** The newest unconsumed, unexpired code for an address. */
  async newestLive(email, purpose) {
    const e = enc(String(email).trim().toLowerCase());
    const now = enc(new Date().toISOString());
    const rows = await rest(
      `otp_codes?email=eq.${e}&purpose=eq.${enc(purpose || 'signin')}&consumed_at=is.null&expires_at=gt.${now}` +
      `&order=created_at.desc&limit=1`);
    return (rows && rows[0]) || null;
  },
  async countSince(email, sinceIso) {
    const e = enc(String(email).trim().toLowerCase());
    const rows = await rest(`otp_codes?email=eq.${e}&created_at=gte.${enc(sinceIso)}&select=id`);
    return (rows || []).length;
  },
  async bumpAttempts(id, attempts) {
    await rest(`otp_codes?id=eq.${enc(id)}`, { method: 'PATCH', body: { attempts } });
  },
  async consume(id) {
    await rest(`otp_codes?id=eq.${enc(id)}`, { method: 'PATCH', body: { consumed_at: new Date().toISOString() } });
  },
  /** Invalidate outstanding codes, so a new one supersedes the old. */
  async consumeAllFor(email, purpose) {
    const e = enc(String(email).trim().toLowerCase());
    await rest(`otp_codes?email=eq.${e}&purpose=eq.${enc(purpose || 'signin')}&consumed_at=is.null`, {
      method: 'PATCH', body: { consumed_at: new Date().toISOString() },
    });
  },
};

/* -------------------------------------------------------------- sessions ---- */
const Sessions = {
  async create(row) {
    await rest('sessions', { method: 'POST', body: row });
    return row;
  },
  async byHash(hash) {
    const rows = await rest(`sessions?token_hash=eq.${enc(hash)}&limit=1`);
    return (rows && rows[0]) || null;
  },
  async destroy(hash) {
    await rest(`sessions?token_hash=eq.${enc(hash)}`, { method: 'DELETE' });
  },
  async destroyAllFor(userId) {
    await rest(`sessions?user_id=eq.${enc(userId)}`, { method: 'DELETE' });
  },
  async extend(hash, expiresAt) {
    try { await rest(`sessions?token_hash=eq.${enc(hash)}`, { method: 'PATCH', body: { expires_at: expiresAt } }); }
    catch { /* a failed extension is not worth failing the request */ }
  },
};

/** Cheap reachability check for /api/health. Never returns row data. */
async function ping() {
  const c = creds();
  if (!c.ok) return { ok: false, reason: c.reason };
  try {
    await rest('app_users?select=id&limit=1');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.detail || e.message };
  }
}

module.exports = { configured, creds, rest, Users, Otp, Sessions, ping, DbError };
