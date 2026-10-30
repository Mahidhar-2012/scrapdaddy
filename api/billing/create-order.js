/* POST /api/billing/create-order
   Creates a Razorpay order so the browser can open checkout. The amount is
   taken from the plan table here, never from the request, so a client cannot
   ask to be charged less. Nothing is activated by this endpoint. */
'use strict';

const { config } = require('./../_lib/config');
const { handler, send, fail, readJson, clientIp, fetchWithTimeout, upstreamMessage } = require('./../_lib/http');
const { take } = require('./../_lib/ratelimit');

/* Server-side price list. Must match js/subscriptions.js. */
const PLAN_PRICES = { free: 0, growth: 499, pro: 1499 };

module.exports = handler(['POST'], async (req, res) => {
  const keyId = config.payments.keyId();
  const keySecret = config.payments.keySecret();
  if (!keyId.ok || !keySecret.ok) {
    return fail(res, 503, 'Payments are not configured on this deployment.', {
      code: 'not_configured', detail: keyId.reason || keySecret.reason,
    });
  }

  const limit = take('billing:' + clientIp(req), 20);
  if (!limit.allowed) return fail(res, 429, 'Too many payment attempts. Please wait a few minutes.');

  let body;
  try { body = await readJson(req, 32 * 1024); }
  catch { return fail(res, 400, 'Could not read the request.'); }

  const planId = String(body.planId || '');
  if (!Object.prototype.hasOwnProperty.call(PLAN_PRICES, planId)) return fail(res, 400, 'Unknown plan.');
  const rupees = PLAN_PRICES[planId];
  if (rupees <= 0) return fail(res, 400, 'The Starter plan is free and needs no payment.');
  const vendorId = String(body.vendorId || '').slice(0, 64);
  if (!vendorId) return fail(res, 400, 'Missing vendor reference.');

  const auth = Buffer.from(keyId.value + ':' + keySecret.value).toString('base64');
  let upstream;
  try {
    upstream = await fetchWithTimeout(config.payments.endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + auth },
      body: JSON.stringify({
        amount: rupees * 100,          // Razorpay works in paise
        currency: 'INR',
        receipt: 'sd_' + planId + '_' + vendorId + '_' + Date.now(),
        notes: { vendorId, planId, product: 'scraphub-subscription' },
      }),
    }, 20000);
  } catch (e) {
    console.error('[billing] razorpay unreachable:', e && e.name);
    return fail(res, 504, 'Could not reach the payment provider.');
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error('[billing] razorpay', upstream.status, detail.slice(0, 300));
    return fail(res, 502, upstreamMessage(upstream.status, 'Razorpay'));
  }

  const order = await upstream.json();
  send(res, 200, {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: keyId.value,   // the publishable key id, required by checkout; the secret never leaves the server
    planId,
  });
});
