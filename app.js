'use strict';
/* ScrapDaddy / ScrapHub — four-portal circular-economy marketplace (demo, no backend).
   State lives in localStorage; every portal reads the same shared state. */

// ---------- reference data ----------
const KEY = 'scrapdaddy.v2';
const CATS = {
  metals:   { label: 'Metals',               icon: '🔩', gst: 18, hsn: '7204–7404', co2: 2.6, kw: 'metal metals copper brass aluminium aluminum iron steel ferrous grill wiring' },
  plastics: { label: 'Plastics',             icon: '🧴', gst: 5,  hsn: '3915',      co2: 1.5, kw: 'plastic plastics pet hdpe pvc polythene bottle crate bucket' },
  paper:    { label: 'Paper & Cardboard',    icon: '📦', gst: 5,  hsn: '4707',      co2: 1.5, kw: 'paper cardboard newspaper book boxes corrugated' },
  ewaste:   { label: 'E-Waste / Appliances', icon: '❄️', gst: 18, hsn: '8549',      co2: 3.0, kw: 'e-waste ewaste appliance appliances ac refrigerator fridge electronics' },
};
const PILLS = [['all', 'All'], ['metals', 'Metals (Ferrous / Non-Ferrous)'], ['plastics', 'Plastics'], ['paper', 'Paper & Cardboard'], ['ewaste', 'High-Value Appliances / E-Waste']];
const RATE_DEFS = [
  ['copper', 'Copper scrap', 850, '/kg'], ['brass', 'Brass scrap', 480, '/kg'], ['aluminium', 'Aluminium scrap', 185, '/kg'],
  ['iron', 'Heavy/Light iron & steel (₹26–₹48)', 37, '/kg'], ['plastic', 'Hard plastic / PET (₹12–₹18)', 15, '/kg'],
  ['paper', 'Newspaper & office paper', 14, '/kg'], ['cardboard', 'Cardboard boxes', 8, '/kg'],
  ['ac', 'Split AC (copper coil, 1.5 ton)', 5800, '/piece'], ['fridge', 'End-of-life refrigerator', 750, '/piece'],
];
const MATERIALS = { // specific materials per category -> rate key
  metals: [['copper', 'Copper'], ['brass', 'Brass'], ['aluminium', 'Aluminium'], ['iron', 'Iron & steel']],
  plastics: [['plastic', 'Hard plastic / PET / HDPE / PVC']],
  paper: [['paper', 'Newspaper & office paper'], ['cardboard', 'Cardboard boxes']],
  ewaste: [['ac', 'Split AC (per piece)'], ['fridge', 'Refrigerator (per piece)']],
};
const PIECE_KG = { ac: 38, fridge: 45 };
const SCAN_PRESETS = [
  { cat: 'metals', key: 'copper', title: 'Copper Coil Wiring — Grade A', kg: 12 },
  { cat: 'metals', key: 'brass', title: 'Grade-A Brass Plumbing Fittings', kg: 9 },
  { cat: 'metals', key: 'aluminium', title: 'Clean Aluminium Utensils & Frames', kg: 16 },
  { cat: 'metals', key: 'iron', title: 'Mixed Mild Steel (HMS-2)', kg: 30 },
  { cat: 'plastics', key: 'plastic', title: 'Mixed PET Plastic Bottles', kg: 20 },
  { cat: 'paper', key: 'paper', title: 'Bundled Old Newspapers', kg: 25 },
  { cat: 'paper', key: 'cardboard', title: 'Corrugated Cardboard Boxes', kg: 22 },
  { cat: 'ewaste', key: 'ac', title: 'Copper Coil Split AC 1.5 Ton', kg: 1 },
  { cat: 'ewaste', key: 'fridge', title: 'End-of-Life Refrigerator', kg: 1 },
];
const SAMPLE_PHOTOS = [['🔌', 'Copper wiring', 0], ['❄️', 'Split AC', 7], ['🧴', 'PET bottles', 4], ['📰', 'Newspapers', 5]];
const STAGES = ['Listed', 'Pickup Scheduled', 'Weighed via IoT Scale', 'Consolidated at Hub', 'Dispatched to Factory'];
const PARTNERS = [['GreenEarth Recyclers Ltd.', 'CPCB-registered'], ['Bharat Circular Metals', 'HSN 72–81'], ['EcoPlast Reprocessors', 'EPR Plastics'], ['Zero-Waste RWA Alliance', '120+ societies']];
const ACCOUNTS = {
  household: { name: 'Priya Reddy', sub: 'Green Valley Apartments, Jubilee Hills', id: 'HH-20418', ico: '🏡', phone: '98•••••210' },
  vendor: { name: 'Srinivas Rao', sub: 'Hub #04 · Kukatpally Eco-Station', id: 'v1', ico: '🛺', phone: '99•••••447' },
  factory: { name: 'GreenEarth Recyclers Ltd.', sub: 'Procurement · Patancheru Industrial Area', id: 'F-0091', ico: '🏭', phone: 'GSTIN 36AAACG1234F1Z5' },
  admin: { name: 'Platform Admin', sub: 'ScrapDaddy Operations', id: 'ADM-01', ico: '🛡️', phone: 'ops@scrapdaddy.in' },
};
const ROLE_LABEL = { household: 'Household Seller', vendor: 'Local Vendor Hub', factory: 'Factory Buyer', admin: 'Platform Admin' };
const ROLE_BLURB = {
  household: 'Photograph your scrap, get an instant rate estimate and a free pickup — or list bulk lots for bidding.',
  vendor: 'Find nearby pickups by material, verify weights on a Bluetooth scale and consolidate hub lots.',
  factory: 'Source consolidated multi-tonne lots or direct bulk lots with GST and EPR paperwork built in.',
  admin: 'Monitor every transaction, escrow payout, GST/HSN compliance and EPR credit in one place.',
};

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
const num = n => (+n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });
function svgPhoto(emoji, c1, c2) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="480" height="300" fill="url(#g)"/><circle cx="410" cy="50" r="70" fill="#fff" opacity=".35"/><text x="240" y="190" font-size="130" text-anchor="middle">${emoji}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}
const PH = {
  metals: svgPhoto('🔌', '#FEF9C3', '#FDE68A'), ac: svgPhoto('❄️', '#DBEAFE', '#BFDBFE'), steel: svgPhoto('🚪', '#E5E7EB', '#D1D5DB'),
  pet: svgPhoto('🧴', '#DCFCE7', '#BBF7D0'), crates: svgPhoto('🧺', '#FFEDD5', '#FED7AA'), paper: svgPhoto('📰', '#FEF9C3', '#FEF08A'), bale: svgPhoto('🏗️', '#DCFCE7', '#86EFAC'),
  fridge: svgPhoto('🧊', '#DBEAFE', '#BFDBFE'),
};

