/* GET  /api/auth/session   -> who is signed in, from the cookie
   POST /api/auth/session   -> update your own profile

   This is the trusted answer to "who am I". The browser cannot influence it:
   the identity comes from a session row keyed by a hashed cookie value, and a
   user can only ever patch their own record. Role and status are not
   patchable here at all.
*/
'use strict';

const { handler, send, fail, readJson } = require('./../_lib/http');
const db = require('./../_lib/db');
const S = require('./../_lib/session');

module.exports = handler(['GET', 'POST'], async (req, res) => {
  const secret = S.secret();
  if (!db.configured() || !secret.ok) {
    return fail(res, 503, 'Accounts are not configured on this deployment.', {
      code: 'not_configured', detail: !db.configured() ? db.creds().reason : secret.reason,
    });
  }

  let current;
  try { current = await S.currentUser(req); }
  catch (e) { return fail(res, e.status || 503, e.message || 'Could not read the session.'); }

  if (!current) {
    S.clearSessionCookie(res);
    return send(res, 200, { user: null });
  }

  if (req.method === 'GET') return send(res, 200, { user: S.publicUser(current.user) });

  /* ---- profile update ---- */
  let body;
  try { body = await readJson(req, 16 * 1024); }
  catch { return fail(res, 400, 'Could not read the request.'); }

  const patch = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 80);
    if (!name) return fail(res, 400, 'Name cannot be empty.', { field: 'name' });
    patch.name = name;
  }
  if (typeof body.phone === 'string') {
    const phone = body.phone.trim();
    if (phone && !/^[6-9]\d{9}$/.test(phone)) return fail(res, 400, 'Enter a valid 10-digit mobile number.', { field: 'phone' });
    patch.phone = phone.slice(0, 20);
  }
  if (typeof body.locality === 'string') patch.locality = body.locality.trim().slice(0, 120);
  if (typeof body.pin === 'string') {
    const pin = body.pin.trim();
    if (pin && !/^\d{6}$/.test(pin)) return fail(res, 400, 'Enter a valid 6-digit pin code.', { field: 'pin' });
    patch.pin = pin.slice(0, 10);
  }
  // role, status, email and id are intentionally not accepted here.
  if (!Object.keys(patch).length) return fail(res, 400, 'Nothing to update.');

  let updated;
  try { updated = await db.Users.update(current.user.id, patch); }
  catch (e) { return fail(res, e.status || 503, e.message, { detail: e.detail }); }

  send(res, 200, { user: S.publicUser(updated) });
});
