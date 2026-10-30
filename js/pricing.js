/* ===========================================================================
   pricing.js — the price book.

   Prices come from data/prices.json, which can be edited without touching any
   application code. Every entry carries a source, a source type and an update
   time, and the UI always shows them. Nothing here is a live market feed, and
   the code never labels it as one.

   Precedence for a lookup: admin override → exact region → parent region →
   national → unavailable. An "unavailable" answer is returned as such; it is
   never filled in with a guess.
   ========================================================================= */
'use strict';

const PRICE_OVERRIDE_KEY = 'overrides';   // lives inside DB.pricing

const Pricing = {
  book: null,
  status: 'idle',        // idle | loading | ready | error
  error: null,
  loadedAt: null,
  region: null,

  async load() {
    this.status = 'loading';
    try {
      const res = await fetch('data/prices.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const book = await res.json();
      if (!book || !Array.isArray(book.prices)) throw new Error('Price book is malformed');
      this.book = book;
      this.status = 'ready';
      this.error = null;
    } catch (e) {
      // Falls back to the rates compiled into the app so the product still
      // works, but the UI is told the book could not be loaded.
      this.book = this._fallbackBook();
      this.status = 'error';
      this.error = e.message || String(e);
      console.warn('[pricing] could not load data/prices.json —', this.error);
    }
    this.loadedAt = Date.now();
    DB.pricing = DB.pricing || {};
    this.region = DB.pricing.region || this.book.defaultRegion || 'IN';
    this.syncRates();
    return this.status;
  },

  _fallbackBook() {
    return {
      schemaVersion: 1, currency: 'INR', defaultRegion: 'IN',
      regions: [{ code: 'IN', label: 'India (national indicative)', parent: null }],
      sources: {
        'builtin-fallback': {
          name: 'Built-in fallback rates', type: 'indicative', url: null,
          note: 'The price book could not be loaded, so these rates come from the application bundle.',
        },
      },
      prices: RATE_DEFS.map(r => ({
        material: r.key, region: 'IN', unit: r.unit, price: r.base,
        source: 'builtin-fallback', updatedAt: null, marketRange: null, rangeSource: null,
      })),
      freshness: { recentHours: 48, staleHours: 336 },
    };
  },

  /* ---------- regions ---------- */
  regions() { return (this.book && this.book.regions) || [{ code: 'IN', label: 'India' }]; },
  regionLabel(code) {
    const r = this.regions().find(x => x.code === (code || this.region));
    return r ? r.label : (code || 'Unknown');
  },
  setRegion(code) {
    this.region = code;
    DB.pricing = DB.pricing || {};
    DB.pricing.region = code;
    this.syncRates();
    saveDB();
  },
  _chain(code) {
    const out = [];
    let cur = code;
    const seen = {};
    while (cur && !seen[cur]) {
      seen[cur] = 1; out.push(cur);
      const r = this.regions().find(x => x.code === cur);
      cur = r && r.parent;
    }
    return out;
  },

  /* ---------- overrides set by an administrator in-app ---------- */
  _overrides() {
    DB.pricing = DB.pricing || {};
    DB.pricing[PRICE_OVERRIDE_KEY] = DB.pricing[PRICE_OVERRIDE_KEY] || {};
    return DB.pricing[PRICE_OVERRIDE_KEY];
  },
  _overrideKey(material, region) { return material + '@' + region; },
  setOverride(material, region, price, byName) {
    const o = this._overrides();
    o[this._overrideKey(material, region)] = {
      price: Math.max(0, Number(price) || 0),
      updatedAt: new Date().toISOString(),
      by: byName || 'Administrator',
    };
    this.syncRates();
    saveDB();
  },
  clearOverride(material, region) {
    delete this._overrides()[this._overrideKey(material, region)];
    this.syncRates();
    saveDB();
  },
  hasOverride(material, region) { return !!this._overrides()[this._overrideKey(material, region || this.region)]; },

  /* ---------- lookup ---------- */
  /**
   * @returns {{available:boolean, price:number|null, unit:string, region:string,
   *            inherited:boolean, source:object, type:string, updatedAt:number|null,
   *            freshness:string, marketRange:number[]|null, rangeSource:object|null}}
   */
  get(material, region) {
    const reg = region || this.region || 'IN';
    const unit = rateUnit(material);

    const ov = this._overrides()[this._overrideKey(material, reg)];
    if (ov) {
      return {
        available: true, price: ov.price, unit, region: reg, inherited: false,
        source: { name: 'ScrapHub administrator', type: 'indicative', url: null,
                  note: 'Set in the admin console by ' + ov.by + '.' },
        type: 'indicative', updatedAt: Date.parse(ov.updatedAt) || null,
        freshness: this._freshness(Date.parse(ov.updatedAt) || null),
        marketRange: null, rangeSource: null, note: null,
      };
    }
    const chain = this._chain(reg);
    for (let i = 0; i < chain.length; i++) {
      const row = (this.book.prices || []).find(p => p.material === material && p.region === chain[i]);
      if (!row) continue;
      const src = (this.book.sources || {})[row.source] || { name: row.source || 'Unknown', type: 'indicative', url: null };
      const ts = row.updatedAt ? Date.parse(row.updatedAt) : null;
      return {
        available: true, price: row.price, unit: row.unit || unit, region: chain[i],
        inherited: i > 0, source: src, type: src.type || 'indicative',
        updatedAt: ts, freshness: this._freshness(ts),
        marketRange: row.marketRange || null,
        rangeSource: row.rangeSource ? ((this.book.sources || {})[row.rangeSource] || null) : null,
        note: row.note || null,
      };
    }
    return {
      available: false, price: null, unit, region: reg, inherited: false,
      source: null, type: null, updatedAt: null, freshness: 'unavailable',
      marketRange: null, rangeSource: null, note: null,
    };
  },

  _freshness(ts) {
    if (!ts) return 'unknown';
    const f = (this.book && this.book.freshness) || { recentHours: 48, staleHours: 336 };
    const hours = (Date.now() - ts) / 36e5;
    if (hours <= f.recentHours) return 'recent';
    if (hours <= f.staleHours) return 'aging';
    return 'stale';
  },

  /** Every material we know about, resolved for one region. */
  all(region) {
    return RATE_DEFS.map(r => Object.assign({ material: r.key, label: r.label }, this.get(r.key, region)));
  },

  /**
   * Mirrors resolved prices into DB.rates, which the rest of the app reads.
   * Materials with no price keep their last known number but are reported as
   * unavailable by get(), so callers that care can check.
   */
  syncRates() {
    DB.rates = DB.rates || {};
    let changed = false;
    RATE_DEFS.forEach(r => {
      const p = this.get(r.key);
      if (p.available && DB.rates[r.key] !== p.price) { DB.rates[r.key] = p.price; changed = true; }
    });
    const newest = this.all().reduce((m, p) => Math.max(m, p.updatedAt || 0), 0);
    if (newest) DB.ratesUpdated = newest;
    if (changed) saveDB();
  },

  /** Age of the newest entry currently in force. */
  lastUpdated() {
    return this.all().reduce((m, p) => Math.max(m, p.updatedAt || 0), 0) || null;
  },
};

/* ---------- labels used by the UI (kept honest on purpose) ---------- */
const FRESHNESS_LABEL = {
  recent:      { text: 'Recently updated', tone: 'brand' },
  aging:       { text: 'Updated a while ago', tone: 'amber' },
  stale:       { text: 'Out of date', tone: 'danger' },
  unknown:     { text: 'Update time unknown', tone: null },
  unavailable: { text: 'Not available', tone: 'danger' },
};
const SOURCE_TYPE_LABEL = {
  vendor_quote:     'Vendor offer',
  market_reference: 'Published rate card',
  indicative:       'Indicative estimate',
};
function priceSourceLine(p) {
  if (!p.available) return 'No price on file for this material in this area.';
  const bits = [];
  bits.push(SOURCE_TYPE_LABEL[p.type] || 'Indicative estimate');
  if (p.source && p.source.name) bits.push(p.source.name);
  if (p.inherited) bits.push('national rate, no local entry');
  return bits.join(' · ');
}

/**
 * What a quantity is worth, as a range when the price book holds one.
 * Rates are quoted as ranges because condition, sorting and quantity move the
 * number, so showing a single figure would promise more precision than exists.
 */
function estimateRange(qty, materialKey) {
  const q = Number(qty) || 0;
  const p = Pricing.get(materialKey);
  if (!p.available || q <= 0) return null;
  const mid = q * p.price;
  if (!p.marketRange) return { text: inr(mid), mid, lo: mid, hi: mid, isRange: false };
  const lo = q * p.marketRange[0], hi = q * p.marketRange[1];
  return { text: inr(lo) + ' – ' + inr(hi), mid, lo, hi, isRange: true, note: p.note || null };
}
