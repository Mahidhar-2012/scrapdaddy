/* POST /api/auth/request-otp
   Body: { email, name?, role?, purpose? }

   Sends a one-time code. A first-time address creates an account, so this is
   both sign-in and sign-up — which also means the reply is identical either
   way and reveals nothing about who already has an account.

   The code is never returned in the response, not even in development. If the
   email cannot be sent, the request fails.
*/
'use strict';

const { handler, send, fail, readJson, clientIp } = require('./../_lib/http');
const { take } = require('./../_lib/ratelimit');
const db = require('./../_lib/db');
const mail = require('./../_lib/email');
const S = require('./../_lib/session');

/* Roles a stranger may pick for themselves. Administrator is absent by design:
   it can only be granted by another administrator or directly in the database. */
const SELF_SERVICE_ROLES = ['household', 'vendor', 'factory', 'transporter'];

module.exports = handler(['POST'], async (req, res) => {
  const secret = S.secret();
  if (!db.configured() || !secret.ok) {
    return fail(res, 503, 'Email sign-in is not configured on this deployment.', {
      code: 'not_configured',
      detail: !db.configured() ? db.creds().reason : secret.reason,
    });
  }
  if (!mail.configured()) {
    return fail(res, 503, 'Email sending is not configured on this deployment.', {
      code: 'not_configured', detail: mail.creds().reason,
    });
  }

  const burst = take('otp-ip:' + clientIp(req), Number(process.env.OTP_RATE_PER_HOUR || 15));
  if (!burst.allowed) {
    res.setHeader('Retry-After', String(burst.resetIn));
    return fail(res, 429, 'Too many requests from this connection. Try again later.', { code: 'rate_limited' });
  }

  let body;
  try { body = await readJson(req, 16 * 1024); }
  catch { return fail(res, 400, 'Could not read the request.'); }

  const email = S.normalEmail(body.email);
  if (!S.isEmail(email)) return fail(res, 400, 'Enter a valid email address.', { field: 'email' });
  const purpose = body.purpose === 'reset' ? 'reset' : 'signin';

  let user;
  try { user = await db.Users.byEmail(email); }
  catch (e) { return fail(res, e.status || 503, e.message, { detail: e.detail }); }

  if (user && user.status !== 'active') {
    // Say nothing specific; a suspended account should not be probeable.
    return send(res, 200, { sent: true, isNew: false, expiresInMinutes: S.OTP_TTL_MIN });
  }

  let isNew = false;
  if (!user) {
    if (purpose === 'reset') {
      // Resetting something that does not exist: answer as if it worked.
      return send(res, 200, { sent: true, isNew: false, expiresInMinutes: S.OTP_TTL_MIN });
    }
    const role = SELF_SERVICE_ROLES.indexOf(body.role) >= 0 ? body.role : 'household';
    const name = String(body.name || '').trim().slice(0, 80) || email.split('@')[0];
    try {
      user = await db.Users.create({
        id: 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
        email, name, role,
        phone: String(body.phone || '').trim().slice(0, 20),
        locality: String(body.locality || '').trim().slice(0, 120),
        pin: String(body.pin || '').trim().slice(0, 10),
      });
      isNew = true;
    } catch (e) {
      if (e.status === 409) { user = await db.Users.byEmail(email); }
      else return fail(res, e.status || 503, e.message, { detail: e.detail });
    }
  }

  let issued;
  try { issued = await S.issueCode(email, purpose); }
  catch (e) { return fail(res, e.status || 503, e.message || 'Could not create a code.'); }
  if (!issued.ok) return fail(res, issued.status, issued.error, { code: 'rate_limited' });

  const sent = await mail.sendOtp({ to: email, code: issued.code, minutes: issued.minutes, purpose });
  if (!sent.ok) {
    // Do not leave a usable code behind if the user never received it.
    try { await db.Otp.consumeAllFor(email, purpose); } catch {}
    return fail(res, sent.status || 502, sent.error, { code: 'email_failed' });
  }

  send(res, 200, { sent: true, isNew, expiresInMinutes: issued.minutes });
});
