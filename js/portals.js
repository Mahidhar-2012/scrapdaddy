/* ===========================================================================
   portals.js — household, vendor and factory portals, the shared rates page
   and account settings. Each view returns HTML; actions live in `A`.
   ========================================================================= */
'use strict';

/* Ephemeral view state. Deliberately not persisted: filters and half-written
   forms should not survive a reload and become stale. */
const View = {
  filters: {},
  form: null,
  pendingWeight: null,
  renderResults: null,
  // photo analysis
  scanBusy: false,
  scanReport: null,
  scanError: null,
  scanModel: null,
  scanReady: null,     // null = not checked, true/false afterwards
  scanReason: null,
};
const A = {};
const filtersFor = (key, extra) => (View.filters[key] = View.filters[key] || blankFilter(extra));

/* ---------- guards shared by the portals ---------- */
function myVendor() {
  const u = Auth.user();
  if (!u || u.role !== 'vendor') return null;
  return vendorForUser(u.id) || Auth._ensureVendorRecord(u);
}
const vendorApproved = v => !!v && v.status === 'approved';

function maskPhone(p) {
  const s = String(p || '');
  return s.length >= 10 ? s.slice(0, 2) + '•'.repeat(6) + s.slice(-2) : '••••••••••';
}

/* =========================================================================
   HOUSEHOLD
   ========================================================================= */
function myListings() {
  const u = Auth.user();
  return DB.listings.filter(l => l.owner === u.id);
}

function viewHouseholdOverview() {
  const u = Auth.user();
  const mine = myListings();
  const sold = mine.filter(l => l.stage >= 2);
  const earned = sold.reduce((s, l) => s + (l.finalPrice || 0), 0);
  const co2 = sold.reduce((s, l) => s + (l.co2 || 0), 0);
  const open = mine.filter(l => l.stage === 0);
  const live = mine.filter(l => l.stage >= 1 && l.stage < 4);

  const recent = mine.slice().sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 5);
  return `
    <div class="stats">
      ${statCard({ label: 'Paid to you', value: inr(earned), detail: sold.length + ' completed pickup' + (sold.length === 1 ? '' : 's'), icon: '💰' })}
      ${statCard({ label: 'Open listings', value: open.length, detail: open.length ? 'Waiting for a vendor' : 'Nothing listed right now', icon: '📋' })}
      ${statCard({ label: 'In progress', value: live.length, detail: 'Scheduled or being weighed', icon: '🛺' })}
      ${statCard({ label: 'CO₂ saved', value: num(co2) + ' kg', detail: 'From material you recycled', icon: '🌱' })}
    </div>
    <div class="split mt-6">
      <section class="card">
        <div class="card-h"><h3>Recent listings</h3><a class="btn btn-2 btn-sm" href="#/household/listings">View all</a></div>
        ${recent.length ? `<div class="tw"><table>
          <thead><tr><th>Item</th><th class="n">Quantity</th><th>Status</th><th class="n">Value</th></tr></thead><tbody>
          ${recent.map(l => `<tr>
            <td><div class="strong trunc" style="max-width:280px">${esc(l.title)}</div>
                <div class="t-xs muted">${esc(CATS[l.cat].label)} · ${timeAgo(l.created)}</div></td>
            <td class="n nowrap">${esc(l.unit || num(l.kg) + ' kg')}</td>
            <td>${badge(STAGES[l.stage], l.stage >= 2 ? 'brand' : l.stage === 1 ? 'info' : null)}</td>
            <td class="n nowrap">${inr(l.finalPrice || l.ask)}</td></tr>`).join('')}
        </tbody></table></div>` : emptyState({
          icon: '📸', title: 'No listings yet',
          text: 'Photograph your scrap, check the rate and book a free pickup.',
          action: '<a class="btn" href="#/household/sell">Sell scrap</a>',
        })}
      </section>
      <section class="card card-p">
        <h3>Today's rates</h3>
        <p class="t-sm muted mt-2">Indicative reference prices, not a firm offer.</p>
        <div class="mt-3">${RATE_DEFS.slice(0, 5).map(r =>
          `<div class="kv"><span class="k">${esc(r.label)}</span><span class="v">${inr(rateOf(r.key))}/${r.unit}</span></div>`).join('')}</div>
        <a class="btn btn-2 btn-sm btn-block mt-3" href="#/rates">All rates</a>
      </section>
    </div>`;
}

const PHOTO_QUALITY_HINT = {
  blurry:   'The photo looks blurry. Hold still and tap to focus before taking it.',
  too_dark: 'The photo is quite dark. More light would help a lot.',
  too_far:  'The photo was taken from far away. Move closer so the material fills the frame.',
  cluttered:'There is a lot in the frame. Photograph one pile at a time against a plain floor.',
  partial:  'Only part of the material is visible. Step back a little so all of it is in shot.',
  good:     null,
};
const CONFIDENCE_TONE = { high: 'brand', medium: 'amber', low: 'danger' };

function photoBlock() {
  const f = View.form;
  if (!f.photo) {
    return `<label class="drop" for="photoInput">
        <div class="e">📷</div><div class="t">Add a photo</div>
        <div class="h">Click to upload, drag a file here, or use your camera</div>
        <input id="photoInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" hidden>
      </label>
      <p class="t-xs muted mt-2">JPEG, PNG, WebP or GIF, up to 6 MB. A photo is optional — you can list without one.</p>`;
  }
  let action;
  if (View.scanReady === false) {
    action = `<div class="mt-3">${notice(`<strong>Photo analysis is not switched on.</strong><br>
      ${esc(View.scanReason || 'No analysis service is configured for this deployment.')}
      You can still fill the form in yourself.`, 'amber', 'ℹ️')}</div>`;
  } else {
    action = `<button class="btn btn-2 btn-block mt-3" data-act="scan" ${View.scanBusy || View.scanReady === null ? 'disabled' : ''}>
        ${View.scanBusy ? '<span class="spinner sm"></span> Looking at your photo…'
          : View.scanReady === null ? '<span class="spinner sm"></span> Checking…' : '🔍 Analyse this photo'}</button>
      <p class="t-xs muted mt-2">Describes what is visible and suggests a category. It cannot judge weight, purity or grade
        from a picture, and it can be wrong — always check the fields before publishing.</p>`;
  }
  return `<div class="shot"><img src="${esc(f.photo)}" alt="Photo of the scrap you are listing">
      <button class="btn btn-2 btn-sm rm" data-act="rmPhoto">Remove</button></div>${action}`;
}

/** The structured report, rendered with every caveat the model returned. */
function scanReportHtml() {
  const r = View.scanReport;
  if (!r) return '';
  const tone = CONFIDENCE_TONE[r.confidence] || null;
  const qualityHint = PHOTO_QUALITY_HINT[r.photoQuality];
  const catLabel = CATS[r.materialCategory] ? CATS[r.materialCategory].label
    : ({ mixed: 'Several materials', not_scrap: 'Not recyclable scrap', unclear: 'Could not tell' }[r.materialCategory] || r.materialCategory);

  // A value is shown only when the user has supplied a quantity AND we have a
  // price for the suggested material. Otherwise we say why not.
  let valueBlock = '';
  const qty = Number(View.form.qty) || 0;
  const priced = r.priceKey && RATE_DEFS.some(d => d.key === r.priceKey) ? Pricing.get(r.priceKey) : null;
  if (qty > 0 && priced && priced.available) {
    const est = estimateRange(View.form.qty, r.priceKey);
    valueBlock = `<div class="scan-value">
        <div><div class="t-xs muted">Indicative value at your stated quantity</div>
          <div class="strong" style="font-size:20px">${esc(est ? est.text : '—')}</div></div>
        <div class="t-xs muted" style="text-align:right;max-width:52%">
          ${esc(priceSourceLine(priced))}<br>Your quantity, not a measured one.</div>
      </div>`;
  } else {
    const why = qty > 0 ? 'we have no price on file for that material in your area'
      : 'you have not entered a quantity yet';
    valueBlock = `<div class="scan-value muted t-sm">No value shown because ${why}.
      A photograph cannot establish weight — the collector weighs it on a digital scale.</div>`;
  }

  const list = (title, items, icon) => items && items.length
    ? `<div class="scan-sec"><div class="scan-sec-h">${icon} ${esc(title)}</div>
       <ul class="scan-list">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>` : '';

  return `<section class="card scan-report mt-3">
    <div class="card-h">
      <div><h3>What the photo shows</h3>
        <div class="t-xs muted">AI prediction, not a verified measurement</div></div>
      ${badge(r.confidence + ' confidence', tone)}
    </div>
    <div class="card-b">
      <div class="scan-head">
        <div><div class="t-xs muted">Likely category</div><div class="strong t-lg">${esc(catLabel)}</div></div>
        ${r.materialSubtype ? `<div><div class="t-xs muted">Looks like</div><div class="strong">${esc(r.materialSubtype)}</div></div>` : ''}
      </div>
      ${r.summary ? `<p class="mt-3">${esc(r.summary)}</p>` : ''}
      ${r.confidenceReason ? `<p class="t-sm muted mt-2">${esc(r.confidenceReason)}</p>` : ''}
      ${qualityHint ? `<div class="mt-3">${notice(esc(qualityHint) + ' <button class="btn-link" data-act="rmPhoto">Try another photo</button>', 'amber', '📷')}</div>` : ''}
      ${valueBlock}
      ${r.condition ? `<div class="scan-sec"><div class="scan-sec-h">🔎 Condition</div><p class="t-sm">${esc(r.condition)}</p></div>` : ''}
      ${list('Visible items', r.visibleItems, '📦')}
      ${list('Contamination to expect', r.contamination, '⚠️')}
      ${r.quantityAssessment ? `<div class="scan-sec"><div class="scan-sec-h">⚖️ Quantity</div><p class="t-sm">${esc(r.quantityAssessment)}</p></div>` : ''}
      ${list('Safety', r.safetyNotes, '🧤')}
      ${list('What this photo cannot tell us', r.limitations, '🚫')}
      ${list('Would help to know', r.needFromUser, '❓')}
    </div>
    <div class="card-f t-xs muted">
      ${View.scanModel ? 'Analysed by ' + esc(View.scanModel) + '. ' : ''}Fields on the right were filled in from this —
      correct anything that looks wrong before publishing.
    </div>
  </section>`;
}

