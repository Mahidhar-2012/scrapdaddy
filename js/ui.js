/* ===========================================================================
   ui.js — shared presentation primitives: toasts, modals, form fields,
   cards, charts and the application shell (sidebar + top bar).
   ========================================================================= */
'use strict';

/* ---------- toasts ---------- */
const TOAST_ICON = { ok: '✓', warn: '!', err: '✕', info: 'i' };
function toast(message, kind) {
  const k = kind || 'ok';
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast ' + k;
  el.innerHTML = `<span class="ti strong">${TOAST_ICON[k] || '•'}</span><span>${esc(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0'; el.style.transform = 'translateX(12px)';
    setTimeout(() => el.remove(), 220);
  }, k === 'err' ? 5200 : 3400);
}

/* ---------- modal with focus trap ---------- */
const Modal = {
  _last: null,
  _onClose: null,
  open({ title, body, footer, wide, onClose, labelledBy }) {
    const host = $('#modal');
    this._last = document.activeElement;
    this._onClose = onClose || null;
    host.innerHTML =
      `<div class="box${wide ? ' wide' : ''}">
        <div class="mh"><h3 id="modalTitle">${esc(title || '')}</h3>
          <button class="btn btn-ghost btn-icon" data-act="modalClose" aria-label="Close dialog">✕</button></div>
        <div class="mb">${body || ''}</div>
        ${footer ? `<div class="mf">${footer}</div>` : ''}
      </div>`;
    host.setAttribute('aria-labelledby', labelledBy || 'modalTitle');
    host.hidden = false;
    document.body.style.overflow = 'hidden';
    const first = host.querySelector('[data-autofocus]') || host.querySelector('button, input, select, textarea, a[href]');
    if (first) setTimeout(() => first.focus(), 30);
  },
  setBody(html) { const b = $('#modal .mb'); if (b) b.innerHTML = html; },
  setFooter(html) { const f = $('#modal .mf'); if (f) f.innerHTML = html; },
  isOpen() { return !$('#modal').hidden; },
  close() {
    const host = $('#modal');
    if (host.hidden) return;
    host.hidden = true; host.innerHTML = '';
    document.body.style.overflow = '';
    const cb = this._onClose; this._onClose = null;
    if (this._last && this._last.focus) { try { this._last.focus(); } catch {} }
    this._last = null;
    if (cb) cb();
  },
  trap(e) {
    const host = $('#modal');
    if (host.hidden || e.key !== 'Tab') return;
    const f = $$('button, [href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])', host)
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  },
};

/** Promise-based confirm dialog. Resolves true/false. */
function confirmDialog({ title, body, confirmLabel, danger }) {
  return new Promise(resolve => {
    let done = false;
    const host = $('#modal');
    const onClick = e => {
      const b = e.target.closest('[data-confirm]');
      if (b) { e.stopPropagation(); finish(b.dataset.confirm === 'yes'); }
    };
    const finish = v => {
      if (done) return;
      done = true;
      host.removeEventListener('click', onClick);
      Modal.close();
      resolve(v);
    };
    Modal.open({
      title: title || 'Are you sure?',
      body: `<p class="lead">${esc(body || '')}</p>`,
      footer: `<button class="btn btn-2" data-confirm="no">Cancel</button>
               <button class="btn${danger ? ' btn-danger' : ''}" data-confirm="yes" data-autofocus>${esc(confirmLabel || 'Confirm')}</button>`,
      onClose: () => finish(false),
    });
    host.addEventListener('click', onClick);
  });
}

/* ---------- small building blocks ---------- */
const badge = (text, tone) => `<span class="badge${tone ? ' badge-' + tone : ''}">${esc(text)}</span>`;
const notice = (text, tone, icon) =>
  `<div class="notice notice-${tone || 'info'}"><span class="ni">${icon || 'ℹ️'}</span><div>${text}</div></div>`;

function statCard({ label, value, detail, icon }) {
  return `<div class="stat"><div class="k">${icon ? icon + ' ' : ''}${esc(label)}</div>
    <div class="v">${esc(String(value))}</div>${detail ? `<div class="d">${esc(detail)}</div>` : ''}</div>`;
}
function emptyState({ icon, title, text, action }) {
  return `<div class="empty"><div class="e">${icon || '📭'}</div><h3>${esc(title)}</h3>
    <p>${esc(text || '')}</p>${action || ''}</div>`;
}
function field({ label, name, type, value, placeholder, hint, error, required, autocomplete, attrs, options, rows }) {
  const id = 'f_' + name;
  const common = `id="${id}" name="${name}" data-input="${name}"` +
    (required ? ' required' : '') + (autocomplete ? ` autocomplete="${autocomplete}"` : '') +
    (error ? ' aria-invalid="true"' : '') + (placeholder ? ` placeholder="${esc(placeholder)}"` : '') +
    (attrs || '');
  let control;
  if (type === 'select') {
    control = `<select class="input" ${common}>${options.map(o =>
      `<option value="${esc(o[0])}"${String(o[0]) === String(value) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
  } else if (type === 'textarea') {
    control = `<textarea class="input" rows="${rows || 3}" ${common}>${esc(value || '')}</textarea>`;
  } else {
    control = `<input class="input" type="${type || 'text'}" value="${esc(value == null ? '' : value)}" ${common}>`;
  }
  return `<label class="field" for="${id}"><span class="lbl">${esc(label)}</span>${control}
    ${error ? `<span class="err" role="alert">${esc(error)}</span>` : (hint ? `<span class="hint">${esc(hint)}</span>` : '')}</label>`;
}

/* ---------- charts (inline, no library) ---------- */
function barChart(rows) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<div class="bars">${rows.map(r => `
    <div class="b${r.highlight ? ' hi' : ''}">
      <em>${esc(r.display != null ? r.display : String(r.value))}</em>
      <i style="height:${Math.max(3, Math.round(r.value / max * 86))}%"></i>
      <span>${esc(r.label)}</span>
    </div>`).join('')}</div>`;
}

/* ---------- domain cards ---------- */
function trackBar(stage) {
  return `<div><div class="track" role="img" aria-label="Status: ${esc(STAGES[stage])}">${
    STAGES.map((_, i) => `<i class="${i <= stage ? 'on' : ''}"></i>`).join('')}</div>
    <div class="t-xs muted strong">${esc(STAGES[stage])}</div></div>`;
}
function itemPhoto(item) {
  return item.photo || catPhoto(item.cat);
}
/**
 * One marketplace card. `actions` is pre-rendered HTML so each portal decides
 * what a user may do with the item.
 */
function listingCard(item, { actions, extra, badges } = {}) {
  const isLot = item.source === 'hub';
  const price = isLot ? item.price : item.ask;
  const priceLabel = isLot ? 'lot price' : (item.mode === 'bid' ? 'ask price' : 'at listed rates');
  const tags = badges || [
    badge(CATS[item.cat].short, 'brand'),
    isLot ? badge('Hub lot', 'info') : (item.source === 'rwa' ? badge('Society') : badge('Household')),
  ].join('');
  return `<article class="card lcard">
    <div class="thumb"><img src="${esc(itemPhoto(item))}" alt="" loading="lazy"><div class="ov">${tags}</div></div>
    <div class="b">
      <h3>${esc(item.title)}</h3>
      <div class="loc">📍 <span class="trunc">${esc(isLot ? item.hub : item.locality)}</span></div>
      <div class="price">${inr(price)} <span>${priceLabel}</span></div>
      <div class="facts">
        <div><b>${esc(item.unit ? item.unit : num(item.kg) + ' kg')}</b><span class="t-xs muted">quantity</span></div>
        <div><b>${num(item.co2)} kg</b><span class="t-xs muted">CO₂ saved</span></div>
      </div>
      ${extra || ''}
      ${actions ? `<div class="acts">${actions}</div>` : ''}
    </div></article>`;
}

/* ---------- search + filter toolbar ---------- */
function toolbar(f, { placeholder, showSource, sourceLabels, hideCats } = {}) {
  const open = !!f.open;
  const active = (f.cat !== 'all' ? 1 : 0) + (f.loc ? 1 : 0) + (f.min ? 1 : 0) + (showSource && f.src !== 'all' ? 1 : 0);
  return `<div class="toolbar">
      <div class="input-group"><span class="ic">🔍</span>
        <input class="input" type="search" data-filter="q" value="${esc(f.q)}" placeholder="${esc(placeholder || 'Search materials, areas…')}" aria-label="Search">
      </div>
      ${hideCats ? '' : `<div class="chips">${CAT_FILTERS.map(([k, l]) =>
        `<button class="chip" data-act="setCat" data-v="${k}" aria-pressed="${f.cat === k}">${esc(l)}</button>`).join('')}</div>`}
      ${hideCats ? '' : `<button class="btn btn-2 btn-sm" data-act="toggleFilters" aria-expanded="${open}">
        ⚙ Filters${active ? ` <span class="badge badge-brand">${active}</span>` : ''}</button>`}
    </div>
    ${open ? `<div class="filters">
      ${field({ label: 'Pin code or locality', name: 'loc', value: f.loc, placeholder: 'e.g. 500072 or Madhapur', attrs: ' data-filter="loc"' })}
      ${field({ label: 'Minimum weight (kg)', name: 'min', type: 'number', value: f.min, placeholder: '0', attrs: ' data-filter="min" min="0"' })}
      ${showSource ? field({ label: 'Source', name: 'src', type: 'select', value: f.src, attrs: ' data-filter="src"',
          options: [['all', 'All sources'], ['hub', sourceLabels ? sourceLabels[0] : 'Vendor hub lots'], ['household', sourceLabels ? sourceLabels[1] : 'Households and societies']] }) : ''}
      <div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-2" data-act="clearFilters">Clear filters</button></div>
    </div>` : ''}`;
}
const resultCount = (n, noun) => `<div class="resbar"><span class="n">${n} ${esc(noun)}${n === 1 ? '' : 's'}</span></div>`;

/* ---------- application shell ---------- */
const NAV = {
  household: [
    { href: '#/household', icon: '📊', label: 'Overview' },
    { href: '#/household/sell', icon: '📸', label: 'Sell scrap' },
    { href: '#/household/listings', icon: '📋', label: 'My listings', count: u => DB.listings.filter(l => l.owner === u.id).length },
    { href: '#/rates', icon: '💹', label: 'Scrap prices' },
  ],
  vendor: [
    { href: '#/vendor', icon: '📊', label: 'Overview' },
    { href: '#/vendor/find', icon: '🔍', label: 'Jobs board', count: () => DB.listings.filter(l => l.stage === 0).length },
    { href: '#/vendor/pickups', icon: '🛺', label: 'My pickups', count: u => { const v = vendorForUser(u.id); return v ? DB.listings.filter(l => l.vendor === v.id && l.stage >= 1 && l.stage <= 3).length : 0; } },
    { href: '#/vendor/hub', icon: '🏗️', label: 'Hub inventory' },
    { href: '#/vendor/plan', icon: '💳', label: 'Plan & billing' },
    { href: '#/rates', icon: '💹', label: 'Scrap prices' },
  ],
  transporter: [
    { href: '#/transport', icon: '📊', label: 'Overview' },
    { href: '#/transport/jobs', icon: '🚚', label: 'Delivery jobs',
      count: () => DB.deliveries.filter(d => d.status === 0).length },
    { href: '#/transport/mine', icon: '🧭', label: 'My runs',
      count: u => { const t = transporterForUser(u.id); return t ? DB.deliveries.filter(d => d.transporter === t.id && d.status < 3).length : 0; } },
    { href: '#/transport/sponsorship', icon: '🤝', label: 'Sponsorship' },
    { href: '#/rates', icon: '💹', label: 'Scrap prices' },
  ],
  factory: [
    { href: '#/factory', icon: '📊', label: 'Overview' },
    { href: '#/factory/market', icon: '🏭', label: 'Marketplace' },
    { href: '#/factory/orders', icon: '📦', label: 'Orders', count: u => DB.orders.filter(o => o.buyerId === u.id).length },
    { href: '#/factory/sponsor', icon: '🤝', label: 'Sponsor a transporter' },
    { href: '#/rates', icon: '💹', label: 'Scrap prices' },
  ],
  admin: [
    { href: '#/admin', icon: '📊', label: 'Overview' },
    { href: '#/admin/ledger', icon: '🧾', label: 'Transactions' },
    { href: '#/admin/vendors', icon: '🛺', label: 'Vendors', count: () => DB.vendors.filter(v => v.status === 'pending').length },
    { href: '#/admin/accounts', icon: '👥', label: 'Accounts' },
    { href: '#/admin/transport', icon: '🚚', label: 'Transport & sponsorship',
      count: () => DB.transporters.filter(t => t.status === 'pending').length + DB.sponsorships.filter(s => s.status === 'in_review').length },
    { href: '#/admin/rates', icon: '💹', label: 'Rates & compliance' },
  ],
};

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}
function renderShell(route) {
  const user = Auth.user();
  if (!user) return;
  const meta = ROLE_META[user.role];
  const items = NAV[user.role] || [];
  const here = (location.hash || '').split('?')[0];
  $('#sidebar').innerHTML =
    `<div class="sb-brand"><span class="lg">♻️</span><span>Scrap<b>Daddy</b></span></div>
     <nav class="sb-nav">
       <div class="sb-sec">${esc(meta.label)} portal</div>
       ${items.map(i => {
          const n = i.count ? i.count(user) : null;
          const on = here === i.href || (i.href !== ROLE_META[user.role].home && here.indexOf(i.href) === 0);
          return `<a href="${i.href}"${on ? ' aria-current="page"' : ''}><span class="ic">${i.icon}</span>${esc(i.label)}${
            n ? `<span class="cnt">${n}</span>` : ''}</a>`;
       }).join('')}
       <div class="sb-sec">Account</div>
       <a href="#/account"${here === '#/account' ? ' aria-current="page"' : ''}><span class="ic">⚙️</span>Settings</a>
     </nav>
     <div class="sb-foot">
       <button class="usercard" data-act="goAccount">
         <span class="avatar">${esc(initials(user.name))}</span>
         <span class="grow"><span class="nm trunc">${esc(user.name)}</span><span class="rl">${esc(meta.label)}</span></span>
       </button>
       <button class="btn btn-2 btn-sm btn-block mt-2" data-act="signOut">Sign out</button>
     </div>`;
  $('#topbar').innerHTML =
    `<button class="btn btn-ghost btn-icon burger" data-act="toggleNav" aria-label="Open navigation" aria-expanded="false">☰</button>
     <div class="grow"><h1>${esc(route.title || meta.label)}</h1>${route.subtitle ? `<div class="sub">${esc(route.subtitle)}</div>` : ''}</div>
     <a class="btn btn-2 btn-sm" href="#/rates">💹 Prices</a>`;
}

function renderDemoBanner() {
  const host = $('#banner');
  if (!host) return;
  if (Store.read('scrapdaddy.demoBannerHidden', false)) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="demobar"><span>⚠️</span>
    <span>Demo environment — listings, vendors and prices below are sample data, and accounts are stored in this browser only.</span>
    <button class="btn-link t-xs" data-act="hideDemoBanner">Hide</button></div>`;
}