// ---------- state ----------
function seed() {
  const L = (o) => Object.assign({ source: 'household', owner: 'other', mode: 'fixed', stage: 0, bids: [], vendor: null, co2: 0, created: Date.now() - Math.random() * 6e8, slot: 'Tomorrow, 10am–1pm' }, o);
  return {
    rates: Object.fromEntries(RATE_DEFS.map(r => [r[0], r[2]])),
    listings: [
      L({ id: 'L1', owner: 'me', cat: 'metals', rk: 'copper', title: 'Old Copper Wiring & Brass Plumbing Fittings', desc: 'Stripped copper wire bundles and brass taps, no plastic coating.', kg: 14, ask: 8900, mode: 'bid', locality: 'Green Valley Apartments, Jubilee Hills', pin: '500033', photo: PH.metals, co2: 42, bids: [{ vendor: 'v2', name: 'Fatima Begum', amount: 8450 }] }),
      L({ id: 'L2', cat: 'metals', appliance: true, rk: 'ac', title: '1.5 Ton Dismantled Split AC (100% Copper Coil) + Iron Stand', desc: 'Working-age AC, dismantled. Indoor + outdoor unit.', kg: 38, unit: '1 unit', ask: 6200, mode: 'bid', locality: 'EcoNest Residency, Gachibowli', pin: '500032', photo: PH.ac, co2: 115 }),
      L({ id: 'L3', cat: 'metals', rk: 'iron', title: 'Household Mild Steel Gate Grill & Aluminium Utensils', desc: 'Rusted gate grill plus old aluminium vessels.', kg: 28, ask: 1450, locality: 'Sunshine Villa #12, Banjara Hills', pin: '500034', photo: PH.steel, co2: 58 }),
      L({ id: 'L4', cat: 'plastics', rk: 'plastic', title: 'Segregated Clean PET Bottles & HDPE Detergent Containers', desc: 'Rinsed, caps removed, bagged.', kg: 22, ask: 350, locality: 'Lotus Zero-Waste RWA Society, Kondapur', pin: '500084', photo: PH.pet, co2: 33, source: 'rwa' }),
      L({ id: 'L5', cat: 'plastics', rk: 'plastic', title: 'Heavy Duty Plastic Crates, Buckets & PVC Pipes', desc: 'Hard plastic, mixed colours.', kg: 35, ask: 490, locality: 'Shanti Niketan Homes, Madhapur', pin: '500081', photo: PH.crates, co2: 52 }),
      L({ id: 'L6', owner: 'me', cat: 'paper', rk: 'paper', title: 'Bundled Old Newspapers, Textbooks & Amazon Corrugated Boxes', desc: 'Dry, tied bundles.', kg: 45, ask: 540, locality: 'Green Meadows Flat 402, Miyapur', pin: '500049', photo: PH.paper, co2: 67 }),
      L({ id: 'L7', cat: 'ewaste', appliance: true, rk: 'fridge', title: 'End-of-Life Double-Door Refrigerator', desc: 'Not working; compressor intact.', kg: 45, unit: '1 unit', ask: 750, locality: 'Rainbow Residency, Kukatpally', pin: '500072', photo: PH.fridge, co2: 135 }),
      L({ id: 'L8', cat: 'metals', rk: 'aluminium', title: 'Bulk Aluminium Window Frames — RWA Renovation Clearance', desc: 'Society renovation, ~120 kg. Bids invited.', kg: 120, ask: 21000, mode: 'bid', locality: 'Lakeview Towers RWA, Hitech City', pin: '500081', photo: svgPhoto('🪟', '#E0F2FE', '#BAE6FD'), co2: 312, source: 'rwa' }),
      // historical pipeline rows so Admin has a live ledger
      L({ id: 'L9', cat: 'metals', rk: 'copper', title: 'Copper Motor Windings', kg: 8, ask: 6500, finalPrice: 6460, locality: 'Sai Residency, Ameerpet', pin: '500016', photo: PH.metals, co2: 21, stage: 1, vendor: 'v2', scaleKg: null }),
      L({ id: 'L10', cat: 'plastics', rk: 'plastic', title: 'Segregated HDPE Drums', kg: 60, ask: 900, finalPrice: 870, locality: 'Aditya Enclave, Begumpet', pin: '500016', photo: PH.crates, co2: 90, stage: 2, vendor: 'v1', scaleKg: 58 }),
      L({ id: 'L11', cat: 'metals', rk: 'iron', title: 'Mixed HMS Iron — Cluster Pickup', kg: 410, ask: 15200, finalPrice: 15190, locality: 'Kukatpally Housing Board', pin: '500072', photo: PH.steel, co2: 1066, stage: 3, vendor: 'v1', scaleKg: 410, hubName: 'Hub #04' }),
      L({ id: 'L12', cat: 'paper', rk: 'cardboard', title: 'Corrugated Cardboard Bales', kg: 800, ask: 6400, finalPrice: 6400, locality: 'Madhapur Cluster', pin: '500081', photo: PH.paper, co2: 1200, stage: 4, vendor: 'v2', scaleKg: 800, hubName: 'Hub #07', inLot: true }),
    ],
    lots: [
      { id: 'H4', hub: 'Hub #04 — Kukatpally Eco-Station', vendor: 'v1', cat: 'metals', title: 'Hydraulically Baled HMS-1 Iron & Copper Scrap', kg: 4200, hsn: '7204 / 7404', price: 482000, locality: 'Kukatpally', pin: '500072', co2: 10920, epr: true, stage: 0, members: [], photo: PH.bale },
      { id: 'H7', hub: 'Hub #07 — Madhapur Station', vendor: 'v2', cat: 'plastics', title: 'Baled HDPE / PET Plastic, Washed & Segregated', kg: 6500, hsn: '3915', price: 99000, locality: 'Madhapur', pin: '500081', co2: 9750, epr: true, stage: 0, members: [], photo: svgPhoto('♻️', '#DCFCE7', '#86EFAC') },
      { id: 'H2', hub: 'Hub #02 — Secunderabad Yard', vendor: 'v2', cat: 'paper', title: 'Cardboard & Kraft Paper Bales (Kraft-mill grade)', kg: 8200, hsn: '4707', price: 90200, locality: 'Secunderabad', pin: '500003', co2: 12300, epr: true, stage: 0, members: [], photo: PH.paper },
      { id: 'H9', hub: 'Hub #09 — Uppal Metals Yard', vendor: 'v1', cat: 'metals', title: 'Aluminium & Brass Segregated Lot', kg: 950, hsn: '7602 / 7402', price: 281500, locality: 'Uppal', pin: '500039', co2: 2470, epr: true, stage: 0, members: [], photo: svgPhoto('🔧', '#FEF9C3', '#FDE68A') },
      { id: 'H11', hub: 'Hub #11 — Medchal E-Waste Desk', vendor: 'v1', cat: 'ewaste', appliance: true, title: 'Dismantled AC Compressors, Coils & PCBs', kg: 1400, hsn: '8549', price: 98000, locality: 'Medchal', pin: '501401', co2: 4200, epr: true, stage: 0, members: [], photo: PH.ac },
    ],
    orders: [], vendors: [
      { id: 'v1', name: 'Srinivas Rao', hub: 'Hub #04 Kukatpally', verified: true }, { id: 'v2', name: 'Fatima Begum', hub: 'Hub #07 Madhapur', verified: true },
      { id: 'v3', name: 'Mohd Irfan', hub: 'Hub #12 Uppal', verified: false }, { id: 'v4', name: 'Lakshmi Devi', hub: 'Hub #13 LB Nagar', verified: false },
    ],
    seq: 100,
  };
}
let S, UI;
try { const raw = JSON.parse(localStorage.getItem(KEY)); S = raw && raw.S; UI = raw && raw.UI; } catch {}
S = S || seed();
S.lots.forEach(l => { l.source = 'hub'; });
const freshF = () => ({ q: '', cat: 'all', loc: '', min: 0, src: 'all' });
UI = Object.assign({ role: null, tab: {}, f: {}, form: null, scan: null, rates: false }, UI || {});
UI.f = Object.assign({ household: freshF(), vendor: freshF(), factory: Object.assign(freshF(), { src: 'hub' }), admin: freshF() }, UI.f || {});
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ S, UI: { role: UI.role, tab: UI.tab, f: UI.f } })); }
  catch { toast('Storage is full — a large photo could not be saved', 'warn'); }
}
const newId = p => p + (++S.seq);
const rateOf = k => S.rates[k] ?? 0;
const vendorName = id => (S.vendors.find(v => v.id === id) || {}).name || '—';
const ME = 'me';

function blankForm() { return { cat: 'metals', rk: 'copper', title: '', desc: '', qty: '', unit: 'kg', mode: 'fixed', ask: '', locality: '', pin: '', slot: 'Tomorrow, 10am–1pm', photo: '' }; }
UI.form = UI.form || blankForm();
function estimate(f) {
  const q = +f.qty || 0;
  if (f.unit === 'pieces' || PIECE_KG[f.rk] && f.unit !== 'kg') return q * rateOf(f.rk);
  return q * rateOf(f.rk);
}
const kgOf = f => (f.unit === 'pieces' ? (+f.qty || 0) * (PIECE_KG[f.rk] || 1) : (+f.qty || 0));

// ---------- toast / modal ----------
function toast(msg, kind) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  if (kind === 'warn') t.style.borderLeftColor = '#EAB308';
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3200);
}
const openModal = html => { const m = $('#modal'); m.innerHTML = `<div class="box">${html}</div>`; m.hidden = false; };
const closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; };