function sellForm() {
  const f = View.form;
  const mats = MATERIALS[f.cat];
  const qty = Number(f.qty) || 0;
  const kg = kgOf(f.qty, f.rk, f.unit);
  const value = estimateValue(f.qty, f.rk);
  const e = f.errors || {};
  return `<div class="split even" style="align-items:start">
    <section class="card card-p">
      <h3>1. Photo</h3>
      <p class="t-sm muted" style="margin:4px 0 14px">A clear, well-lit photo helps the vendor quote accurately.</p>
      <div id="photoBlock">${photoBlock()}</div>
      ${View.scanError ? `<div class="mt-3">${notice(esc(View.scanError), 'danger', '⚠️')}</div>` : ''}
      ${scanReportHtml()}
    </section>
    <section class="card card-p">
      <h3>2. Details</h3>
      <p class="t-sm muted" style="margin:4px 0 14px">An estimate is fine — the vendor weighs everything on arrival.</p>
      <div class="grid-2">
        ${field({ label: 'Category', name: 'cat', type: 'select', value: f.cat, options: Object.keys(CATS).map(k => [k, CATS[k].label]) })}
        ${field({ label: 'Material', name: 'rk', type: 'select', value: f.rk, options: mats.map(m => [m[0], m[1] + ' · ' + inr(rateOf(m[0])) + '/' + rateUnit(m[0])]) })}
      </div>
      ${field({ label: 'Item name', name: 'title', value: f.title, placeholder: 'e.g. Old copper wiring and brass taps', error: e.title, required: true })}
      ${field({ label: 'Description', name: 'desc', type: 'textarea', value: f.desc, placeholder: 'Condition, how it is sorted, anything the vendor should know' })}
      <div class="grid-2">
        ${field({ label: 'Quantity', name: 'qty', type: 'number', value: f.qty, placeholder: '0', error: e.qty, attrs: ' min="0" step="0.5" inputmode="decimal"' })}
        ${field({ label: 'Unit', name: 'unit', type: 'select', value: f.unit, options: [['kg', 'Kilograms'], ['pieces', 'Pieces']] })}
      </div>
      <div class="field"><span class="lbl">Pricing</span>
        <div class="seg block" role="group" aria-label="Pricing mode">
          <button type="button" data-act="setMode" data-v="fixed" aria-pressed="${f.mode === 'fixed'}">Listed rate</button>
          <button type="button" data-act="setMode" data-v="bid" aria-pressed="${f.mode === 'bid'}">Invite bids</button>
        </div>
        <span class="hint">${f.mode === 'fixed'
          ? 'Free pickup, paid at the published rate after weighing.'
          : 'Best for bulk or high-value items — vendors bid against your asking price.'}</span>
      </div>
      ${f.mode === 'bid' ? field({ label: 'Asking price (₹)', name: 'ask', type: 'number', value: f.ask, placeholder: 'Total you want for the lot', error: e.ask, attrs: ' min="0" inputmode="numeric"' }) : ''}
      <div class="grid-2">
        ${field({ label: 'Locality', name: 'locality', value: f.locality, placeholder: 'Society or area', error: e.locality })}
        ${field({ label: 'Pin code', name: 'pin', value: f.pin, placeholder: '500081', error: e.pin, attrs: ' inputmode="numeric" maxlength="6"' })}
      </div>
      ${field({ label: 'Preferred slot', name: 'slot', type: 'select', value: f.slot, options: SLOTS.map(s => [s, s]) })}
      <div class="card card-p mt-3" style="background:var(--surface-2)">
        <div class="row-between"><div>
          <div class="t-sm muted">Estimated value</div>
          <div class="t-xs muted" id="estMeta">${num(kg)} kg · ${num(co2For(f.cat, kg))} kg CO₂ saved</div>
        </div><div class="strong" style="font-size:20px;text-align:right" id="estValue">${esc(estimateText(f))}</div></div>
        ${estRangeNote(f)}
      </div>
      <button class="btn btn-block mt-3" data-act="publish">Publish listing</button>
      <p class="t-xs muted mt-2 center">Free to list. ${qty ? '' : 'Enter a quantity to see your estimate.'}</p>
    </section>
  </div>`;
}
/** The headline estimate: a range when the rate card holds one. */
function estimateText(f) {
  if (f.mode === 'bid' && Number(f.ask) > 0) return inr(Number(f.ask));
  const r = estimateRange(f.qty, f.rk);
  return r ? r.text : inr(0);
}
/** Explains the range. Depends on the material, not on whether a quantity has
    been typed yet, so it is visible before the user commits to a number. */
function estRangeText(f) {
  const p = Pricing.get(f.rk);
  if (!p.available) return 'No rate on file for this material in your area.';
  const bits = [];
  if (p.marketRange) bits.push('A range, because condition and sorting change the price. The exact amount is agreed at pickup after weighing.');
  if (p.note) bits.push(p.note);
  return bits.join(' ');
}
function estRangeNote(f) {
  return `<div class="t-xs muted mt-2" id="estNote">${esc(estRangeText(f))}</div>`;
}

function viewHouseholdSell() {
  if (!View.form) View.form = blankSellForm();
  return `<div id="sellWrap">${sellForm()}</div>`;
}
function blankSellForm() {
  const u = Auth.user();
  return { cat: 'metals', rk: 'copper', title: '', desc: '', qty: '', unit: 'kg', mode: 'fixed', ask: '',
    locality: (u && u.locality) || '', pin: (u && u.pin) || '', slot: SLOTS[0], photo: '', errors: {} };
}

function householdListingsHtml() {
  const f = filtersFor('hh');
  const items = filterItems(myListings(), f).sort((a, b) => (b.created || 0) - (a.created || 0));
  if (!items.length) {
    return myListings().length
      ? emptyState({ icon: '🔍', title: 'No matches', text: 'No listing matches your search. Try clearing the filters.' })
      : emptyState({ icon: '📋', title: 'Nothing listed yet', text: 'Your listings and their pickup status will appear here.',
          action: '<a class="btn" href="#/household/sell">Sell scrap</a>' });
  }
  return resultCount(items.length, 'listing') + `<div class="listgrid">${items.map(l => {
    const bids = (l.bids || []).slice().sort((a, b) => b.amount - a.amount);
    let extra = '';
    if (l.stage > 0) {
      extra = `<div class="mt-2">${trackBar(l.stage)}
        <div class="t-xs muted mt-2">Vendor: <strong>${esc(vendorName(l.vendor))}</strong>${
          l.scaleKg ? ' · weighed ' + num(l.scaleKg) + ' kg' : ''}</div></div>`;
    } else if (bids.length) {
      extra = `<div class="mt-2">${bids.map(b => `<div class="row-between t-sm" style="padding:4px 0">
          <span>${esc(b.name)} · <strong>${inr(b.amount)}</strong></span>
          <button class="btn btn-sm" data-act="acceptBid" data-id="${l.id}" data-v="${esc(b.vendor)}">Accept</button></div>`).join('')}</div>`;
    } else {
      extra = `<p class="t-xs muted mt-2">Visible to vendors near ${esc(l.pin)}. No offers yet.</p>`;
    }
    const actions = l.stage === 0
      ? `<button class="btn btn-2 btn-sm" data-act="delListing" data-id="${l.id}">Remove listing</button>` : '';
    return listingCard(l, { extra, actions, badges: [badge(CATS[l.cat].short, 'brand'), l.sample ? badge('Sample') : ''].join('') });
  }).join('')}</div>`;
}
function viewHouseholdListings() {
  const f = filtersFor('hh');
  View.renderResults = () => { const el = $('#results'); if (el) el.innerHTML = householdListingsHtml(); };
  return toolbar(f, { placeholder: 'Search your listings…' }) + `<div id="results">${householdListingsHtml()}</div>`;
}

