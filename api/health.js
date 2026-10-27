/* GET /api/health
   Reports which providers have usable credentials. Never returns a key, a key
   fragment or a key length. With ?probe=1 it also asks each provider whether
   the configured model exists, which is the only honest way to say a model ID
   is valid. */
'use strict';

const { config } = require('./_lib/config');
const { handler, send, fetchWithTimeout } = require('./_lib/http');

async function probeGroq(key, model) {
  try {
    const res = await fetchWithTimeout(config.chat.base() + '/models', {
      headers: { Authorization: 'Bearer ' + key },
    }, 8000);
    if (!res.ok) return { reachable: false, reason: 'Groq returned ' + res.status };
    const body = await res.json();
    const ids = (body.data || []).map(m => m.id);
    return { reachable: true, modelAvailable: ids.indexOf(model) >= 0, availableModels: ids.slice(0, 40) };
  } catch (e) {
    return { reachable: false, reason: e.name === 'AbortError' ? 'Groq timed out' : 'Could not reach Groq' };
  }
}

async function probeOpenAI(key, model) {
  try {
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
    const res = await fetchWithTimeout(base + '/models/' + encodeURIComponent(model), {
      headers: { Authorization: 'Bearer ' + key },
    }, 8000);
    if (res.status === 404) return { reachable: true, modelAvailable: false, reason: 'Model not found for this key' };
    if (!res.ok) return { reachable: false, reason: 'OpenAI returned ' + res.status };
    // Listing a model costs nothing and succeeds even on an account with no
    // credit, so this cannot tell us whether a real call will be paid for.
    return { reachable: true, modelAvailable: true,
             note: 'Key and model are valid. This check does not verify billing credit — a scan can still fail with "no credit".' };
  } catch (e) {
    return { reachable: false, reason: e.name === 'AbortError' ? 'OpenAI timed out' : 'Could not reach OpenAI' };
  }
}

module.exports = handler(['GET'], async (req, res) => {
  const visionKey = config.vision.key();
  const chatKey = config.chat.key();
  const payKeyId = config.payments.keyId();
  const payKeySecret = config.payments.keySecret();
  const payHook = config.payments.webhookSecret();

  const providers = {
    vision: {
      configured: visionKey.ok, provider: 'openai', model: config.vision.model(),
      reason: visionKey.reason,
    },
    chat: {
      configured: chatKey.ok, provider: 'groq', model: config.chat.model(),
      reason: chatKey.reason,
    },
    payments: {
      configured: payKeyId.ok && payKeySecret.ok, provider: 'razorpay',
      webhookConfigured: payHook.ok,
      reason: payKeyId.ok && payKeySecret.ok ? null : (payKeyId.reason || payKeySecret.reason),
      // Honest about the remaining gap: verifying a payment is not the same as
      // storing the result. See api/billing/webhook.js.
      persistence: process.env.SUBSCRIPTION_STORE_URL ? 'configured' : 'missing',
    },
  };

  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.get('probe') === '1') {
    const [g, o] = await Promise.all([
      chatKey.ok ? probeGroq(chatKey.value, config.chat.model()) : Promise.resolve({ reachable: false, reason: chatKey.reason }),
      visionKey.ok ? probeOpenAI(visionKey.value, config.vision.model()) : Promise.resolve({ reachable: false, reason: visionKey.reason }),
    ]);
    providers.chat.probe = g;
    providers.vision.probe = o;
  }

  send(res, 200, {
    service: 'scrapdaddy-api',
    time: new Date().toISOString(),
    rateLimits: { scanPerHour: config.limits.scanPerHour, chatPerHour: config.limits.chatPerHour },
    providers,
  });
});
