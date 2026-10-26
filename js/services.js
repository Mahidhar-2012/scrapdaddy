/* ===========================================================================
   services.js — the only place the browser talks to the ScrapDaddy backend.

   API keys never reach this file. Every AI and payment call goes to our own
   server functions, which hold the credentials. If no backend is reachable the
   features that need one report themselves as unavailable rather than
   pretending to work.

   The base URL can be pointed at a separately hosted backend (Settings →
   Integrations), so the static site can stay where it is while the functions
   live on a host that can run server code.
   ========================================================================= */
'use strict';

const API_BASE_KEY = 'scrapdaddy.apiBase';
const API_TIMEOUT_MS = 45000;
const HEALTH_TIMEOUT_MS = 6000;

const Api = {
  _health: null,
  _healthAt: 0,

  base() {
    const override = Store.read(API_BASE_KEY, '');
    if (override) return String(override).replace(/\/+$/, '');
    // same-origin by default: /api/* sits next to the static files
    return location.origin + (location.pathname.replace(/\/[^/]*$/, '')) + '/api';
  },
  setBase(url) {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    if (clean) Store.write(API_BASE_KEY, clean); else Store.remove(API_BASE_KEY);
    this.reset();
    Billing.reset();
  },
  configuredBase() { return Store.read(API_BASE_KEY, '') || null; },
  reset() { this._health = null; this._healthAt = 0; },

  async _fetch(path, { method, body, timeout } = {}) {
    const url = this.base() + '/' + String(path).replace(/^\/+/, '');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout || API_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: method || 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {
        // A static host answers unknown paths with an HTML 404 page.
        return { ok: false, status: res.status, error: res.status === 404
          ? 'No ScrapDaddy backend is deployed at this address.'
          : 'The server sent a response this app could not read.' };
      }
      if (!res.ok) {
        return { ok: false, status: res.status, error: (data && (data.error || data.message)) || ('Request failed (' + res.status + ')'), data };
      }
      return { ok: true, status: res.status, data };
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, status: 0, error: 'The request timed out. Please try again.' };
      return { ok: false, status: 0, error: 'Could not reach the ScrapDaddy backend.' };
    } finally {
      clearTimeout(timer);
    }
  },

  post(path, body, opts) { return this._fetch(path, Object.assign({ method: 'POST', body }, opts || {})); },
  get(path, opts) { return this._fetch(path, Object.assign({ method: 'GET' }, opts || {})); },

  /** Which providers the deployed backend actually has credentials for. */
  async health(force) {
    if (!force && this._health && Date.now() - this._healthAt < 60000) return this._health;
    const res = await this.get('health', { timeout: HEALTH_TIMEOUT_MS });
    const unavailable = reason => ({
      ok: false, error: reason,
      providers: {
        vision: { configured: false, provider: 'openai', reason },
        chat: { configured: false, provider: 'groq', reason },
        payments: { configured: false, provider: 'razorpay', reason },
      },
    });
    this._health = res.ok && res.data && res.data.providers ? Object.assign({ ok: true }, res.data) : unavailable(res.error || 'Backend not reachable.');
    this._healthAt = Date.now();
    return this._health;
  },

  async visionReady() { const h = await this.health(); return !!(h.ok && h.providers.vision.configured); },
  async chatReady() { const h = await this.health(); return !!(h.ok && h.providers.chat.configured); },
};

/* ---------------------------------------------------------------------------
   Scanner — sends one photo for analysis and returns a structured report.
   The server validates the model's JSON against a schema before replying, so
   anything that arrives here has already been checked.
   --------------------------------------------------------------------------- */
const Scanner = {
  MAX_BYTES: 6 * 1024 * 1024,
  ACCEPTED: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],

  /**
   * @param {string} dataUrl  JPEG/PNG/WebP/GIF as a data: URL
   * @param {object} hints    { knownWeightKg, unit, locality } — user-supplied facts
   */
  async analyse(dataUrl, hints) {
    if (!dataUrl) return { ok: false, error: 'Add a photo first.' };
    const mime = (dataUrl.match(/^data:([^;]+);/) || [])[1];
    if (!mime || this.ACCEPTED.indexOf(mime) < 0) {
      return { ok: false, error: 'Use a JPEG, PNG, WebP or GIF image.' };
    }
    const approxBytes = Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
    if (approxBytes > this.MAX_BYTES) {
      return { ok: false, error: 'That image is too large. Please use one under 6 MB.' };
    }
    const res = await Api.post('scan', {
      image: dataUrl,
      knownWeightKg: hints && hints.knownWeightKg != null ? Number(hints.knownWeightKg) : null,
      locality: (hints && hints.locality) || null,
      materials: RATE_DEFS.map(r => r.key),
    });
    if (!res.ok) return { ok: false, error: res.error, status: res.status };
    return { ok: true, report: res.data.report, usage: res.data.usage || null, model: res.data.model || null };
  },
};

/* ---------------------------------------------------------------------------
   Assistant — the help chatbot. Conversation stays in memory; only the current
   user's own context is ever sent.
   --------------------------------------------------------------------------- */
const Assistant = {
  async ask(messages, context) {
    const res = await Api.post('chat', { messages, context });
    if (!res.ok) return { ok: false, error: res.error, status: res.status };
    return { ok: true, reply: res.data.reply, model: res.data.model || null };
  },

  /** A small, non-sensitive summary of where the user is and what they have. */
  context() {
    const u = Auth.user();
    if (!u) return { signedIn: false };
    const base = {
      signedIn: true, role: u.role, name: u.name.split(' ')[0],
      page: (location.hash || '').split('?')[0],
      region: Pricing.regionLabel(),
      rates: Pricing.all().filter(p => p.available).map(p => ({ material: p.label, price: p.price, unit: p.unit })),
    };
    if (u.role === 'household') {
      const mine = DB.listings.filter(l => l.owner === u.id);
      base.myListings = mine.length;
      base.myOpenListings = mine.filter(l => l.stage === 0).length;
      base.myCompleted = mine.filter(l => l.stage >= 2).length;
    } else if (u.role === 'vendor') {
      const v = vendorForUser(u.id);
      if (v) {
        const usage = Subscriptions.usage(v.id);
        base.vendorStatus = v.status;
        base.plan = Subscriptions.effectivePlan(v.id).name;
        base.subscriptionStatus = Subscriptions.forVendor(v.id).status;
        base.jobsUsedThisMonth = usage.jobsUsed;
        base.jobsLimit = usage.jobsLimit === Infinity ? 'unlimited' : usage.jobsLimit;
        base.openPickups = usage.openUsed;
      }
    } else if (u.role === 'factory') {
      base.myOrders = DB.orders.filter(o => o.buyerId === u.id).length;
      base.lotsAvailable = DB.lots.filter(l => l.stage === 0).length;
    }
    return base;
  },
};