/* ---------- household actions ---------- */
A.setMode = d => { View.form.mode = d.v; redrawSell(); };
A.rmPhoto = () => {
  View.form.photo = '';
  View.scanReport = null; View.scanError = null; View.scanModel = null;
  redrawSell();
};
A.scan = async () => {
  const f = View.form;
  if (!f.photo) return toast('Add a photo first', 'warn');
  if (View.scanBusy) return;
  View.scanBusy = true; View.scanError = null; View.scanReport = null;
  redrawSell();

  const res = await Scanner.analyse(f.photo, {
    knownWeightKg: f.unit === 'kg' && Number(f.qty) > 0 ? Number(f.qty) : null,
    locality: f.locality || null,
  });
  View.scanBusy = false;

  if (!res.ok) {
    View.scanError = userFacingError(res.error, res.code, 'Photo analysis');
    if (res.status === 503 || res.code === 'no_credit' || res.code === 'bad_key') {
      View.scanReady = false;
      View.scanReason = userFacingError(res.error, res.code, 'Photo analysis');
    }
    redrawSell();
    toast('The photo could not be analysed', 'err');
    return;
  }

  const r = res.report;
  View.scanReport = r;
  View.scanModel = res.model;

  // Fill only the fields the report genuinely supports, and never the quantity.
  if (r.materialCategory && CATS[r.materialCategory]) {
    f.cat = r.materialCategory;
    const allowed = MATERIALS[f.cat].map(m => m[0]);
    f.rk = (r.priceKey && allowed.indexOf(r.priceKey) >= 0) ? r.priceKey : allowed[0];
    f.unit = PIECE_KG[f.rk] ? 'pieces' : 'kg';
  } else if (r.priceKey) {
    const cat = Object.keys(MATERIALS).find(c => MATERIALS[c].some(m => m[0] === r.priceKey));
    if (cat) { f.cat = cat; f.rk = r.priceKey; f.unit = PIECE_KG[f.rk] ? 'pieces' : 'kg'; }
  }
  if (!f.title && r.materialSubtype) f.title = r.materialSubtype;
  if (!f.desc && r.condition) f.desc = r.condition;

  redrawSell();
  if (r.materialCategory === 'not_scrap') toast('That does not look like recyclable scrap', 'warn');
  else if (r.confidence === 'low') toast('Analysed, but confidence is low — please check the fields', 'warn');
  else toast('Photo analysed');
};
/** Checks once per sell-page visit whether analysis is available. */
async function refreshScanAvailability() {
  const health = await Api.health();
  const ok = !!(health.ok && health.providers.vision.configured);
  View.scanReady = ok;
  View.scanReason = ok ? null : (health.providers.vision.reason || health.error);
  if ((location.hash || '').indexOf('#/household/sell') === 0) redrawSell();
}
A.publish = () => {
  const f = View.form, u = Auth.user();
  const e = {};
  if (!String(f.title).trim()) e.title = 'Give the item a short name.';
  const kg = kgOf(f.qty, f.rk, f.unit);
  if (!(kg > 0)) e.qty = 'Enter a quantity greater than zero.';
  if (!String(f.locality).trim()) e.locality = 'Tell the vendor where to come.';
  if (!isPin(f.pin)) e.pin = 'Enter a 6-digit pin code.';
  if (f.mode === 'bid' && !(Number(f.ask) > 0)) e.ask = 'Enter your asking price.';
  f.errors = e;
  if (Object.keys(e).length) { redrawSell(); toast('Please fix the highlighted fields', 'warn'); return; }

  const listing = {
    id: nextId('L'), kind: 'listing', owner: u.id, source: 'household', sample: false,
    cat: f.cat, rk: f.rk, appliance: !!PIECE_KG[f.rk],
    title: String(f.title).trim(), desc: String(f.desc).trim(),
    kg, unit: f.unit === 'pieces' ? (f.qty + (Number(f.qty) === 1 ? ' unit' : ' units')) : '',
    ask: Math.round(f.mode === 'bid' ? Number(f.ask) : estimateValue(f.qty, f.rk)),
    mode: f.mode, locality: String(f.locality).trim(), pin: f.pin, slot: f.slot,
    photo: f.photo || catPhoto(f.cat), co2: co2For(f.cat, kg),
    stage: 0, bids: [], vendor: null, created: Date.now(),
  };
  DB.listings.unshift(listing);
  if (!saveDB()) return toast('Could not save — browser storage is full', 'err');
  View.form = blankSellForm();
  View.scanReport = null; View.scanError = null; View.scanModel = null;
  Router.go('#/household/listings');
  toast('Listing published — vendors nearby can see it now');
};
A.delListing = async d => {
  const l = listingById(d.id);
  if (!l || l.owner !== Auth.user().id) return toast('Listing not found', 'err');
  if (!(await confirmDialog({ title: 'Remove listing?', body: `“${l.title}” will be withdrawn from the vendor jobs board.`, confirmLabel: 'Remove', danger: true }))) return;
  DB.listings = DB.listings.filter(x => x.id !== d.id);
  saveDB(); Router.render(); toast('Listing removed');
};
A.acceptBid = d => {
  const l = listingById(d.id);
  if (!l || l.owner !== Auth.user().id) return toast('Listing not found', 'err');
  const b = (l.bids || []).find(x => x.vendor === d.v);
  if (!b) return toast('That offer is no longer available', 'warn');
  Object.assign(l, { stage: 1, vendor: b.vendor, finalPrice: b.amount, acceptedAt: Date.now() });
  saveDB(); Router.render();
  toast(`Accepted ${inr(b.amount)} from ${b.name}`);
};
function redrawSell() {
  const wrap = $('#sellWrap');
  if (wrap) { wrap.innerHTML = sellForm(); bindPhotoInput(); }
}

/* =========================================================================
   VENDOR
   ========================================================================= */
function vendorPendingNotice(v) {
  return notice(`<strong>Account pending verification.</strong> You can browse the jobs board, but accepting pickups
    unlocks once an administrator verifies your ID and weighing scale.`, 'amber', '⏳');
}
function viewVendorOverview() {
  const v = myVendor();
  const mine = DB.listings.filter(l => l.vendor === v.id);
  const active = mine.filter(l => l.stage >= 1 && l.stage <= 3);
  const inHub = mine.filter(l => l.stage === 3 && !l.inLot);
  const hubKg = inHub.reduce((s, l) => s + (l.scaleKg || l.kg), 0);
  const open = DB.listings.filter(l => l.stage === 0).length;
  const byCat = Object.keys(CATS).map(c => ({
    label: CATS[c].short, value: inHub.filter(l => l.cat === c).reduce((s, l) => s + (l.scaleKg || l.kg), 0),
  }));
  byCat.forEach(r => { r.display = r.value ? num(r.value) : '0'; r.highlight = r.value > 0; });
  return `${vendorApproved(v) ? '' : vendorPendingNotice(v) + '<div class="mt-4"></div>'}
    <div class="stats">
      ${statCard({ label: 'Open jobs', value: open, detail: 'On the board right now', icon: '🔍' })}
      ${statCard({ label: 'Active pickups', value: active.length, detail: 'Scheduled, weighing or at hub', icon: '🛺' })}
      ${statCard({ label: 'Hub inventory', value: num(hubKg) + ' kg', detail: inHub.length + ' lot' + (inHub.length === 1 ? '' : 's') + ' not yet sold', icon: '🏗️' })}
      ${statCard({ label: 'Published lots', value: DB.lots.filter(l => l.vendor === v.id).length, detail: 'Listed for factories', icon: '🏭' })}
    </div>
    <div class="split even mt-6">
      <section class="card"><div class="card-h"><h3>Hub inventory by category</h3><span class="t-xs muted">kilograms</span></div>
        <div class="card-b">${hubKg ? barChart(byCat) : emptyState({ icon: '🏗️', title: 'Hub is empty', text: 'Weighed pickups you add to the hub appear here.' })}</div></section>
      <section class="card"><div class="card-h"><h3>Next actions</h3><a class="btn btn-2 btn-sm" href="#/vendor/pickups">My pickups</a></div>
        <div class="card-b">${active.length ? active.slice(0, 5).map(l => `<div class="kv">
            <span class="k trunc" style="max-width:60%">${esc(l.title)}</span>
            <span class="v">${badge(STAGES[l.stage], l.stage === 1 ? 'amber' : 'info')}</span></div>`).join('')
          : emptyState({ icon: '✅', title: 'Nothing pending', text: 'Accept a job from the board to get started.', action: '<a class="btn" href="#/vendor/find">Open jobs board</a>' })}</div></section>
    </div>`;
}

