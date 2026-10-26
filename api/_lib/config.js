/* Environment configuration. Secrets are read here and nowhere else, and are
   never returned to the client or written to a log. */
'use strict';

/** Reads a variable and reports whether it is usable, without exposing it. */
function readSecret(name) {
  const v = process.env[name];
  if (typeof v !== 'string' || !v.trim()) return { ok: false, value: null, reason: `${name} is not set` };
  if (v.trim().length < 12) return { ok: false, value: null, reason: `${name} looks too short to be a real key` };
  return { ok: true, value: v.trim(), reason: null };
}

const config = {
  vision: {
    provider: 'openai',
    key: () => readSecret('OPENAI_API_KEY'),
    // Current OpenAI models that accept image input. Override with OPENAI_VISION_MODEL.
    // gpt-6-luna is the cheapest; gpt-6-astra is the most capable.
    model: () => process.env.OPENAI_VISION_MODEL || 'gpt-6.1-sol',
    endpoint: () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1') + '/responses',
  },
  chat: {
    provider: 'groq',
    key: () => readSecret('GROQ_API_KEY'),
    // Groq production chat models: openai/gpt-oss-20b, openai/gpt-oss-120b,
    // llama-3.3-70b-versatile, llama-3.1-8b-instant. Override with GROQ_CHAT_MODEL.
    model: () => process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b',
    base: () => process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    endpoint: () => (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1') + '/chat/completions',
  },
  payments: {
    provider: 'razorpay',
    keyId: () => readSecret('RAZORPAY_KEY_ID'),
    keySecret: () => readSecret('RAZORPAY_KEY_SECRET'),
    webhookSecret: () => readSecret('RAZORPAY_WEBHOOK_SECRET'),
    endpoint: () => 'https://api.razorpay.com/v1/orders',
  },
  allowedOrigins() {
    const raw = process.env.ALLOWED_ORIGINS;
    if (!raw || !raw.trim()) return null; // null = allow any origin (see http.js)
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  },
  limits: {
    scanPerHour: Number(process.env.SCAN_RATE_PER_HOUR || 20),
    chatPerHour: Number(process.env.CHAT_RATE_PER_HOUR || 60),
    maxImageBytes: Number(process.env.MAX_IMAGE_BYTES || 6 * 1024 * 1024),
    upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS || 40000),
  },
};

module.exports = { config, readSecret };
