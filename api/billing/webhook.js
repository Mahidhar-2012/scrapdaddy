/* POST /api/billing/webhook
   Razorpay calls this after a payment. The signature is verified with
   RAZORPAY_WEBHOOK_SECRET before anything is trusted.

   INCOMPLETE BY DESIGN — READ THIS BEFORE GOING LIVE
   --------------------------------------------------
   Verification is implemented and correct. Persistence is not, because this
   deployment has no database: subscription state currently lives in each
   browser, which a webhook cannot reach. So a verified payment is logged and
   acknowledged, but no plan is activated anywhere.

   To finish it you need a datastore (Postgres, Supabase, Vercel KV, D1, …):
     1. Set SUBSCRIPTION_STORE_URL and implement persistSubscription() below.
     2. Record the event id and reject duplicates — Razorpay retries.
     3. Have the app read subscription state from that store instead of
        localStorage (Subscriptions.forVendor in js/subscriptions.js).
   Until then the app keeps paid plans in `pending_payment` and never claims a
   payment succeeded. */
'use strict';

const crypto = require('crypto');
const { config } = require('./../_lib/config');
const { handler, send, fail, readRaw } = require('./../_lib/http');

/* Vercel must not parse the body: the signature is over the raw bytes. */
module.exports.config = { api: { bodyParser: false } };

function verifySignature(rawBody, signature, secret) {
  if (!signature || typeof signature !== 'string') return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function persistSubscription(/* { vendorId, planId, paymentId, orderId, eventId, amount } */) {
  if (!process.env.SUBSCRIPTION_STORE_URL) return { stored: false, reason: 'SUBSCRIPTION_STORE_URL is not set' };
  // Implement against your datastore here. Must be idempotent on eventId.
  return { stored: false, reason: 'persistSubscription() has not been implemented yet' };
}

module.exports = handler(['POST'], async (req, res) => {
  const secret = config.payments.webhookSecret();
  if (!secret.ok) return fail(res, 503, 'Webhook is not configured.', { code: 'not_configured', detail: secret.reason });

  const raw = await readRaw(req);
  const signature = req.headers['x-razorpay-signature'];
  if (!verifySignature(raw, signature, secret.value)) {
    console.warn('[webhook] rejected: bad signature');
    return fail(res, 400, 'Invalid signature.');
  }

  let event;
  try { event = JSON.parse(raw.toString('utf8')); }
  catch { return fail(res, 400, 'Body is not valid JSON.'); }

  const kind = event.event;
  const entity = event.payload && event.payload.payment && event.payload.payment.entity;

  if (kind !== 'payment.captured' && kind !== 'order.paid') {
    return send(res, 200, { received: true, ignored: kind });
  }
  const notes = (entity && entity.notes) || {};
  const result = await persistSubscription({
    vendorId: notes.vendorId, planId: notes.planId,
    paymentId: entity && entity.id, orderId: entity && entity.order_id,
    eventId: req.headers['x-razorpay-event-id'] || null,
    amount: entity && entity.amount,
  });

  // Acknowledge so Razorpay stops retrying a signature-valid event, but be
  // explicit in the log that nothing was activated.
  if (!result.stored) {
    console.warn('[webhook] verified payment NOT activated —', result.reason,
      '| vendor:', notes.vendorId, 'plan:', notes.planId, 'order:', entity && entity.order_id);
  }
  send(res, 200, { received: true, verified: true, activated: !!result.stored, note: result.reason || null });
});