function vendorJobsHtml() {
  const v = myVendor();
  const f = filtersFor('vendor');
  const items = filterItems(DB.listings.filter(l => l.stage === 0), f);
  if (!items.length) return emptyState({ icon: '🔍', title: 'No open jobs match', text: 'Try a different material or widen the area filter.' });
  return resultCount(items.length, 'job') + `<div class="listgrid">${items.map(l => {
    const bids = l.bids || [];
    const mine = bids.find(b => b.vendor === v.id);
    const top = bids.length ? Math.max.apply(null, bids.map(b => b.amount)) : 0;
    const extra = `<div class="t-xs muted">📞 ${esc(maskPhone(l.phone))} · contact stays masked${
      bids.length ? ` · ${bids.length} bid${bids.length === 1 ? '' : 's'}, top ${inr(top)}` : ''}</div>`;
    const can = vendorApproved(v);
    const actions = l.mode === 'bid'
      ? `<div class="row" style="width:100%;gap:6px">
           <input class="input" style="height:32px;flex:1;min-width:0" type="number" min="1" id="bid-${l.id}"
             placeholder="Your bid" value="${mine ? mine.amount : ''}" aria-label="Bid amount for ${esc(l.title)}" ${can ? '' : 'disabled'}>
           <button class="btn btn-sm" data-act="bid" data-id="${l.id}" ${can ? '' : 'disabled'}>${mine ? 'Update' : 'Bid'}</button></div>
         <button class="btn btn-2 btn-sm" data-act="call" data-id="${l.id}">Masked call</button>`
      : `<button class="btn btn-sm" data-act="claim" data-id="${l.id}" ${can ? '' : 'disabled'}>Accept at ${inr(l.ask)}</button>
         <button class="btn btn-2 btn-sm" data-act="call" data-id="${l.id}">Masked call</button>`;
    return listingCard(l, { extra, actions });
  }).join('')}</div>`;
}
function viewVendorFind() {
  const v = myVendor();
  const f = filtersFor('vendor');
  View.renderResults = () => { const el = $('#results'); if (el) el.innerHTML = vendorJobsHtml(); };
  return (vendorApproved(v) ? '' : vendorPendingNotice(v) + '<div class="mt-4"></div>') +
    toolbar(f, { placeholder: 'Search by material, society or pin code…' }) +
    `<div id="results">${vendorJobsHtml()}</div>`;
}

function viewVendorPickups() {
  const v = myVendor();
  const mine = DB.listings.filter(l => l.vendor === v.id && l.stage >= 1 && l.stage <= 3);
  if (!mine.length) return emptyState({ icon: '🛺', title: 'No active pickups',
    text: 'Jobs you accept appear here with weighing and hub steps.', action: '<a class="btn" href="#/vendor/find">Open jobs board</a>' });
  return `<div class="listgrid">${mine.map(l => {
    const extra = `${trackBar(l.stage)}<div class="t-xs muted">🕒 ${esc(l.slot)} · 📞 ${esc(maskPhone(l.phone))}</div>`;
    let actions = `<button class="btn btn-2 btn-sm" data-act="call" data-id="${l.id}">Masked call</button>`;
    if (l.stage === 1) actions += `<button class="btn btn-sm" data-act="weigh" data-id="${l.id}">⚖️ Weigh and pay</button>`;
    else if (l.stage === 2) actions += `<button class="btn btn-sm" data-act="toHub" data-id="${l.id}">Add to hub</button>`;
    else actions += `<span class="badge badge-brand">In hub inventory</span>`;
    return listingCard(l, { extra, actions });
  }).join('')}</div>`;
}

function viewVendorHub() {
  const v = myVendor();
  const inv = DB.listings.filter(l => l.vendor === v.id && l.stage === 3 && !l.inLot);
  const groups = {};
  inv.forEach(l => (groups[l.cat] = groups[l.cat] || []).push(l));
  const lots = DB.lots.filter(l => l.vendor === v.id);
  const MIN_LOT = 50;
  return `<section class="card">
      <div class="card-h"><div><h3>${esc(v.hub)}</h3>
        <div class="t-xs muted">Material you have weighed but not yet sold</div></div></div>
      ${Object.keys(groups).length ? `<div class="tw"><table>
        <thead><tr><th>Category</th><th class="n">Pickups</th><th class="n">Weight</th><th class="n">Paid out</th><th></th></tr></thead><tbody>
        ${Object.keys(groups).map(c => {
          const ls = groups[c];
          const kg = ls.reduce((s, l) => s + (l.scaleKg || l.kg), 0);
          const paid = ls.reduce((s, l) => s + (l.finalPrice || 0), 0);
          return `<tr><td class="strong">${CATS[c].icon} ${esc(CATS[c].label)}</td>
            <td class="n">${ls.length}</td><td class="n">${num(kg)} kg</td><td class="n">${inr(paid)}</td>
            <td class="n"><button class="btn btn-sm" data-act="consolidate" data-v="${c}" ${kg < MIN_LOT ? 'disabled' : ''}>
              ${kg < MIN_LOT ? `Needs ${num(MIN_LOT - kg)} kg more` : 'Bale and publish'}</button></td></tr>`;
        }).join('')}</tbody></table></div>
        <div class="card-f t-xs muted">Demo threshold is ${MIN_LOT} kg so the flow can be tried quickly. Real factory lots are 5–15 tonnes.</div>`
        : `<div class="card-b">${emptyState({ icon: '🏗️', title: 'Hub is empty', text: 'Weigh a pickup and add it to the hub to build a factory lot.' })}</div>`}
    </section>
    <h3 class="mt-6">Published lots</h3>
    <p class="t-sm muted mt-2">Listed on the factory marketplace.</p>
    <div class="mt-3">${lots.length ? `<div class="listgrid">${lots.map(l => listingCard(l, {
      extra: `<div class="t-xs muted">HSN ${esc(l.hsn)} · ${num(l.kg / 1000)} tonnes</div>`,
      actions: l.stage === 4 ? badge('Sold to factory', 'brand') : badge('Live on marketplace', 'info'),
    })).join('')}</div>` : emptyState({ icon: '📦', title: 'No lots published yet', text: 'Bale hub inventory into a lot to offer it to factories.' })}</div>`;
}

/* ---------- vendor actions ---------- */
function requireApprovedVendor() {
  const v = myVendor();
  if (!vendorApproved(v)) { toast('Your vendor account is awaiting verification', 'warn'); return null; }
  return v;
}
A.call = d => {
  const l = listingById(d.id);
  if (!l) return;
  toast('Connecting through the masked line — the resident’s number stays private');
};
A.bid = d => {
  const v = requireApprovedVendor(); if (!v) return;
  const blocked = Subscriptions.check(v.id, 'accept_job');
  if (blocked) return planBlocked(blocked);
  const l = listingById(d.id);
  const input = $('#bid-' + d.id);
  const amount = Math.round(Number(input && input.value) || 0);
  if (!l || l.stage !== 0) return toast('This job is no longer open', 'warn');
  if (!(amount > 0)) { if (input) input.focus(); return toast('Enter a bid amount', 'warn'); }
  l.bids = (l.bids || []).filter(b => b.vendor !== v.id).concat({ vendor: v.id, name: v.name, amount, at: Date.now() });
  saveDB(); Router.render();
  toast(`Bid of ${inr(amount)} sent to the household`);
};
/** Entitlement refusals get a dialog with a way out, not just a toast. */
function planBlocked(reason) {
  Modal.open({
    title: 'Your plan does not allow this',
    body: `<p class="lead">${esc(reason)}</p>
      <p class="t-sm muted mt-3">Upgrading lifts the limit straight away once payment is confirmed. You can also wait for
      the monthly reset, or finish some pickups that are already in progress.</p>`,
    footer: `<button class="btn btn-2" data-act="modalClose">Not now</button>
             <button class="btn" data-act="goPlans" data-autofocus>See plans</button>`,
  });
}
A.goPlans = () => { Modal.close(); Router.go('#/vendor/plan'); };

