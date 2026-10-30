/* GET /api/health
   Reports which providers have usable credentials. Never returns a key, a key
   fragment or a key length. With ?probe=1 it also asks each provider whether
   the configured model exists, which is the only honest way to say a model ID
   is valid. */
'use strict';

const { config } = require('./_lib/config');
const { handler, send, fetchWithTimeout } = require('./_lib/http');
const db = require('./_lib/db');
const mail = require('./_lib/email');
const S = require('./_lib/session');

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
    const res = await fetchWithTimeout(config.vision.listEndpoint() + '/' + encodeURIComponent(model), {
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

async function probeGemini(key, model) {
  try {
    const res = await fetchWithTimeout(config.vision.listEndpoint(), {
      headers: { 'x-goog-api-key': key },
    }, 8000);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 400 || res.status === 403) return { reachable: true, modelAvailable: null, reason: 'Gemini rejected the key (' + res.status + ')' };
      return { reachable: false, reason: 'Gemini returned ' + res.status + (body ? ': ' + body.slice(0, 120) : '') };
    }
    const body = await res.json();
    const ids = (body.models || body.data || [])
      .map(m => String(m.name || m.id || '').replace(/^models\//, ''))
      .filter(Boolean);
    if (!ids.length) return { reachable: true, modelAvailable: null, reason: 'Key works; the model list came back empty' };
    return { reachable: true, modelAvailable: ids.indexOf(model) >= 0, availableModels: ids.slice(0, 40) };
  } catch (e) {
    return { reachable: false, reason: e.name === 'AbortError' ? 'Gemini timed out' : 'Could not reach Gemini' };
  }
}

async function probeGroqModel(key, model) {
  const r = await probeGroq(key, model);           // same /models list as the chat probe
  if (r.reachable && r.modelAvailable === false) {
    return Object.assign({}, r, { reason: 'Key works, but "' + model + '" is not available to it' });
  }
  return r;
}
function probeVision(key, model) {
  const p = config.vision.provider();
  if (p === 'gemini') return probeGemini(key, model);
  if (p === 'openai') return probeOpenAI(key, model);
  return probeGroqModel(key, model);
}

module.exports = handler(['GET'], async (req, res) => {
  const visionKey = config.vision.key();
  const chatKey = config.chat.key();
  const payKeyId = config.payments.keyId();
  const payKeySecret = config.payments.keySecret();
  const payHook = config.payments.webhookSecret();

  const providers = {
    vision: {
      configured: visionKey.ok, provider: config.vision.provider(), model: config.vision.model(),
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

  const dbc = db.creds(), mailc = mail.creds(), authc = S.secret();
  providers.accounts = {
    configured: dbc.ok && mailc.ok && authc.ok,
    database: { configured: dbc.ok, provider: 'supabase', reason: dbc.reason },
    email: { configured: mailc.ok, provider: 'resend', from: mailc.ok ? mailc.from : null, reason: mailc.reason },
    secret: { configured: authc.ok, reason: authc.reason },
    mode: (dbc.ok && mailc.ok && authc.ok) ? 'server' : 'browser-only',
  };

  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.get('probe') === '1') {
    const [g, o] = await Promise.all([
      chatKey.ok ? probeGroq(chatKey.value, config.chat.model()) : Promise.resolve({ reachable: false, reason: chatKey.reason }),
      visionKey.ok ? probeVision(visionKey.value, config.vision.model()) : Promise.resolve({ reachable: false, reason: visionKey.reason }),
    ]);
    providers.chat.probe = g;
    providers.vision.probe = o;
    if (dbc.ok) providers.accounts.database.probe = await db.ping();
  }

  send(res, 200, {
    service: 'scraphub-api',
    time: new Date().toISOString(),
    // Diagnostic: which variables the running function can see. Only presence
    // is reported for secrets; VISION_PROVIDER is not a secret so it is echoed
    // verbatim, which is what makes a typo or a stray space visible.
    env: {
      VISION_PROVIDER: process.env.VISION_PROVIDER === undefined ? '(not set)' : JSON.stringify(process.env.VISION_PROVIDER),
      resolvedVisionProvider: config.vision.provider(),
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ? 'set' : '(not set)',
      visionKeyVariable: config.vision.provider() === 'gemini' ? 'GEMINI_API_KEY'
        : config.vision.provider() === 'openai' ? 'OPENAI_API_KEY' : 'GROQ_API_KEY',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'set' : '(not set)',
      GROQ_API_KEY: process.env.GROQ_API_KEY ? 'set' : '(not set)',
      SUPABASE_URL: process.env.SUPABASE_URL ? 'set' : '(not set)',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : '(not set)',
      RESEND_API_KEY: process.env.RESEND_API_KEY ? 'set' : '(not set)',
      EMAIL_FROM: process.env.EMAIL_FROM ? JSON.stringify(process.env.EMAIL_FROM) : '(not set)',
      AUTH_SECRET: process.env.AUTH_SECRET ? 'set' : '(not set)',
    },
    rateLimits: { scanPerHour: config.limits.scanPerHour, chatPerHour: config.limits.chatPerHour },
    providers,
  });
});
