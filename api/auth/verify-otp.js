/* POST /api/auth/verify-otp
   Body: { email, code }

   Checks the code and, if it is right, starts a server-side session and sets
   an httpOnly cookie. The browser never sees the session token in JavaScript.
*/
'use strict';

const { handler, send, fail, readJson, clientIp } = require('./../_lib/http');
const { take } = require('./../_lib/ratelimit');
const db = require('./../_lib/db');
const S = require('./../_lib/session');

module.exports = handler(['POST'], async (req, res) => {
  const secret = S.secret();
  if (!db.configured() || !secret.ok) {
    return fail(res, 503, 'Email sign-in is not configured on this deployment.', {
      code: 'not_configured', detail: !db.configured() ? db.creds().reason : secret.reason,
    });
  }

  const burst = take('verify-ip:' + clientIp(req), Number(process.env.VERIFY_RATE_PER_HOUR || 40));
  if (!burst.allowed) {
    res.setHeader('Retry-After', String(burst.resetIn));
    return fail(res, 429, 'Too many attempts from this connection. Try again later.', { code: 'rate_limited' });
  }

  let body;
  try { body = await readJson(req, 8 * 1024); }
  catch { return fail(res, 400, 'Could not read the request.'); }

  const email = S.normalEmail(body.email);
  if (!S.isEmail(email)) return fail(res, 400, 'Enter a valid email address.', { field: 'email' });

  let check;
  try { check = await S.verifyCode(email, body.code, 'signin'); }
  catch (e) { return fail(res, e.status || 503, e.message || 'Could not check the code.'); }
  if (!check.ok) return fail(res, check.status, check.error, { field: 'code' });

  let user;
  try { user = await db.Users.byEmail(email); }
  catch (e) { return fail(res, e.status || 503, e.message, { detail: e.detail }); }
  if (!user) return fail(res, 400, 'No account was found for that address.');
  if (user.status !== 'active') return fail(res, 403, 'This account has been suspended. Contact support.');

  let session;
  try { session = await S.startSession(user.id, req); }
  catch (e) { return fail(res, 503, 'Could not start a session.'); }

  S.setSessionCookie(res, session.token, session.expiresAt);
  db.Users.touch(user.id);          // deliberately not awaited

  send(res, 200, { user: S.publicUser(user), expiresAt: session.expiresAt });
});