A.claim = d => {
  const v = requireApprovedVendor(); if (!v) return;
  const blocked = Subscriptions.check(v.id, 'accept_job');
  if (blocked) return planBlocked(blocked);
  const l = listingById(d.id);
  if (!l || l.stage !== 0) return toast('This job has already been taken', 'warn');
  Object.assign(l, { stage: 1, vendor: v.id, finalPrice: l.ask, acceptedAt: Date.now() });
  saveDB(); Router.go('#/vendor/pickups');
  toast('Pickup accepted — weigh the material on arrival');
};
A.weigh = async d => {
  const v = requireApprovedVendor(); if (!v) return;
  const l = listingById(d.id);
  if (!l || l.vendor !== v.id) return toast('Pickup not found', 'err');
  View.pendingWeight = null;
  Modal.open({
    title: 'Digital scale',
    body: `<p class="lead">${esc(l.title)}</p>
      <div class="readout mt-3"><div class="st"><span class="spinner sm"></span> Pairing…</div><div class="w" id="scaleW">— kg</div></div>
      <div class="mt-3">${notice('Demo simulation — no scale is connected. A real deployment pairs a Bluetooth scale so the weight cannot be edited by hand.', 'amber', '⚠️')}</div>`,
    footer: `<button class="btn btn-2" data-act="modalClose">Cancel</button>
             <button class="btn" id="scaleOk" data-act="weighConfirm" data-id="${l.id}" disabled>Confirm weight</button>`,
  });
  await sleep(1500);
  if (!Modal.isOpen()) return;
  const w = Math.round(l.kg * (0.92 + Math.random() * 0.14) * 10) / 10;
  View.pendingWeight = w;
  const wEl = $('#scaleW'), stEl = $('#modal .st'), ok = $('#scaleOk');
  if (wEl) wEl.textContent = w + ' kg';
  if (stEl) stEl.innerHTML = '✓ Reading locked';
  if (ok) { ok.disabled = false; ok.focus(); }
};
A.weighConfirm = d => {
  const v = requireApprovedVendor(); if (!v) return;
  const l = listingById(d.id);
  const w = View.pendingWeight;
  if (!l || w == null) return;
  l.scaleKg = w; l.stage = 2;
  if (l.mode === 'fixed' && l.kg) l.finalPrice = Math.round(l.ask * w / l.kg);
  l.co2 = co2For(l.cat, w);
  saveDB(); Modal.close(); Router.render();
  toast(`${w} kg confirmed — ${inr(l.finalPrice)} paid to the household`);
};
A.toHub = d => {
  const v = requireApprovedVendor(); if (!v) return;
  const l = listingById(d.id);
  if (!l || l.vendor !== v.id || l.stage !== 2) return;
  l.stage = 3; l.hubName = v.hub;
  saveDB(); Router.render(); toast('Added to hub inventory');
};
A.consolidate = d => {
  const v = requireApprovedVendor(); if (!v) return;
  const blocked = Subscriptions.check(v.id, 'publish_lot');
  if (blocked) return planBlocked(blocked);
  const cat = d.v;
  const inv = DB.listings.filter(l => l.vendor === v.id && l.stage === 3 && !l.inLot && l.cat === cat);
  if (!inv.length) return;
  const kg = inv.reduce((s, l) => s + (l.scaleKg || l.kg), 0);
  const paid = inv.reduce((s, l) => s + (l.finalPrice || 0), 0);
  DB.lots.unshift({
    id: nextId('H'), kind: 'lot', source: 'hub', hub: v.hub, vendor: v.id, cat,
    appliance: cat === 'ewaste', title: `Baled ${CATS[cat].label.toLowerCase()} — ${inv.length} pickup${inv.length === 1 ? '' : 's'}`,
    kg, hsn: CATS[cat].hsn, price: Math.round(paid * 1.12), locality: v.hub, pin: '',
    co2: inv.reduce((s, l) => s + (l.co2 || 0), 0), epr: true, stage: 0, members: inv.map(l => l.id), sample: false,
  });
  inv.forEach(l => { l.inLot = true; });
  saveDB(); Router.render();
  toast('Lot published to the factory marketplace');
};

/* =========================================================================
   FACTORY
   ========================================================================= */
function myOrders() {
  const u = Auth.user();
  return DB.orders.filter(o => o.buyerId === u.id);
}
function viewFactoryOverview() {
  const orders = myOrders();
  const kg = orders.reduce((s, o) => s + o.kg, 0);
  const spend = orders.reduce((s, o) => s + o.taxable, 0);
  const avail = DB.lots.filter(l => l.stage === 0);
  const byCat = Object.keys(CATS).map(c => {
    const v = avail.filter(l => l.cat === c).reduce((s, l) => s + l.kg, 0);
    return { label: CATS[c].short, value: v, display: v ? num(v / 1000) + 't' : '0', highlight: v > 0 };
  });
  return `<div class="stats">
      ${statCard({ label: 'Lots available', value: avail.length, detail: num(avail.reduce((s, l) => s + l.kg, 0) / 1000) + ' tonnes on offer', icon: '🏭' })}
      ${statCard({ label: 'Your orders', value: orders.length, detail: 'Placed through ScrapDaddy', icon: '📦' })}
      ${statCard({ label: 'Tonnage bought', value: num(kg / 1000) + ' t', detail: 'Across all orders', icon: '⚖️' })}
      ${statCard({ label: 'Order value', value: inr(spend), detail: 'Taxable value, before GST', icon: '💰' })}
    </div>
    <div class="split even mt-6">
      <section class="card"><div class="card-h"><h3>Supply on the marketplace</h3><a class="btn btn-2 btn-sm" href="#/factory/market">Browse</a></div>
        <div class="card-b">${barChart(byCat)}</div></section>
      <section class="card"><div class="card-h"><h3>Recent orders</h3><a class="btn btn-2 btn-sm" href="#/factory/orders">All orders</a></div>
        <div class="card-b">${orders.length ? orders.slice(0, 5).map(o => `<div class="kv">
            <span class="k trunc" style="max-width:62%">${esc(o.title)}</span>
            <span class="v">${inr(o.taxable)}</span></div>`).join('')
          : emptyState({ icon: '📦', title: 'No orders yet', text: 'Buy a consolidated lot to see it here.' })}</div></section>
    </div>`;
}

function factoryMarketHtml() {
  const f = filtersFor('factory', { src: 'hub' });
  const pool = f.src === 'household'
    ? DB.listings.filter(l => l.stage === 0)
    : (f.src === 'hub' ? DB.lots.filter(l => l.stage === 0)
      : DB.lots.filter(l => l.stage === 0).concat(DB.listings.filter(l => l.stage === 0)));
  const items = filterItems(pool, Object.assign({}, f, { src: 'all' }));
  if (!items.length) return emptyState({ icon: '🏭', title: 'Nothing matches', text: 'Try another material or switch between hub lots and direct listings.' });
  return resultCount(items.length, f.src === 'household' ? 'direct listing' : 'lot') +
    `<div class="listgrid">${items.map(it => {
      const isLot = it.source === 'hub';
      const t = taxBreakdown(it.cat, isLot ? it.price : it.ask, it.hsn);
      const extra = `<div class="mt-2">
          <div class="kv"><span class="k">Taxable · HSN ${esc(t.hsn)}</span><span class="v">${inr(t.taxable)}</span></div>
          <div class="kv"><span class="k">GST ${t.gstPct}%${t.rcm ? ' (RCM)' : ''}</span><span class="v">${inr(t.gst)}</span></div>
          <div class="kv"><span class="k">TCS 2%</span><span class="v">${inr(t.tcs)}</span></div>
          <div class="kv total"><span class="k">Payable</span><span class="v">${inr(t.total)}</span></div></div>`;
      const actions = `<button class="btn btn-sm" data-act="order" data-id="${it.id}" data-kind="${isLot ? 'lot' : 'listing'}">Place order</button>
        <button class="btn btn-2 btn-sm" data-act="certPreview" data-id="${it.id}" data-kind="${isLot ? 'lot' : 'listing'}">Certificate</button>`;
      return listingCard(it, { extra, actions });
    }).join('')}</div>`;
}
function viewFactoryMarket() {
  const f = filtersFor('factory', { src: 'hub' });
  View.renderResults = () => { const el = $('#results'); if (el) el.innerHTML = factoryMarketHtml(); };
  return `<div class="row-between mb-3" style="margin-bottom:14px">
      <div class="seg" role="group" aria-label="Supply type">
        <button data-act="setSrc" data-v="hub" aria-pressed="${f.src === 'hub'}">Hub lots (bulk)</button>
        <button data-act="setSrc" data-v="household" aria-pressed="${f.src === 'household'}">Direct listings</button>
      </div></div>
    ${toolbar(f, { placeholder: 'Search material, HSN or area…' })}
    <div id="results">${factoryMarketHtml()}</div>`;
}
function viewFactoryOrders() {
  const orders = myOrders();
  if (!orders.length) return emptyState({ icon: '📦', title: 'No orders yet',
    text: 'Orders you place on the marketplace appear here with their tax breakdown.',
    action: '<a class="btn" href="#/factory/market">Browse marketplace</a>' });
  return `<section class="card"><div class="tw"><table>
    <thead><tr><th>Order</th><th>Material</th><th class="n">Weight</th><th class="n">Taxable</th><th class="n">GST</th><th>Status</th><th></th></tr></thead>
    <tbody>${orders.map(o => `<tr>
      <td class="strong nowrap">${esc(o.id)}<div class="t-xs muted">${timeAgo(o.ts)}</div></td>
      <td><div class="trunc" style="max-width:260px">${esc(o.title)}</div><div class="t-xs muted">HSN ${esc(o.hsn)}</div></td>
      <td class="n nowrap">${num(o.kg)} kg</td><td class="n nowrap">${inr(o.taxable)}</td>
      <td class="n nowrap">${inr(o.gst)} <span class="t-xs muted">${o.gstPct}%</span></td>
      <td>${badge('Confirmed', 'brand')}</td>
      <td class="n"><button class="btn btn-2 btn-sm" data-act="cert" data-id="${esc(o.id)}">Certificate</button></td></tr>`).join('')}
    </tbody></table></div></section>`;
}

