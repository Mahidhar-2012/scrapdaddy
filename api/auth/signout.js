/* POST /api/auth/signout
   Body: { everywhere?: boolean }

   Deletes the session server-side, not just the cookie, so a copied token
   stops working too. With everywhere:true, every session for the account goes.
*/
'use strict';

const { handler, send, readJson } = require('./../_lib/http');
const db = require('./../_lib/db');
const S = require('./../_lib/session');

module.exports = handler(['POST'], async (req, res) => {
  // Signing out always succeeds from the caller's point of view: the cookie is
  // cleared whatever happens server-side.
  let body = {};
  try { body = await readJson(req, 4 * 1024); } catch {}

  if (db.configured() && S.secret().ok) {
    try {
      if (body && body.everywhere) {
        const current = await S.currentUser(req);
        if (current) await db.Sessions.destroyAllFor(current.user.id);
      } else {
        await S.endSession(req);
      }
    } catch (e) {
      console.error('[signout] could not clear the session:', e && e.message);
    }
  }
  S.clearSessionCookie(res);
  send(res, 200, { signedOut: true });
});