// ---------- filtering ----------
function matchesCat(it, c) { return c === 'all' || it.cat === c || (c === 'ewaste' && it.appliance); }
function matchesQuery(it, q) {
  q = q.trim().toLowerCase(); if (!q) return true;
  const hay = [it.title, it.desc, it.cat, CATS[it.cat].label, CATS[it.cat].kw, it.locality, it.hub, it.hsn, it.appliance ? 'appliance e-waste' : ''].join(' ').toLowerCase();
  const words = hay.split(/[^a-z0-9\-]+/);
  return q.split(/\s+/).every(t => (t.length <= 2 ? words.includes(t) : hay.includes(t)));
}
function applyFilters(items, f) {
  return items.filter(it => matchesCat(it, f.cat) && matchesQuery(it, f.q)
    && (!f.loc.trim() || (it.locality + ' ' + it.pin).toLowerCase().includes(f.loc.trim().toLowerCase()))
    && it.kg >= (+f.min || 0)
    && (f.src === 'all' || (f.src === 'hub' ? it.source === 'hub' : it.source !== 'hub')));
}
function filterBar(portal, { srcMode = 'select', placeholder } = {}) {
  const f = UI.f[portal];
  const src = srcMode === 'seg'
    ? `<div><label>Source</label><div class="seg"><button data-act="setSrc" data-v="hub" class="${f.src === 'hub' ? 'on' : ''}">Local Vendor Hub Stations</button><button data-act="setSrc" data-v="household" class="${f.src === 'household' ? 'on' : ''}">Residential / RWA</button></div></div>`
    : srcMode === 'none' ? ''
    : `<div><label>Source type</label><select data-f="src"><option value="all">All sources</option><option value="household" ${f.src === 'household' ? 'selected' : ''}>Residential Household</option><option value="hub" ${f.src === 'hub' ? 'selected' : ''}>Local Vendor Hub Station</option></select></div>`;
  return `<div class="fbar" data-portal="${portal}">
    <div class="row1"><div class="search"><input data-f="q" type="search" placeholder="${esc(placeholder || 'Search: metals, copper, plastics, paper, AC…')}" value="${esc(f.q)}" aria-label="Search materials"></div></div>
    <div class="pills">${PILLS.map(([k, l]) => `<button class="pill ${f.cat === k ? 'on' : ''}" data-act="setCat" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="opts"><div><label>Pin code / locality</label><input data-f="loc" placeholder="e.g. 500072 or Madhapur" value="${esc(f.loc)}"></div>
    <div><label>Minimum weight (kg)</label><input data-f="min" type="number" min="0" placeholder="0" value="${f.min || ''}"></div>${src}</div></div>`;
}

// ---------- cards ----------
function priceBreak(it) {
  const c = CATS[it.cat], gst = c.gst, taxable = it.finalPrice || it.price || it.ask, g = taxable * gst / 100, tcs = taxable * 0.02;
  return `<div class="gst"><div><span>Taxable value (HSN ${esc(it.hsn || c.hsn)})</span><span>${inr(taxable)}</span></div>
    <div><span>GST @ ${gst}%${gst === 18 && it.cat !== 'ewaste' ? ' · RCM on unregistered purchase' : ''}</span><span>${inr(g)}</span></div>
    <div><span>TCS @ 2%</span><span>${inr(tcs)}</span></div><div class="t"><span>Payable via escrow</span><span>${inr(taxable + g + tcs)}</span></div></div>`;
}
function track(stage) { return `<div class="track" title="${STAGES[stage]}">${STAGES.map((_, i) => `<i class="${i <= stage ? 'on' : ''}"></i>`).join('')}</div><div class="sm-t mute">${STAGES[stage]}</div>`; }
function itemTags(it) {
  const c = CATS[it.cat];
  return `<div class="meta"><span class="tag">${c.icon} ${c.label}</span>${it.source === 'hub' ? '<span class="tag b">🏭 Vendor Hub Lot</span>' : it.source === 'rwa' ? '<span class="tag y">🏘️ RWA Society</span>' : '<span class="tag y">🏡 Household</span>'}${it.mode === 'bid' ? '<span class="tag o">Bid mode</span>' : ''}${it.epr ? '<span class="tag">EPR traceable</span>' : ''}</div>`;
}
function listingCard(it, role) {
  const hub = it.source === 'hub';
  const priceLbl = hub ? 'Lot price' : it.mode === 'bid' ? 'Ask price' : 'Fixed rate';
  const price = hub ? it.price : it.ask;
  let acts = '', extra = '';
  const bids = it.bids || [];
  if (role === 'vendor' && !hub) {
    const mine = bids.find(b => b.vendor === 'v1');
    acts = `<button class="btn ghost sm" data-act="call" data-id="${it.id}">📞 Call Resident via Masked Hub Line</button>
      <div class="bidrow">${it.mode === 'bid' ? `<input id="bid-${it.id}" type="number" min="1" placeholder="Your bid ₹" value="${mine ? mine.amount : ''}"><button class="btn amber sm" data-act="bid" data-id="${it.id}">Place Bid</button>` : ''}</div>
      <button class="btn sm" data-act="claim" data-id="${it.id}">Accept Pickup at ${inr(it.ask)}</button>`;
    extra = bids.length ? `<div class="sm-t mute">${bids.length} bid(s) · top ${inr(Math.max(...bids.map(b => b.amount)))}${mine ? ' · yours ' + inr(mine.amount) : ''}</div>` : '';
  } else if (role === 'vendor' && hub) {
    acts = `<span class="sm-t mute">Peer hub lot (${esc(vendorName(it.vendor))}) — view only</span>`;
  } else if (role === 'factory') {
    extra = priceBreak(it);
    acts = `<button class="btn sm" data-act="order" data-id="${it.id}" data-kind="${hub ? 'lot' : 'direct'}">${hub ? 'Place Offtake Order' : 'Order Direct Pickup'}</button><button class="btn ghost sm" data-act="certPreview" data-id="${it.id}" data-kind="${hub ? 'lot' : 'direct'}">📜 EPR Certificate Preview</button>`;
  }
  return `<article class="card hov lc"><img class="ph" src="${esc(it.photo)}" alt="${esc(it.title)}" loading="lazy">
    <div class="body">${itemTags(it)}<h3>${esc(it.title)}</h3>
      <div class="mute sm-t">📍 ${esc(hub ? it.hub : it.locality)} · ${esc(it.pin)}${!hub ? ' · 🕒 ' + esc(it.slot) : ''}</div>
      <div class="meta"><span class="tag b">⚖️ ${it.unit ? esc(it.unit) + ' (' + num(it.kg) + ' kg)' : num(it.kg) + ' kg'}</span><span class="tag">🌱 ${num(it.co2)} kg CO₂ saved</span></div>
      <div class="price">${inr(price)} <small>${priceLbl}${hub ? ' · ' + num(it.kg / 1000) + ' t' : ''}</small></div>${extra}
      <div class="acts">${acts}</div></div></article>`;
}

// ---------- views ----------
function counters() {
  const done = S.listings.filter(l => l.stage >= 2), kg = 62450 + done.reduce((s, l) => s + (l.scaleKg || l.kg), 0);
  const co2 = 184 + S.listings.filter(l => l.stage >= 2).reduce((s, l) => s + l.co2, 0) / 1000;
  const hubs = 85 + S.vendors.filter(v => v.verified).length - 2;
  const hh = 1240 + S.listings.filter(l => l.owner === ME).length - 2;
  return [[kg, 'kg Diverted from Landfills', '♻️'], [hh, 'Green Households', '🏡'], [hubs, 'Verified Local Hubs', '🛺'], [co2, 'Tonnes CO₂ Saved', '🌍']];
}
function viewHome() {
  const c = counters();
  return `<section class="hero"><div class="leaf">🌿</div><h1>Sell scrap. <em>Earn fair prices.</em> Save the planet.</h1>
    <p>India's managed circular-economy marketplace — households, verified kabadiwala hubs and recycling factories on one transparent platform with digital scales, escrow payouts and EPR-ready paperwork.</p>
    <div class="counters">${c.map(([n, l, e], i) => `<div class="counter"><b data-count="${n}" data-dec="${i === 3 ? 0 : 0}">0</b><span>${e} ${l}</span></div>`).join('')}</div></section>
    <section class="section"><h2>Choose your portal</h2><p class="sub">One click logs you in with a pre-filled demo account. You can switch portals any time from the top bar.</p>
    <div class="grid">${Object.keys(ACCOUNTS).map(r => { const a = ACCOUNTS[r]; return `<div class="card hov gate" data-act="login" data-role="${r}" tabindex="0" role="button" aria-label="Log in as ${ROLE_LABEL[r]}">
      <div class="ico">${a.ico}</div><h3>${ROLE_LABEL[r]}</h3><div class="mute sm-t">${ROLE_BLURB[r]}</div>
      <div class="acct"><b>${esc(a.name)}</b><br>${esc(a.sub)}<br>ID ${esc(a.id)} · ${esc(a.phone)}</div>
      <button class="btn block" data-act="login" data-role="${r}">Demo Login →</button></div>`; }).join('')}</div></section>
    <section class="section"><h2>How ScrapDaddy works</h2><p class="sub">Zero-fee for households. Every kilo weighed, paid and traced.</p>
    <div class="grid">${[['📸', 'Snap & list', 'Photo your scrap, AI-scan estimates the grade, weight and price.'], ['🛺', 'Verified pickup', 'An Aadhaar-verified vendor arrives with a calibrated Bluetooth scale.'], ['🏭', 'Hub consolidation', 'Vendors bale material at local stations into multi-tonne lots.'], ['📜', 'Factory & EPR', 'Mills buy graded lots with GST invoices and CPCB EPR certificates.']].map(([e, t, d]) => `<div class="card step"><div class="e">${e}</div><h3>${t}</h3><div class="mute sm-t">${d}</div></div>`).join('')}</div></section>
    <section class="section"><h2>Supporting our circular economy &amp; EPR partners</h2><p class="sub">Trusted recyclers and communities on the network.</p>
    <div class="partners">${PARTNERS.map(([n, b]) => `<div class="partner">🌿 ${n}<i>${b}</i></div>`).join('')}</div></section>`;
}
function head(role) {
  const a = ACCOUNTS[role];
  return `<div class="pagehead"><div><h2>${a.ico} ${ROLE_LABEL[role]} portal</h2><div class="mute sm-t">${ROLE_BLURB[role]}</div></div>
    <div class="who"><div class="av">${a.ico}</div><div><b>${esc(a.name)}</b><div class="sm-t mute">${esc(a.sub)}</div></div></div></div>`;
}
const tabsBar = (role, list) => { const cur = UI.tab[role] || list[0][0]; return `<div class="tabs">${list.map(([k, t]) => `<button class="${k === cur ? 'on' : ''}" data-act="tab" data-v="${k}">${t}</button>`).join('')}</div>`; };
const curTab = (role, d) => UI.tab[role] || d;
const resultsWrap = (id, inner) => `<div id="${id}">${inner}</div>`;

// --- household
function formHtml() {
  const f = UI.form, est = estimate(f), kg = kgOf(f), mats = MATERIALS[f.cat];
  const photo = f.photo ? `<div class="preview"><img src="${esc(f.photo)}" alt="Scrap photo preview"><button class="btn ghost sm x" data-act="rmPhoto">✕ Remove</button></div>
      <div class="acts" style="margin-top:8px"><button class="btn amber sm" data-act="scan" ${UI.scan === 'busy' ? 'disabled' : ''}>${UI.scan === 'busy' ? '<span class="spin"></span> Scanning…' : '✨ Simulate AI Photo Scan'}</button></div>`
    : `<label class="drop" id="drop">📷 Click to upload, drag &amp; drop, or take a photo<small>JPG / PNG — shown instantly</small><input id="photoIn" type="file" accept="image/*" capture="environment" hidden></label>
      <div class="sm-t mute" style="margin-top:8px">No photo handy? Try a sample:</div><div class="samples">${SAMPLE_PHOTOS.map(([e, l, i]) => `<button class="pill" data-act="samplePhoto" data-v="${i}">${e} ${l}</button>`).join('')}</div>`;
  return `<div class="grid2"><div class="card pad"><h3>1 · Photo &amp; AI grading</h3>${photo}
      ${UI.scanResult ? `<div class="scan">✅ <b>AI Scan:</b> ${esc(UI.scanResult)}</div>` : ''}</div>
    <div class="card pad"><h3>2 · Listing details</h3>
      <div class="two"><div><label>Material category</label><select data-form="cat">${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${f.cat === k ? 'selected' : ''}>${c.label}</option>`).join('')}</select></div>
      <div><label>Specific material (sets rate)</label><select data-form="rk">${mats.map(([k, l]) => `<option value="${k}" ${f.rk === k ? 'selected' : ''}>${l} — ${inr(rateOf(k))}/${PIECE_KG[k] ? 'pc' : 'kg'}</option>`).join('')}</select></div></div>
      <label>Item name</label><input data-form="title" value="${esc(f.title)}" placeholder="e.g. Old copper wiring & brass taps">
      <label>Description</label><textarea data-form="desc" placeholder="Condition, segregation, anything vendors should know">${esc(f.desc)}</textarea>
      <div class="two"><div><label>Estimated quantity</label><input data-form="qty" type="number" min="0" step="0.5" value="${esc(f.qty)}"></div>
      <div><label>Unit</label><select data-form="unit"><option value="kg" ${f.unit === 'kg' ? 'selected' : ''}>kg</option><option value="pieces" ${f.unit === 'pieces' ? 'selected' : ''}>pieces</option></select></div></div>
      <label>Pricing mode</label><div class="seg"><button data-act="mode" data-v="fixed" class="${f.mode === 'fixed' ? 'on' : ''}">Standard Fixed Daily Rate (1-Click Free Pickup)</button><button data-act="mode" data-v="bid" class="${f.mode === 'bid' ? 'on' : ''}">Ask / Bid Price</button></div>
      ${f.mode === 'bid' ? `<label>Your ask price (₹)</label><input data-form="ask" type="number" min="0" value="${esc(f.ask)}" placeholder="Bulk / high-value items only">` : ''}
      <div class="two"><div><label>Locality / address</label><input data-form="locality" value="${esc(f.locality)}" placeholder="Society, area"></div><div><label>Pin code</label><input data-form="pin" inputmode="numeric" maxlength="6" value="${esc(f.pin)}"></div></div>
      <label>Preferred pickup slot</label><select data-form="slot">${['Tomorrow, 10am–1pm', 'Tomorrow, 2pm–6pm', 'Saturday, 10am–1pm', 'Sunday, 10am–1pm'].map(s => `<option ${f.slot === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <div class="est"><span>Instant rate estimate<br><span class="sm-t mute" id="estKg">${num(kg)} kg · 🌱 ${num(kg * CATS[f.cat].co2)} kg CO₂ saved</span></span><b id="estVal">${inr(est)}</b></div>
      <button class="btn block" style="margin-top:12px" data-act="publish">Publish to Local Vendor Hub</button></div></div>`;
}
function myListingsHtml() {
  const mine = S.listings.filter(l => l.owner === ME), items = applyFilters(mine, UI.f.household);
  if (!items.length) return `<div class="empty">${mine.length ? 'No listings match your search.' : 'You have not listed anything yet — use the Sell tab.'}</div>`;
  return `<div class="count">${items.length} listing(s)</div><div class="grid">${items.map(l => {
    const bids = [...(l.bids || [])].sort((a, b) => b.amount - a.amount);
    return `<article class="card lc"><img class="ph" src="${esc(l.photo)}" alt=""><div class="body">${itemTags(l)}<h3>${esc(l.title)}</h3>
      <div class="meta"><span class="tag b">⚖️ ${num(l.kg)} kg</span><span class="tag">🌱 ${num(l.co2)} kg CO₂</span></div>
      <div class="price">${inr(l.finalPrice || l.ask)} <small>${l.finalPrice ? 'agreed' : l.mode === 'bid' ? 'ask' : 'fixed rate'}</small></div>
      ${l.stage ? track(l.stage) + `<div class="sm-t">Collected by <b>${esc(vendorName(l.vendor))}</b>${l.scaleKg ? ' · scale: ' + num(l.scaleKg) + ' kg' : ''}</div>`
        : (bids.length ? bids.map(b => `<div class="row1 sm-t" style="display:flex;justify-content:space-between;gap:6px;align-items:center"><span>${esc(b.name)} bid <b>${inr(b.amount)}</b></span><button class="btn sm" data-act="acceptBid" data-id="${l.id}" data-v="${b.vendor}">Accept</button></div>`).join('') : '<div class="sm-t mute">Waiting for vendors in your area…</div>')}
      ${l.stage === 0 ? `<div class="acts"><button class="btn ghost sm" data-act="delListing" data-id="${l.id}">Remove listing</button></div>` : ''}</div></article>`;
  }).join('')}</div>`;
}
function viewHousehold() {
  const t = curTab('household', 'sell'), mine = S.listings.filter(l => l.owner === ME);
  const co2 = mine.filter(l => l.stage >= 2).reduce((s, l) => s + l.co2, 0), earned = mine.filter(l => l.stage >= 2).reduce((s, l) => s + (l.finalPrice || 0), 0);
  let h = head('household') + tabsBar('household', [['sell', '📸 Sell scrap'], ['mine', `📋 My listings (${mine.length})`], ['impact', '🌍 My impact']]);
  if (t === 'sell') h += `<div id="formWrap">${formHtml()}</div>`;
  else if (t === 'mine') h += filterBar('household', { srcMode: 'none', placeholder: 'Search your listings…' }) + resultsWrap('results', myListingsHtml());
  else h += `<div class="kpis"><div class="card kpi"><div class="e">💰</div><b>${inr(earned)}</b><span>Paid out to you</span></div><div class="card kpi"><div class="e">🌱</div><b>${num(co2)} kg</b><span>CO₂ saved</span></div><div class="card kpi"><div class="e">📋</div><b>${mine.length}</b><span>Listings</span></div></div>`;
  return h;
}

// --- vendor
function vendorOpenHtml() {
  const open = [...S.listings.filter(l => l.stage === 0), ...S.lots.filter(l => l.stage === 0)], items = applyFilters(open, UI.f.vendor);
  return `<div class="count">${items.length} result(s)</div>` + (items.length ? `<div class="grid">${items.map(i => listingCard(i, 'vendor')).join('')}</div>` : '<div class="empty">No listings match. Try “metals”, “plastics” or clear the filters.</div>');
}
function vendorMineHtml() {
  const mine = S.listings.filter(l => l.vendor === 'v1' && l.stage >= 1 && l.stage <= 3);
  if (!mine.length) return '<div class="empty">No active pickups. Accept one from “Find pickups”.</div>';
  return `<div class="grid">${mine.map(l => `<article class="card lc"><img class="ph" src="${esc(l.photo)}" alt=""><div class="body">${itemTags(l)}<h3>${esc(l.title)}</h3>
    <div class="mute sm-t">📍 ${esc(l.locality)} · ${esc(l.slot)}</div>${track(l.stage)}
    <div class="price">${inr(l.finalPrice)} <small>${l.scaleKg ? 'scale-verified ' + num(l.scaleKg) + ' kg' : 'est. ' + num(l.kg) + ' kg'}</small></div>
    <div class="acts"><button class="btn ghost sm" data-act="call" data-id="${l.id}">📞 Masked call</button>
    ${l.stage === 1 ? `<button class="btn amber sm" data-act="scale" data-id="${l.id}">⚖️ Verify with Bluetooth Digital Scale</button>` : ''}
    ${l.stage === 2 ? `<button class="btn sm" data-act="toHub" data-id="${l.id}">Add to Local Hub Inventory</button>` : ''}
    ${l.stage === 3 ? '<span class="tag">In your hub inventory</span>' : ''}</div></div></article>`).join('')}</div>`;
}
function vendorHubHtml() {
  const inv = S.listings.filter(l => l.vendor === 'v1' && l.stage === 3 && !l.inLot), by = {};
  inv.forEach(l => (by[l.cat] ||= []).push(l));
  const myLots = S.lots.filter(l => l.vendor === 'v1');
  let h = '<div class="card pad"><h3>Hub #04 · Kukatpally Eco-Station — inventory</h3><div class="sm-t mute">Demo threshold for publishing a lot is 50 kg; real lots are 5–15 tonnes.</div>';
  h += Object.keys(by).length ? `<div class="tw"><table><tr><th>Category</th><th class="n">Pickups</th><th class="n">Weight (kg)</th><th class="n">Value</th><th></th></tr>${Object.entries(by).map(([c, ls]) => { const kg = ls.reduce((s, l) => s + (l.scaleKg || l.kg), 0), val = ls.reduce((s, l) => s + l.finalPrice, 0); return `<tr><td>${CATS[c].icon} ${CATS[c].label}</td><td class="n">${ls.length}</td><td class="n">${num(kg)}</td><td class="n">${inr(val)}</td><td class="n"><button class="btn sm" data-act="consolidate" data-v="${c}" ${kg < 50 ? 'disabled title="Below 50 kg demo threshold"' : ''}>Consolidate &amp; publish lot</button></td></tr>`; }).join('')}</table></div>` : '<div class="empty" style="margin-top:10px">Inventory is empty. Weigh a pickup, then add it to the hub.</div>';
  h += '</div><div class="section"><h3>My published lots</h3></div>';
  h += myLots.length ? `<div class="grid" style="margin-top:10px">${myLots.map(l => `<article class="card lc"><img class="ph" src="${esc(l.photo)}" alt=""><div class="body">${itemTags(Object.assign({ source: 'hub' }, l))}<h3>${esc(l.title)}</h3><div class="price">${inr(l.price)} <small>${num(l.kg)} kg</small></div><span class="tag ${l.stage === 4 ? '' : 'y'}">${l.stage === 4 ? 'Sold to factory' : 'Live on factory marketplace'}</span></div></article>`).join('')}</div>` : '<div class="empty" style="margin-top:10px">No lots yet.</div>';
  return h;
}
function viewVendor() {
  const t = curTab('vendor', 'find'), n = S.listings.filter(l => l.vendor === 'v1' && l.stage >= 1 && l.stage <= 3).length;
  let h = head('vendor') + tabsBar('vendor', [['find', '🔎 Find pickups'], ['mine', `🛺 My pickups (${n})`], ['hub', '🏭 Hub inventory']]);
  if (t === 'find') h += filterBar('vendor') + resultsWrap('results', vendorOpenHtml());
  else if (t === 'mine') h += vendorMineHtml(); else h += vendorHubHtml();
  return h;
}

// --- factory
function factoryResultsHtml() {
  const open = [...S.lots.filter(l => l.stage === 0), ...S.listings.filter(l => l.stage === 0)], items = applyFilters(open, UI.f.factory);
  const f = UI.f.factory;
  return `<div class="count">${items.length} ${f.src === 'hub' ? 'consolidated vendor station lot(s)' : 'direct residential / RWA listing(s)'}</div>` + (items.length ? `<div class="grid">${items.map(i => listingCard(i, 'factory')).join('')}</div>` : '<div class="empty">No lots match your filters.</div>');
}
function ordersHtml() {
  if (!S.orders.length) return '<div class="empty">No orders yet. Place an offtake order from the marketplace.</div>';
  return `<div class="card"><div class="tw"><table><tr><th>Order</th><th>Material</th><th class="n">Weight</th><th class="n">Taxable</th><th class="n">GST</th><th>Status</th><th>Certificate</th></tr>${S.orders.map(o => `<tr><td>${o.id}</td><td>${esc(o.title)}</td><td class="n">${num(o.kg)} kg</td><td class="n">${inr(o.taxable)}</td><td class="n">${inr(o.gst)} (${o.gstPct}%)</td><td><span class="badge b-4">Dispatched to Factory</span></td><td><button class="btn ghost sm" data-act="cert" data-id="${o.id}">📜 View / Download</button></td></tr>`).join('')}</table></div></div>`;
}
function viewFactory() {
  const t = curTab('factory', 'market');
  let h = head('factory') + tabsBar('factory', [['market', '🏭 Marketplace'], ['orders', `📦 Orders (${S.orders.length})`]]);
  if (t === 'market') h += filterBar('factory', { srcMode: 'seg', placeholder: 'Search: metals, plastics, paper, e-waste…' }) + resultsWrap('results', factoryResultsHtml());
  else h += ordersHtml();
  return h;
}

// --- admin
function ledgerRows() {
  const rows = S.listings.filter(l => l.stage >= 1 && !(l.stage === 4 && l.inLot)).map(l => ({ id: l.id, cat: l.cat, appliance: l.appliance, title: l.title, kg: l.scaleKg || l.kg, parties: `${l.owner === ME ? 'Priya R.' : 'Resident'} → ${vendorName(l.vendor)}${l.stage === 4 ? ' → Factory' : ''}`, value: l.finalPrice || l.ask, stage: l.stage, locality: l.locality, pin: l.pin, source: 'household', hsn: CATS[l.cat].hsn, gst: CATS[l.cat].gst }));
  S.orders.filter(o => o.kind === 'lot').forEach(o => rows.push({ id: o.id, cat: o.cat, appliance: o.appliance, title: o.title, kg: o.kg, parties: `${vendorName(o.vendor)} → ${o.factory}`, value: o.taxable, stage: 4, locality: o.locality, pin: o.pin, source: 'hub', hsn: o.hsn, gst: o.gstPct }));
  return rows;
}
const escrowOf = s => s <= 1 ? ['Not funded', 'b-0'] : s === 4 ? ['Released', 'b-4'] : ['Held in escrow', 'b-1'];
function ledgerHtml() {
  const rows = applyFilters(ledgerRows(), UI.f.admin);
  return `<div class="count">${rows.length} transaction(s)</div><div class="card"><div class="tw"><table><tr><th>ID</th><th>Material</th><th class="n">kg</th><th>Chain</th><th class="n">Value</th><th>Escrow</th><th>Status</th></tr>
    ${rows.map(r => `<tr><td>${r.id}</td><td>${CATS[r.cat].icon} ${esc(r.title)}</td><td class="n">${num(r.kg)}</td><td>${esc(r.parties)}</td><td class="n">${inr(r.value)}</td><td><span class="badge ${escrowOf(r.stage)[1]}">${escrowOf(r.stage)[0]}</span></td><td><span class="badge b-${r.stage}">${STAGES[r.stage]}</span></td></tr>`).join('') || '<tr><td colspan="7" class="mute">No transactions match.</td></tr>'}</table></div></div>`;
}
function viewAdmin() {
  const t = curTab('admin', 'over'), rows = ledgerRows();
  let h = head('admin') + tabsBar('admin', [['over', '📊 Overview'], ['vendors', '🛺 Vendors'], ['comp', '🧾 GST & EPR'], ['rates', '💹 Live rates']]);
  if (t === 'over') {
    const gmv = 4218600 + rows.reduce((s, r) => s + r.value, 0), co2 = 184000 + S.listings.filter(l => l.stage >= 2).reduce((s, l) => s + l.co2, 0) + S.orders.filter(o => o.kind === 'lot').reduce((s, o) => s + o.co2, 0);
    h += `<div class="kpis">${[['💰', inr(gmv), 'Total GMV'], ['🏡', num(1240 + S.listings.filter(l => l.owner === ME).length - 2), 'Active Households'], ['🛺', S.vendors.filter(v => v.verified).length + 83, 'Verified Local Vendors (Aadhaar & Scale)'], ['🏭', 37 + S.orders.length, 'Factory Offtake Orders'], ['🌍', num(co2) + ' kg', 'Carbon Offset (CO₂e)']].map(([e, v, l]) => `<div class="card kpi"><div class="e">${e}</div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
      <div class="section"><h2>Live transaction ledger</h2></div>${filterBar('admin', { srcMode: 'select', placeholder: 'Search ledger: metals, copper, Madhapur…' })}${resultsWrap('results', ledgerHtml())}`;
  } else if (t === 'vendors') {
    h += `<div class="card"><div class="tw"><table><tr><th>Vendor</th><th>Hub</th><th>Aadhaar</th><th>Digital scale</th><th>Status</th><th></th></tr>${S.vendors.map(v => `<tr><td>${esc(v.name)}</td><td>${esc(v.hub)}</td><td>${v.verified ? '✅ Verified' : '⏳ Pending'}</td><td>${v.verified ? '✅ Calibrated' : '⏳ Pending'}</td><td><span class="badge ${v.verified ? 'b-4' : 'b-0'}">${v.verified ? 'Approved' : 'Awaiting approval'}</span></td><td>${v.verified ? '' : `<button class="btn sm" data-act="approve" data-id="${v.id}">Approve vendor</button>`}</td></tr>`).join('')}</table></div></div>`;
  } else if (t === 'comp') {
    const byH = {}; S.orders.forEach(o => { const k = o.hsn + '|' + o.gstPct; (byH[k] ||= { hsn: o.hsn, gst: o.gstPct, taxable: 0, tax: 0, kg: 0 }); byH[k].taxable += o.taxable; byH[k].tax += o.gst; byH[k].kg += o.kg; });
    const epr = S.orders.filter(o => o.epr), eprKg = epr.reduce((s, o) => s + o.kg, 0);
    h += `<div class="kpis"><div class="card kpi"><div class="e">📜</div><b>${epr.length}</b><span>EPR certificates issued</span></div><div class="card kpi"><div class="e">⚖️</div><b>${num(eprKg)} kg</b><span>EPR-credited tonnage</span></div><div class="card kpi"><div class="e">💸</div><b>${inr(eprKg * 25)}</b><span>Est. EPR value (₹25/kg)</span></div></div>
      <div class="section"><h3>GST by HSN code (factory orders)</h3></div><div class="card"><div class="tw"><table><tr><th>HSN</th><th class="n">GST</th><th class="n">Weight</th><th class="n">Taxable</th><th class="n">GST amount</th><th>Treatment</th></tr>
      ${Object.values(byH).map(r => `<tr><td>${esc(r.hsn)}</td><td class="n">${r.gst}%</td><td class="n">${num(r.kg)} kg</td><td class="n">${inr(r.taxable)}</td><td class="n">${inr(r.tax)}</td><td>${r.gst === 18 ? 'RCM on unregistered purchase; ITC passed to mill' : 'Forward charge'}</td></tr>`).join('') || '<tr><td colspan="6" class="mute">No orders yet — place one from the Factory portal.</td></tr>'}</table></div></div>
      <div class="section"><div class="gst" style="max-width:640px">Metals (HSN 72–81): 18% GST under reverse charge when bought from unregistered sellers, 2% GST TDS above ₹2.5 lakh B2B, 2% income-tax TCS on scrap sales. Plastic (3915) and paper (4707): 5% GST. E-waste (8549): 18%.</div></div>`;
  } else {
    h += `<div class="rategrid">${RATE_DEFS.map(([k, l, , u]) => `<div class="card pad"><label style="margin-top:0">${l}</label><div class="row1" style="display:flex;gap:6px;align-items:center"><input data-rate="${k}" type="number" min="0" value="${S.rates[k]}"><span class="mute sm-t">${u}</span></div></div>`).join('')}</div><p class="mute sm-t">Changes apply instantly to the ticker, estimates and new listings.</p>`;
  }
  return h;
}

// ---------- render ----------
const VIEWS = { household: viewHousehold, vendor: viewVendor, factory: viewFactory, admin: viewAdmin };
function renderTicker() {
  const items = RATE_DEFS.map(([k, l, , u]) => `<span>${l.replace(/ \(.*\)/, '')}: <b>${inr(S.rates[k])}${u}</b></span>`).join('');
  $('#ticker').innerHTML = `<div>${items}${items}</div>`;
  $('#drawer').innerHTML = `<b>📈 Live reference rate card</b> <span class="mute sm-t">(per kg unless stated; prices update from Admin)</span><div class="rates">${RATE_DEFS.map(([k, l, , u]) => `<div class="rate"><span class="sm-t mute">${l}</span><b>${inr(S.rates[k])}<small class="mute">${u}</small></b></div>`).join('')}</div>`;
  $('#drawer').hidden = !UI.rates;
}
function animateCounters() {
  document.querySelectorAll('[data-count]').forEach(el => {
    const to = +el.dataset.count, t0 = performance.now();
    const step = t => { const p = Math.min(1, (t - t0) / 900); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString('en-IN'); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
function render() {
  $('#roles').innerHTML = `<button class="${!UI.role ? 'on' : ''}" data-act="goHome">🏠 Home</button>` + Object.keys(ROLE_LABEL).map(r => `<button class="${UI.role === r ? 'on' : ''}" data-act="login" data-role="${r}">${ACCOUNTS[r].ico} ${ROLE_LABEL[r]}</button>`).join('');
  renderTicker();
  $('#app').innerHTML = UI.role ? VIEWS[UI.role]() : viewHome();
  if (!UI.role) animateCounters();
  bindDrop(); save();
}
function renderResults() { // re-render only the result area so search typing keeps focus
  const el = $('#results'); if (!el) return render();
  const r = UI.role, t = curTab(r, '');
  el.innerHTML = r === 'vendor' ? vendorOpenHtml() : r === 'factory' ? factoryResultsHtml() : r === 'admin' ? ledgerHtml() : myListingsHtml();
  save();
}

// ---------- photo handling ----------
function loadPhoto(file) {
  if (!file || !file.type.startsWith('image/')) return toast('Please choose an image file', 'warn');
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 720 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      setPhoto(c.toDataURL('image/jpeg', 0.78)); toast('Photo uploaded! Tap “Simulate AI Photo Scan”');
    };
    img.onerror = () => toast('Could not read that image', 'warn'); img.src = rd.result;
  };
  rd.readAsDataURL(file);
}
function setPhoto(url) { UI.form.photo = url; UI.scanResult = ''; UI.scan = null; $('#formWrap').innerHTML = formHtml(); bindDrop(); }
function bindDrop() {
  const d = $('#drop'), inp = $('#photoIn'); if (!d || !inp) return;
  inp.onchange = () => loadPhoto(inp.files[0]);
  ['dragenter', 'dragover'].forEach(e => d.addEventListener(e, ev => { ev.preventDefault(); d.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(e => d.addEventListener(e, ev => { ev.preventDefault(); d.classList.remove('over'); }));
  d.addEventListener('drop', ev => loadPhoto(ev.dataTransfer.files[0]));
}

// ---------- actions ----------
const A = {};
A.goHome = () => { UI.role = null; render(); };
A.login = d => { UI.role = d.role; render(); toast(`Logged in as ${ACCOUNTS[d.role].name} (${ROLE_LABEL[d.role]})`); window.scrollTo(0, 0); };
A.toggleRates = () => { UI.rates = !UI.rates; $('#drawer').hidden = !UI.rates; };
A.reset = () => { if (!confirm('Reset all demo data and start fresh?')) return; S = seed(); UI.form = blankForm(); UI.scanResult = ''; UI.tab = {}; UI.f = { household: freshF(), vendor: freshF(), factory: Object.assign(freshF(), { src: 'hub' }), admin: freshF() }; render(); toast('Demo data reset'); };
A.tab = d => { UI.tab[UI.role] = d.v; render(); };
A.setCat = d => { UI.f[UI.role].cat = d.v; render(); };
A.setSrc = d => { UI.f[UI.role].src = d.v; render(); };
A.mode = d => { UI.form.mode = d.v; $('#formWrap').innerHTML = formHtml(); bindDrop(); };
A.rmPhoto = () => { setPhoto(''); };
A.samplePhoto = d => {
  const [e, l] = SAMPLE_PHOTOS[SAMPLE_PHOTOS.findIndex(s => s[2] === +d.v)];
  const cols = { '🔌': ['#FEF9C3', '#FDE68A'], '❄️': ['#DBEAFE', '#BFDBFE'], '🧴': ['#DCFCE7', '#BBF7D0'], '📰': ['#FEF9C3', '#FEF08A'] }[e];
  UI.sampleIdx = +d.v; setPhoto(svgPhoto(e, cols[0], cols[1])); toast('Sample photo loaded — run the AI scan');
};
A.scan = () => {
  if (!UI.form.photo) return toast('Upload a photo first', 'warn');
  UI.scan = 'busy'; $('#formWrap').innerHTML = formHtml(); bindDrop();
  setTimeout(() => {
    const f = UI.form, idx = UI.sampleIdx != null ? UI.sampleIdx : f.photo.length % SCAN_PRESETS.length, p = SCAN_PRESETS[idx]; UI.sampleIdx = null;
    const piece = !!PIECE_KG[p.key], qty = piece ? 1 : Math.max(1, Math.round(p.kg * (0.85 + (f.photo.length % 30) / 100)));
    Object.assign(f, { cat: p.cat, rk: p.key, title: p.title, qty: String(qty), unit: piece ? 'pieces' : 'kg', desc: f.desc || 'Auto-graded from photo by AI scan.' });
    UI.scanResult = `${p.title} · ~${piece ? qty + ' unit (' + PIECE_KG[p.key] + ' kg)' : qty + ' kg'} · recommended price ${inr(estimate(f))} at today's ${CATS[p.cat].label.toLowerCase()} rate.`;
    UI.scan = null; $('#formWrap').innerHTML = formHtml(); bindDrop(); toast('Photo uploaded & AI graded!');
  }, 1300);
};
A.publish = () => {
  const f = UI.form, kg = kgOf(f);
  if (!f.title.trim()) return toast('Add an item name', 'warn');
  if (!(kg > 0)) return toast('Enter an estimated weight or count', 'warn');
  if (!f.locality.trim() || !/^\d{6}$/.test(f.pin)) return toast('Add your locality and a 6-digit pin code', 'warn');
  if (f.mode === 'bid' && !(+f.ask > 0)) return toast('Enter your ask price for bid mode', 'warn');
  S.listings.unshift({ id: newId('L'), owner: ME, source: 'household', cat: f.cat, rk: f.rk, appliance: f.cat === 'ewaste' || ['ac', 'fridge'].includes(f.rk), title: f.title.trim(), desc: f.desc, kg, unit: f.unit === 'pieces' ? f.qty + (+f.qty === 1 ? ' unit' : ' units') : '', ask: Math.round(f.mode === 'bid' ? +f.ask : estimate(f)), mode: f.mode, locality: f.locality.trim(), pin: f.pin, slot: f.slot, photo: f.photo || CATS[f.cat].icon && svgPhoto(CATS[f.cat].icon, '#DCFCE7', '#BBF7D0'), co2: Math.round(kg * CATS[f.cat].co2), stage: 0, bids: [], vendor: null, created: Date.now() });
  UI.form = blankForm(); UI.scanResult = ''; UI.tab.household = 'mine'; render(); toast('Listing published to Local Vendor Hub!');
};
A.delListing = d => { S.listings = S.listings.filter(l => l.id !== d.id); render(); toast('Listing removed'); };
A.acceptBid = d => {
  const l = S.listings.find(x => x.id === d.id), b = l.bids.find(x => x.vendor === d.v);
  Object.assign(l, { stage: 1, vendor: d.v, finalPrice: b.amount }); render(); toast(`Bid accepted — ${b.name} will collect your scrap`);
};
A.call = d => { const l = S.listings.find(x => x.id === d.id); toast(`Connecting via masked hub line · Ref MH-${(l.id + '4721').slice(-4)} — resident number stays private`); };
A.bid = d => {
  const l = S.listings.find(x => x.id === d.id), v = +$('#bid-' + d.id).value;
  if (!(v > 0)) return toast('Enter a bid amount', 'warn');
  l.bids = l.bids.filter(b => b.vendor !== 'v1').concat({ vendor: 'v1', name: 'Srinivas Rao', amount: v }); render(); toast(`Bid of ${inr(v)} placed — household notified`);
};
A.claim = d => { const l = S.listings.find(x => x.id === d.id); Object.assign(l, { stage: 1, vendor: 'v1', finalPrice: l.ask }); UI.tab.vendor = 'mine'; render(); toast('Pickup claimed! Verify weight with the digital scale on arrival'); };
A.scale = d => {
  const l = S.listings.find(x => x.id === d.id);
  openModal(`<h3>⚖️ Bluetooth Digital Scale</h3><p class="mute sm-t">${esc(l.title)}</p><div class="scalebox"><div id="scStatus"><span class="spin"></span> Pairing with scale BT-SC-0${l.id.length}…</div><div class="w" id="scW">— kg</div></div>
    <div class="acts" style="margin-top:12px"><button class="btn" id="scOk" disabled data-act="scaleOk" data-id="${l.id}">Confirm weight</button><button class="btn ghost" data-act="closeModal">Cancel</button></div>`);
  setTimeout(() => { if ($('#scStatus')) $('#scStatus').textContent = '✅ Paired · reading weight…'; }, 800);
  setTimeout(() => {
    const w = Math.round(l.kg * (0.92 + Math.random() * 0.14) * 10) / 10; UI.pendingKg = w;
    if ($('#scW')) { $('#scW').textContent = w + ' kg'; $('#scStatus').textContent = '✅ Tamper-proof reading locked'; $('#scOk').disabled = false; }
  }, 1900);
};
A.scaleOk = d => {
  const l = S.listings.find(x => x.id === d.id), w = UI.pendingKg;
  l.scaleKg = w; l.stage = 2; if (l.mode === 'fixed') l.finalPrice = Math.round(l.ask * w / l.kg);
  closeModal(); render(); toast(`Pickup claimed with Digital Scale verification! ${w} kg → ${inr(l.finalPrice)} to household`);
};
A.closeModal = closeModal;
A.toHub = d => { const l = S.listings.find(x => x.id === d.id); l.stage = 3; l.hubName = 'Hub #04'; render(); toast('Added to Local Hub Inventory'); };
A.consolidate = d => {
  const inv = S.listings.filter(l => l.vendor === 'v1' && l.stage === 3 && !l.inLot && l.cat === d.v), kg = inv.reduce((s, l) => s + (l.scaleKg || l.kg), 0), val = inv.reduce((s, l) => s + l.finalPrice, 0);
  const lot = { id: newId('H'), source: 'hub', hub: 'Hub #04 — Kukatpally Eco-Station', vendor: 'v1', cat: d.v, appliance: d.v === 'ewaste', title: `Consolidated ${CATS[d.v].label} Lot (${inv.length} pickups)`, kg, hsn: CATS[d.v].hsn, price: Math.round(val * 1.12), locality: 'Kukatpally', pin: '500072', co2: Math.round(inv.reduce((s, l) => s + l.co2, 0)), epr: true, stage: 0, members: inv.map(l => l.id), photo: PH.bale };
  inv.forEach(l => l.inLot = true); S.lots.unshift(lot); render(); toast('Lot published to the Factory marketplace!');
};
function findItem(id, kind) { return kind === 'lot' ? S.lots.find(l => l.id === id) : S.listings.find(l => l.id === id); }
A.order = d => {
  const it = findItem(d.id, d.kind), taxable = d.kind === 'lot' ? it.price : it.ask, gstPct = CATS[it.cat].gst;
  const o = { id: newId('O'), kind: d.kind, item: it.id, title: it.title, cat: it.cat, appliance: !!it.appliance, kg: it.kg, hsn: it.hsn || CATS[it.cat].hsn, taxable, gstPct, gst: Math.round(taxable * gstPct / 100), vendor: it.vendor, locality: it.locality, pin: it.pin, co2: it.co2, epr: true, factory: ACCOUNTS.factory.name, ts: Date.now() };
  S.orders.unshift(o);
  if (d.kind === 'lot') { it.stage = 4; (it.members || []).forEach(m => { const l = S.listings.find(x => x.id === m); if (l) { l.stage = 4; l.inLot = true; } }); }
  else { Object.assign(it, { stage: 4, vendor: it.vendor || 'v1', finalPrice: it.ask, scaleKg: it.kg }); }
  UI.tab.factory = 'orders'; render(); toast('Offtake order placed — funds held in escrow, EPR certificate ready');
};
function certHtml(o) {
  const no = 'EPR-' + new Date().getFullYear() + '-' + String(o.id || o.item).replace(/\D/g, '').padStart(5, '0');
  return { no, html: `<div class="cert"><div class="seal">🌿</div><h2>CPCB EPR Sustainability Certificate</h2><div class="mute sm-t">Certificate No. ${no} · Issued by ScrapDaddy.in (demo preview)</div>
    <table><tr><td>Material</td><td><b>${esc(o.title)}</b></td></tr><tr><td>Category / HSN</td><td>${CATS[o.cat].label} · HSN ${esc(o.hsn)}</td></tr><tr><td>Verified weight</td><td>${num(o.kg)} kg (IoT scale-logged)</td></tr><tr><td>GST</td><td>${o.gstPct ?? CATS[o.cat].gst}%</td></tr><tr><td>Carbon offset</td><td>${num(o.co2)} kg CO₂e</td></tr><tr><td>Issued to</td><td>${esc(ACCOUNTS.factory.name)}</td></tr></table>
    <div class="sm-t mute">Traceable from household → verified vendor → hub → recycler. Preview only; not a legal document.</div></div>` };
}
function certModal(o) {
  const c = certHtml(o); openModal(c.html + `<div class="acts" style="margin-top:12px"><button class="btn" data-act="dlCert" data-no="${c.no}">⬇ Download certificate</button><button class="btn ghost" data-act="closeModal">Close</button></div>`);
  UI.cert = c;
}
A.cert = d => certModal(S.orders.find(o => o.id === d.id));
A.certPreview = d => { const it = findItem(d.id, d.kind); certModal({ id: it.id, title: it.title, cat: it.cat, hsn: it.hsn || CATS[it.cat].hsn, kg: it.kg, co2: it.co2, gstPct: CATS[it.cat].gst }); };
A.dlCert = d => {
  const doc = `<!doctype html><meta charset="utf-8"><title>${d.no}</title><body style="font-family:system-ui;max-width:640px;margin:30px auto;color:#14281D">${UI.cert.html}</body>`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([doc], { type: 'text/html' })); a.download = d.no + '.html'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Certificate downloaded');
};
A.approve = d => { S.vendors.find(v => v.id === d.id).verified = true; render(); toast('Vendor approved — Aadhaar & scale verified'); };

// ---------- events ----------
document.addEventListener('click', e => {
  const m = $('#modal'); if (e.target === m) return closeModal();
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.classList.contains('gate') && e.target.closest('button') && e.target.closest('button') !== b) return; // button handles itself
  const fn = A[b.dataset.act]; if (fn) { e.stopPropagation(); fn(b.dataset); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('gate')) { e.preventDefault(); A.login(e.target.dataset); }
});
document.addEventListener('input', e => {
  const t = e.target, d = t.dataset;
  if (d.f) { const f = UI.f[UI.role]; f[d.f] = d.f === 'min' ? +t.value || 0 : t.value; renderResults(); }
  else if (d.form && !['cat', 'rk', 'unit', 'slot'].includes(d.form)) {
    UI.form[d.form] = t.value;
    if (['qty', 'ask'].includes(d.form)) { const f = UI.form; $('#estVal').textContent = inr(estimate(f)); $('#estKg').textContent = `${num(kgOf(f))} kg · 🌱 ${num(kgOf(f) * CATS[f.cat].co2)} kg CO₂ saved`; }
  } else if (d.rate) { S.rates[d.rate] = Math.max(0, +t.value || 0); renderTicker(); save(); }
});
document.addEventListener('change', e => {
  const t = e.target, d = t.dataset;
  if (d.f === 'src') { UI.f[UI.role].src = t.value; renderResults(); }
  else if (d.form) {
    const f = UI.form; f[d.form] = t.value;
    if (d.form === 'cat') f.rk = MATERIALS[t.value][0][0];
    if (d.form === 'rk' && PIECE_KG[t.value]) f.unit = 'pieces';
    if (d.form === 'cat') f.unit = PIECE_KG[f.rk] ? 'pieces' : 'kg';
    $('#formWrap').innerHTML = formHtml(); bindDrop(); save();
  }
});
render();
