/* Transactional email via Resend.
 *
 * Plain fetch, no SDK, so the project stays dependency-free.
 *
 * A one-time code is never written to a log here or anywhere else. If sending
 * fails, the caller is told sending failed — the code is not returned to the
 * browser as a fallback, because that would defeat the point of emailing it.
 */
'use strict';

const { fetchWithTimeout } = require('./http');

function creds() {
  const key = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.EMAIL_FROM || '').trim();
  if (!key) return { ok: false, reason: 'RESEND_API_KEY is not set' };
  if (key.length < 20) return { ok: false, reason: 'RESEND_API_KEY looks too short' };
  if (!from) return { ok: false, reason: 'EMAIL_FROM is not set (e.g. ScrapDaddy <onboarding@resend.dev>)' };
  return { ok: true, key, from };
}
const configured = () => creds().ok;

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain, high-contrast markup — email clients are not browsers. */
function otpTemplate({ code, minutes, purpose }) {
  const heading = purpose === 'reset' ? 'Reset your ScrapDaddy password' : 'Your ScrapDaddy sign-in code';
  const lead = purpose === 'reset'
    ? 'Use this code to confirm it is really you, then choose a new password.'
    : 'Use this code to sign in.';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F6F8F7;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0E1A13">
  <table role="presentation" style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E2EAE5;border-radius:16px">
    <tr><td style="padding:28px 28px 8px">
      <div style="font-size:19px;font-weight:800">&#9851; Scrap<span style="color:#15803D">Daddy</span></div>
      <h1 style="font-size:19px;margin:20px 0 6px">${esc(heading)}</h1>
      <p style="margin:0;color:#44564B;font-size:14px;line-height:1.5">${esc(lead)}</p>
    </td></tr>
    <tr><td style="padding:12px 28px">
      <div style="background:#ECFDF3;border:1px solid #D3F5E0;border-radius:12px;padding:18px;text-align:center">
        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#126C34">${esc(code)}</div>
      </div>
      <p style="margin:14px 0 0;color:#44564B;font-size:13px;line-height:1.5">
        It expires in ${esc(minutes)} minutes and can be used once.
      </p>
    </td></tr>
    <tr><td style="padding:8px 28px 28px">
      <p style="margin:0;color:#6D7F74;font-size:12px;line-height:1.5">
        If you did not ask for this, ignore this email — nobody can sign in without the code.
        Never share it with anyone, including anyone claiming to be from ScrapDaddy.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * @returns {{ok:true, id:string}|{ok:false, status:number, error:string}}
 */
async function send({ to, subject, html, text }) {
  const c = creds();
  if (!c.ok) return { ok: false, status: 503, error: c.reason };

  let res;
  try {
    res = await fetchWithTimeout((process.env.RESEND_BASE_URL || 'https://api.resend.com') + '/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: c.from, to: [to], subject, html, text }),
    }, 12000);
  } catch (e) {
    console.error('[email] transport error:', e && e.name);
    return { ok: false, status: 504, error: 'Could not reach the email service.' };
  }

  const body = await res.text().catch(() => '');
  if (!res.ok) {
    // The recipient address is logged; the code never is.
    console.error('[email] resend', res.status, body.slice(0, 300));
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 502, error: 'The email service rejected our key.' };
    }
    if (res.status === 422 && /from|domain/i.test(body)) {
      return { ok: false, status: 502, error: 'The sending address is not verified with the email service.' };
    }
    if (res.status === 429) return { ok: false, status: 429, error: 'The email service is rate limiting us. Try again shortly.' };
    return { ok: false, status: 502, error: 'The email could not be sent.' };
  }
  let id = null;
  try { id = JSON.parse(body).id; } catch {}
  return { ok: true, id };
}

async function sendOtp({ to, code, minutes, purpose }) {
  const subject = purpose === 'reset' ? 'Reset your ScrapDaddy password' : `${code} is your ScrapDaddy code`;
  return send({
    to, subject,
    html: otpTemplate({ code, minutes, purpose }),
    text: `Your ScrapDaddy code is ${code}. It expires in ${minutes} minutes and can be used once. ` +
          'If you did not ask for this, ignore this email.',
  });
}

module.exports = { configured, creds, send, sendOtp };