/* ---------- factory actions ---------- */
A.setSrc = d => { filtersFor('factory', { src: 'hub' }).src = d.v; Router.render(); };
A.order = async d => {
  const u = Auth.user();
  const it = itemById(d.id, d.kind === 'lot' ? 'lot' : 'listing');
  if (!it || it.stage !== 0) return toast('This item is no longer available', 'warn');
  const taxable = d.kind === 'lot' ? it.price : it.ask;
  const t = taxBreakdown(it.cat, taxable, it.hsn);
  const ok = await confirmDialog({
    title: 'Confirm order',
    body: `${it.title} — ${num(it.kg)} kg. Payable ${inr(t.total)} including GST and TCS. ` +
          `This records the order in the demo only; no payment is taken.`,
    confirmLabel: 'Place order',
  });
  if (!ok) return;
  DB.orders.unshift({
    id: nextId('O'), kind: d.kind, item: it.id, buyerId: u.id, buyer: u.name,
    title: it.title, cat: it.cat, kg: it.kg, hsn: t.hsn, taxable: t.taxable,
    gstPct: t.gstPct, gst: Math.round(t.gst), tcs: Math.round(t.tcs), total: Math.round(t.total),
    vendor: it.vendor || null, co2: it.co2 || 0, epr: true, ts: Date.now(),
  });
  it.stage = 4;
  let delivery = null;
  if (d.kind === 'lot') {
    (it.members || []).forEach(m => { const l = listingById(m); if (l) { l.stage = 4; l.inLot = true; } });
    // the load now has to physically move, so offer it to transporters
    delivery = createDeliveryForOrder(DB.orders[0], it);
  }
  saveDB(); Router.go('#/factory/orders');
  toast(delivery
    ? 'Order recorded and offered to transporters. No payment was taken in this demo.'
    : 'Order recorded — no payment was taken in this demo');
};
function certificateHtml(o) {
  const no = 'EPR-' + new Date().getFullYear() + '-' + String(o.id || '').replace(/\D/g, '').padStart(5, '0');
  return { no, html: `<div class="cert"><div class="seal">🌿</div>
      <h3>EPR traceability certificate</h3>
      <div class="t-xs muted">Preview ${esc(no)} · ScrapDaddy demo — not a CPCB-issued document</div>
      <div class="mt-4" style="text-align:left">
        <div class="kv"><span class="k">Material</span><span class="v">${esc(o.title)}</span></div>
        <div class="kv"><span class="k">Category · HSN</span><span class="v">${esc(CATS[o.cat].label)} · ${esc(o.hsn)}</span></div>
        <div class="kv"><span class="k">Weight</span><span class="v">${num(o.kg)} kg</span></div>
        <div class="kv"><span class="k">GST</span><span class="v">${o.gstPct != null ? o.gstPct : CATS[o.cat].gst}%</span></div>
        <div class="kv"><span class="k">CO₂ saved</span><span class="v">${num(o.co2)} kg</span></div>
      </div></div>
    <div class="mt-3">${notice('Certificates are generated locally for demonstration. Real CPCB EPR credits require a registered recycler account and audited weighbridge records.', 'amber', '⚠️')}</div>` };
}
A.cert = d => {
  const o = DB.orders.find(x => x.id === d.id);
  if (!o) return;
  const c = certificateHtml(o);
  Modal.open({ title: 'Certificate preview', wide: true, body: c.html,
    footer: `<button class="btn btn-2" data-act="modalClose">Close</button>
             <button class="btn" data-act="certDownload" data-no="${esc(c.no)}">Download</button>` });
  View.lastCert = c;
};
A.certPreview = d => {
  const it = itemById(d.id, d.kind === 'lot' ? 'lot' : 'listing');
  if (!it) return;
  const c = certificateHtml({ id: it.id, title: it.title, cat: it.cat, hsn: it.hsn || CATS[it.cat].hsn, kg: it.kg, co2: it.co2 });
  Modal.open({ title: 'Certificate preview', wide: true, body: c.html,
    footer: `<button class="btn btn-2" data-act="modalClose">Close</button>` });
  View.lastCert = c;
};
A.certDownload = d => {
  const c = View.lastCert;
  if (!c) return;
  const doc = `<!doctype html><meta charset="utf-8"><title>${esc(d.no)}</title>` +
    `<body style="font-family:system-ui;max-width:640px;margin:32px auto;color:#0E1A13">${c.html}</body>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
  a.download = d.no + '.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Certificate downloaded');
};

/* =========================================================================
   SHARED: rates + account
   ========================================================================= */
/* ---------- scrap prices ---------- */
function priceRowsHtml() {
  const f = filtersFor('prices');
  const q = String(f.q || '').trim().toLowerCase();
  const rows = Pricing.all(Pricing.region).filter(p => {
    if (f.cat !== 'all') {
      const cat = Object.keys(MATERIALS).find(c => MATERIALS[c].some(m => m[0] === p.material));
      if (cat !== f.cat) return false;
    }
    return !q || (p.label + ' ' + p.material).toLowerCase().indexOf(q) >= 0;
  });
  if (!rows.length) return emptyState({ icon: '🔍', title: 'No materials match', text: 'Try a different search or category.' });
  return `<section class="card"><div class="tw"><table>
    <thead><tr><th>Material</th><th class="n">Price</th><th>Published range</th><th>Source</th><th>Updated</th></tr></thead>
    <tbody>${rows.map(p => {
      const fr = FRESHNESS_LABEL[p.freshness] || FRESHNESS_LABEL.unknown;
      if (!p.available) {
        return `<tr><td class="strong">${esc(p.label)}</td>
          <td class="n muted">Not available</td><td class="muted">—</td>
          <td class="muted t-sm">No entry for ${esc(Pricing.regionLabel())}</td>
          <td>${badge('Unavailable', 'danger')}</td></tr>`;
      }
      return `<tr>
        <td class="strong">${esc(p.label)}${p.inherited ? ' <span class="badge">national</span>' : ''}
          ${p.note ? `<div class="t-xs muted" style="font-weight:400;max-width:28ch">${esc(p.note)}</div>` : ''}</td>
        <td class="n strong nowrap">${inr(p.price)} <span class="t-xs muted">/${esc(p.unit)}</span></td>
        <td class="muted t-sm nowrap">${p.marketRange ? inr(p.marketRange[0]) + ' – ' + inr(p.marketRange[1]) : '—'}</td>
        <td class="t-sm"><div>${esc((p.source && p.source.name) || '—')}</div>
          <div class="t-xs muted">${esc(SOURCE_TYPE_LABEL[p.type] || 'Indicative')}${
            p.source && p.source.url ? ` · <a href="${esc(p.source.url)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</div></td>
        <td class="nowrap">${p.updatedAt ? `<div class="t-sm">${timeAgo(p.updatedAt)}</div>` : ''}${badge(fr.text, fr.tone)}</td>
      </tr>`;
    }).join('')}</tbody></table></div>
    <div class="card-f t-xs muted">Prices are per kilogram unless the unit says otherwise. A vendor may quote differently
      for condition, sorting or quantity — the amount you are paid is agreed at pickup, after weighing.</div>
  </section>`;
}

function viewPrices() {
  const f = filtersFor('prices');
  View.renderResults = () => { const el = $('#results'); if (el) el.innerHTML = priceRowsHtml(); };
  const isAdmin = Auth.role() === 'admin';
  const updated = Pricing.lastUpdated();
  const loadFailed = Pricing.status === 'error';

  const banner = loadFailed
    ? notice(`<strong>The price book could not be loaded.</strong> Showing the rates built into the app instead.
        <span class="t-xs">(${esc(Pricing.error || '')})</span>`, 'danger', '⚠️')
    : notice(`<strong>These are reference prices, not live market data.</strong> Each row shows where its number came from
        and when it was last changed. They guide you; the amount paid is agreed at pickup after weighing.`, 'amber', 'ℹ️');

  return `${banner}
    <div class="toolbar mt-4">
      <div class="input-group"><span class="ic">🔍</span>
        <input class="input" type="search" data-filter="q" value="${esc(f.q)}" placeholder="Search a material…" aria-label="Search materials">
      </div>
      <div class="chips">${CAT_FILTERS.map(([k, l]) =>
        `<button class="chip" data-act="setCat" data-v="${k}" aria-pressed="${f.cat === k}">${esc(l)}</button>`).join('')}</div>
      <label class="row t-sm" style="gap:6px">
        <span class="muted">Area</span>
        <select class="input" style="width:auto;height:32px;font-size:13px" data-act="setRegion" aria-label="Pricing area">
          ${Pricing.regions().map(r => `<option value="${esc(r.code)}"${r.code === Pricing.region ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select>
      </label>
      <button class="btn btn-2 btn-sm" data-act="reloadPrices">↻ Refresh</button>
      ${isAdmin ? '<a class="btn btn-2 btn-sm" href="#/admin/rates">Edit</a>' : ''}
    </div>
    <div class="resbar"><span class="n">${
      updated ? 'Newest entry updated ' + timeAgo(updated) : 'Update times unknown'
    } · ${esc(Pricing.regionLabel())}</span></div>
    <div id="results">${priceRowsHtml()}</div>`;
}
A.setRegion = (d, el) => { Pricing.setRegion(el.value); Router.render(); };
A.reloadPrices = async () => {
  Pricing._cacheBusted = true;
  const status = await Pricing.load();
  Router.render();
  toast(status === 'ready' ? 'Price book reloaded' : 'Could not reload the price book', status === 'ready' ? 'ok' : 'err');
};

/* ---------- vendor plan & billing ---------- */
function viewVendorPlan() {
  const v = myVendor();
  const sub = Subscriptions.forVendor(v.id);
  const current = Subscriptions.effectivePlan(v.id);
  const usage = Subscriptions.usage(v.id);
  const st = SUB_STATUS[sub.status] || SUB_STATUS.active;
  const unpaid = sub.status === 'pending_payment';

  return `<section class="card">
      <div class="card-h"><div><h3>Your plan</h3>
        <div class="t-xs muted">Billing for ${esc(v.hub)}</div></div>${badge(st.label, st.tone)}</div>
      <div class="card-b">
        <div class="split even">
          <div>
            <div class="t-xs muted">Active plan</div>
            <div class="strong" style="font-size:22px">${esc(current.name)}${current.price ? ' · ' + inr(current.price) + '/month' : ' · free'}</div>
            ${unpaid && sub.planId !== current.id ? `<div class="mt-2">${notice(
              `<strong>${esc(planById(sub.planId).name)} is not active.</strong> It starts only once payment is confirmed,
               so you are still on ${esc(current.name)}.`, 'amber', '⏳')}</div>` : ''}
            ${sub.cancelAtPeriodEnd ? `<div class="mt-2">${notice('This plan will not renew. You keep its features until the period ends.', 'amber', 'ℹ️')}</div>` : ''}
            ${sub.renewsAt ? `<div class="t-sm muted mt-2">Renews ${new Date(sub.renewsAt).toLocaleDateString('en-IN')}</div>` : ''}
          </div>
          <div>
            <div class="t-xs muted">Pickups accepted this month</div>
            <div class="strong" style="font-size:22px">${usage.jobsUsed}${usage.jobsLimit === Infinity ? '' : ' / ' + usage.jobsLimit}</div>
            ${usage.jobsLimit === Infinity ? '<div class="t-sm muted">Unlimited on this plan</div>'
              : `<div class="pw-meter mt-2"><i style="width:${usage.pct}%;background:${usage.pct >= 100 ? 'var(--danger)' : usage.pct >= 80 ? 'var(--amber)' : 'var(--brand)'}"></i></div>
                 <div class="t-xs muted mt-2">${usage.jobsLeft} left · resets on the 1st</div>`}
            <div class="t-sm muted mt-3">In progress now: ${usage.openUsed}${usage.openLimit === Infinity ? '' : ' of ' + usage.openLimit}</div>
          </div>
        </div>
        ${sub.planId !== 'free' && !sub.cancelAtPeriodEnd
          ? `<button class="btn btn-2 btn-sm mt-4" data-act="planCancel">Cancel plan</button>`
          : sub.cancelAtPeriodEnd ? `<button class="btn btn-2 btn-sm mt-4" data-act="planResume">Keep my plan</button>` : ''}
      </div>
    </section>

    <h3 class="mt-6">Plans</h3>
    <p class="t-sm muted mt-2">Prices in INR, billed monthly. Change or cancel whenever you like.</p>
    <div class="plans mt-3">${PLANS.map(p => {
      const isCurrent = p.id === current.id;
      const isRequested = p.id === sub.planId && unpaid;
      return `<div class="card plan${isCurrent ? ' is-current' : ''}">
        ${p.badge ? `<div class="plan-badge">${esc(p.badge)}</div>` : ''}
        <div class="card-b">
          <div class="row-between"><h4>${esc(p.name)}</h4>${isCurrent ? badge('Current', 'brand') : isRequested ? badge('Awaiting payment', 'amber') : ''}</div>
          <div class="plan-price">${p.price ? inr(p.price) : 'Free'}${p.price ? '<span>/month</span>' : ''}</div>
          <p class="t-sm muted">${esc(p.tagline)}</p>
          <ul class="plan-feat">${p.features.map(ft => `<li><span class="tick">✓</span>${esc(ft)}</li>`).join('')}
            ${p.limits.map(l => `<li class="no"><span class="tick">✕</span>${esc(l)}</li>`).join('')}</ul>
          ${isCurrent ? '<button class="btn btn-2 btn-block" disabled>Your plan</button>'
            : `<button class="btn${p.price ? '' : ' btn-2'} btn-block" data-act="planChange" data-v="${p.id}">
                 ${p.price > current.price ? 'Upgrade' : 'Switch'} to ${esc(p.name)}</button>`}
        </div></div>`;
    }).join('')}</div>
    <div id="billingNote" class="mt-4"></div>`;
}

A.planChange = async d => {
  const v = myVendor(); if (!v) return;
  const plan = planById(d.v);
  if (plan.price > 0) {
    const ok = await confirmDialog({
      title: `Switch to ${plan.name}?`,
      body: `${plan.name} is ${inr(plan.price)} a month. The plan starts only after payment is confirmed.`,
      confirmLabel: 'Continue',
    });
    if (!ok) return;
  }
  const res = await Subscriptions.requestChange(v.id, d.v);
  Router.render();
  const note = $('#billingNote');
  if (note && !res.ok) note.innerHTML = notice(esc(res.message), 'amber', '⏳');
  toast(res.message, res.ok ? 'ok' : 'warn');
};
A.planCancel = async () => {
  const v = myVendor(); if (!v) return;
  if (!(await confirmDialog({ title: 'Cancel your plan?',
    body: 'You keep the current features until the period ends, then move to the free Starter plan.',
    confirmLabel: 'Cancel plan', danger: true }))) return;
  const res = Subscriptions.cancel(v.id);
  Router.render(); toast(res.message, res.ok ? 'ok' : 'warn');
};
A.planResume = () => {
  const v = myVendor(); if (!v) return;
  const res = Subscriptions.resume(v.id);
  Router.render(); toast(res.message, res.ok ? 'ok' : 'warn');
};

function viewAccount() {
  const u = Auth.user();
  const s = Auth.session();
  const v = u.role === 'vendor' ? myVendor() : null;
  return `<div class="split even" style="align-items:start">
    <section class="card card-p">
      <h3>Profile</h3>
      <p class="t-sm muted" style="margin:4px 0 14px">${esc(u.email)} · ${esc(ROLE_META[u.role].label)} account</p>
      ${field({ label: 'Name', name: 'pf_name', value: u.name })}
      ${field({ label: 'Phone', name: 'pf_phone', value: u.phone, placeholder: '10-digit mobile', attrs: ' inputmode="numeric" maxlength="10"' })}
      ${field({ label: 'Locality', name: 'pf_locality', value: u.locality })}
      ${field({ label: 'Pin code', name: 'pf_pin', value: u.pin, attrs: ' inputmode="numeric" maxlength="6"' })}
      <button class="btn" data-act="saveProfile">Save changes</button>
      ${v ? `<div class="divider"></div><h4>Vendor record</h4>
        <div class="kv"><span class="k">Hub</span><span class="v">${esc(v.hub)}</span></div>
        <div class="kv"><span class="k">ID check</span><span class="v">${v.kycVerified ? '✅ Verified' : '⏳ Pending'}</span></div>
        <div class="kv"><span class="k">Scale check</span><span class="v">${v.scaleVerified ? '✅ Verified' : '⏳ Pending'}</span></div>
        <div class="kv"><span class="k">Status</span><span class="v">${badge(v.status === 'approved' ? 'Approved' : 'Pending approval', v.status === 'approved' ? 'brand' : 'amber')}</span></div>` : ''}
    </section>
    <section class="card card-p">
      <h3>Password</h3>
      <p class="t-sm muted" style="margin:4px 0 14px">Choose at least 8 characters with a letter and a number.</p>
      ${field({ label: 'Current password', name: 'cp_cur', type: 'password', value: '', autocomplete: 'current-password' })}
      ${field({ label: 'New password', name: 'cp_new', type: 'password', value: '', autocomplete: 'new-password' })}
      <button class="btn" data-act="changePassword">Update password</button>
      <div class="divider"></div>
      <h4>Session</h4>
      <div class="kv"><span class="k">Signed in</span><span class="v">${timeAgo(s.iat)}</span></div>
      <div class="kv"><span class="k">Signs out after</span><span class="v">30 min idle</span></div>
      <div class="divider"></div>
      <h4>Demo data</h4>
      <p class="t-sm muted mt-2">Restores the sample listings, lots and rates. Your account is not deleted.</p>
      <button class="btn btn-2 mt-3" data-act="resetDemo">Reset demo data</button>
    </section>
  </div>
  ${u.role === 'admin' ? integrationsCard() : ''}`;
}

/* ---------- integrations (administrators only) ---------- */
function integrationsCard() {
  const base = Api.configuredBase();
  const h = View.healthSnapshot;
  const row = (label, p) => {
    if (!p) return '';
    const probe = p.probe;
    let detail;
    if (!p.configured) detail = p.reason || 'Not configured';
    else if (probe && probe.reachable === false) detail = probe.reason || 'Could not reach the provider';
    else if (probe && probe.modelAvailable === false) detail = `Key works, but "${p.model}" is not available to it${
      probe.availableModels ? '. Available: ' + probe.availableModels.slice(0, 6).join(', ') : ''}`;
    else if (probe && probe.modelAvailable) detail = `Key and model verified · ${p.model}`;
    else detail = `Key present · ${p.model || p.provider}`;
    const ok = p.configured && (!probe || (probe.reachable !== false && probe.modelAvailable !== false));
    return `<div class="kv"><span class="k">${esc(label)}</span>
      <span class="v">${badge(ok ? 'Ready' : p.configured ? 'Check needed' : 'Not configured', ok ? 'brand' : p.configured ? 'amber' : null)}</span></div>
      <div class="t-xs muted" style="margin:-2px 0 8px">${esc(detail)}</div>`;
  };
  return `<section class="card card-p mt-4">
    <h3>Integrations</h3>
    <p class="t-sm muted" style="margin:4px 0 14px">Photo analysis, the assistant and payments run on a ScrapDaddy
      backend that holds the API keys. Keys are never stored in the browser. Leave the address blank to use a backend
      deployed alongside this site.</p>
    ${field({ label: 'Backend address', name: 'api_base', value: base || '',
      placeholder: 'https://your-project.vercel.app/api',
      hint: 'Must end in /api. Leave empty for same-origin.' })}
    <div class="row" style="gap:8px">
      <button class="btn" data-act="saveApiBase">Save and test</button>
      <button class="btn btn-2" data-act="testApi">Test connection</button>
    </div>
    ${h ? `<div class="mt-4">
      ${h.ok ? '' : notice(esc(h.error || 'No backend is reachable at that address.'), 'amber', '⚠️')}
      <div class="mt-3">
        ${row('Photo analysis (OpenAI)', h.providers && h.providers.vision)}
        ${row('Assistant (Groq)', h.providers && h.providers.chat)}
        ${row('Payments (Razorpay)', h.providers && h.providers.payments)}
      </div>
      ${h.providers && h.providers.payments && h.providers.payments.persistence === 'missing'
        ? notice(`Payments can be taken but not stored: subscription state lives in each browser, which a payment webhook
            cannot reach. Activating paid plans automatically needs a database. See <code>api/billing/webhook.js</code>.`, 'amber', 'ℹ️') : ''}
    </div>` : '<p class="t-sm muted mt-3">Not tested yet.</p>'}
  </section>`;
}
A.saveApiBase = async () => {
  const el = $('[data-input="api_base"]');
  const val = (el && el.value || '').trim();
  if (val && !/^https?:\/\//i.test(val)) return toast('The address must start with http:// or https://', 'warn');
  Api.setBase(val);
  toast(val ? 'Backend address saved' : 'Using a same-origin backend');
  await A.testApi();
};
A.testApi = async () => {
  toast('Testing the backend…');
  Api.reset(); Billing.reset();
  const res = await Api.get('health?probe=1', { timeout: 15000 });
  View.healthSnapshot = res.ok && res.data && res.data.providers
    ? Object.assign({ ok: true }, res.data)
    : { ok: false, error: res.error, providers: null };
  Api.reset();
  Chat.ready = null; View.scanReady = null;
  Router.render();
  toast(View.healthSnapshot.ok ? 'Backend reachable' : 'Backend not reachable', View.healthSnapshot.ok ? 'ok' : 'err');
};

A.saveProfile = () => {
  const get = n => { const el = $('[data-input="' + n + '"]'); return el ? el.value.trim() : ''; };
  const phone = get('pf_phone'), pin = get('pf_pin'), name = get('pf_name');
  if (!name) return toast('Name cannot be empty', 'warn');
  if (phone && !isPhone(phone)) return toast('Enter a valid 10-digit mobile number', 'warn');
  if (pin && !isPin(pin)) return toast('Enter a valid 6-digit pin code', 'warn');
  try {
    Auth.updateProfile({ name, phone, locality: get('pf_locality'), pin });
    const v = myVendor();
    if (v) { v.name = name; saveDB(); }
    Router.render(); toast('Profile updated');
  } catch (e) { toast(e.message, 'err'); }
};
A.changePassword = async () => {
  const cur = $('[data-input="cp_cur"]'), next = $('[data-input="cp_new"]');
  if (!cur || !next) return;
  const problem = passwordProblem(next.value);
  if (problem) { next.focus(); return toast(problem, 'warn'); }
  try {
    await Auth.changePassword(cur.value, next.value);
    cur.value = ''; next.value = '';
    toast('Password updated');
  } catch (e) { toast(e.message, 'err'); }
};
A.resetDemo = async () => {
  if (!(await confirmDialog({ title: 'Reset demo data?',
    body: 'Sample listings, lots, orders and rates go back to their starting state. Accounts and passwords are kept.',
    confirmLabel: 'Reset', danger: true }))) return;
  resetDB();
  Router.render(); toast('Demo data reset');
};

/* ---------- photo input binding (used by the sell form) ---------- */
function bindPhotoInput() {
  const drop = $('.drop'), input = $('#photoInput');
  if (!drop || !input) return;
  input.onchange = () => { if (input.files && input.files[0]) readPhoto(input.files[0]); };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readPhoto(file);
  });
}
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
function readPhoto(file) {
  if (!file.type || file.type.indexOf('image/') !== 0) return toast('That file is not an image', 'warn');
  if (file.size > MAX_PHOTO_BYTES) return toast('Image is larger than 8 MB — please choose a smaller photo', 'warn');
  const reader = new FileReader();
  reader.onerror = () => toast('Could not read that file', 'err');
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => toast('That image could not be opened', 'err');
    img.onload = () => {
      const scale = Math.min(1, 900 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      View.form.photo = c.toDataURL('image/jpeg', 0.78);
      View.scanReport = null; View.scanError = null; View.scanModel = null;
      redrawSell();
      toast('Photo added');
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
