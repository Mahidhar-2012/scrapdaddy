/* ===========================================================================
   core.js — constants, storage, domain data, formatting helpers.
   No DOM work here. Loaded first; everything else depends on it.
   ========================================================================= */
'use strict';

/* ---------- storage ---------- */
const DB_KEY = 'scrapdaddy.db.v3';
const LEGACY_KEY = 'scrapdaddy.v2';

const Store = {
  read(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn('[store] write failed', key, e && e.name); return false; }
  },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
  available() {
    try { const k = '__t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch { return false; }
  },
};

/* ---------- small helpers ---------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const num = n => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });
const uid = p => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : d + ' days ago';
}
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
const isPhone = v => /^[6-9]\d{9}$/.test(String(v || '').trim());
const isPin = v => /^\d{6}$/.test(String(v || '').trim());

/* ---------- domain constants ---------- */
const CATS = {
  metals:   { label: 'Metals',            short: 'Metals',    icon: '🔩', gst: 18, hsn: '7204–7404', co2: 2.6, kw: 'metal metals copper brass aluminium aluminum iron steel ferrous grill wiring scrap' },
  plastics: { label: 'Plastics',          short: 'Plastics',  icon: '🧴', gst: 5,  hsn: '3915',      co2: 1.5, kw: 'plastic plastics pet hdpe pvc polythene bottle crate bucket drum' },
  paper:    { label: 'Paper & cardboard', short: 'Paper',     icon: '📦', gst: 5,  hsn: '4707',      co2: 1.5, kw: 'paper cardboard newspaper book boxes corrugated kraft' },
  ewaste:   { label: 'E-waste & appliances', short: 'E-waste', icon: '❄️', gst: 18, hsn: '8549',    co2: 3.0, kw: 'ewaste e-waste appliance appliances air conditioner refrigerator fridge electronics compressor' },
};
const CAT_FILTERS = [['all', 'All'], ['metals', 'Metals'], ['plastics', 'Plastics'], ['paper', 'Paper'], ['ewaste', 'E-waste']];

// Indicative reference rates. Phase 2 replaces this with a sourced pricing service.
const RATE_DEFS = [
  { key: 'copper',    label: 'Copper',              unit: 'kg',    base: 850 },
  { key: 'brass',     label: 'Brass',               unit: 'kg',    base: 480 },
  { key: 'aluminium', label: 'Aluminium',           unit: 'kg',    base: 185 },
  { key: 'iron',      label: 'Iron & steel',        unit: 'kg',    base: 37 },
  { key: 'plastic',   label: 'Hard plastic / PET',  unit: 'kg',    base: 15 },
  { key: 'paper',     label: 'Newspaper & paper',   unit: 'kg',    base: 14 },
  { key: 'cardboard', label: 'Cardboard',           unit: 'kg',    base: 8 },
  { key: 'ac',        label: 'Split AC (1.5 ton)',  unit: 'piece', base: 5800 },
  { key: 'fridge',    label: 'Refrigerator',        unit: 'piece', base: 750 },
];
const MATERIALS = {
  metals:   [['copper', 'Copper'], ['brass', 'Brass'], ['aluminium', 'Aluminium'], ['iron', 'Iron & steel']],
  plastics: [['plastic', 'Hard plastic / PET / HDPE / PVC']],
  paper:    [['paper', 'Newspaper & office paper'], ['cardboard', 'Cardboard boxes']],
  ewaste:   [['ac', 'Split AC'], ['fridge', 'Refrigerator']],
};
const PIECE_KG = { ac: 38, fridge: 45 };
const STAGES = ['Listed', 'Pickup scheduled', 'Weighed on scale', 'At hub', 'Sold to factory'];

/* ---------- transport ---------- */
const DELIVERY_STAGES = ['Offered', 'Accepted', 'Collected from hub', 'Delivered to factory'];
const DELIVERY_RATE_PER_TONNE = 900;   // indicative; shown to everyone, not a quote
const DELIVERY_MIN_FEE = 450;
const deliveryFee = kg => Math.max(DELIVERY_MIN_FEE, Math.round((Number(kg) || 0) / 1000 * DELIVERY_RATE_PER_TONNE));

const VEHICLES = [
  ['e3w',    'Electric three-wheeler', 500],
  ['tempo',  'Tempo / mini truck',     1500],
  ['truck6', 'Six-wheel truck',        9000],
  ['truck10','Ten-wheel truck',        16000],
];
const vehicleLabel = id => (VEHICLES.find(v => v[0] === id) || [, 'Vehicle'])[1];
const vehicleCapacity = id => (VEHICLES.find(v => v[0] === id) || [, , 1000])[2];

/* Sponsorship lifecycle. A sponsorship is an agreement to fund a specific,
   costed need. Money only ever moves through a verified payment, so a pledge
   starts as a commitment and nothing else. */
const SPONSOR_STATUS = {
  in_review: { label: 'Awaiting review', tone: 'amber',  blurb: 'An administrator is checking this request.' },
  open:      { label: 'Open for sponsors', tone: 'info', blurb: 'Sponsors can pledge support.' },
  funded:    { label: 'Fully pledged', tone: 'brand',    blurb: 'The target is covered by pledges.' },
  active:    { label: 'Active', tone: 'brand',           blurb: 'Funded and running.' },
  completed: { label: 'Completed', tone: null,           blurb: 'The sponsorship period has ended.' },
  declined:  { label: 'Declined', tone: 'danger',        blurb: 'Not approved for the marketplace.' },
  cancelled: { label: 'Cancelled', tone: null,           blurb: 'Withdrawn by the transporter.' },
};
const PLEDGE_STATUS = {
  pending_payment: { label: 'Awaiting payment', tone: 'amber' },
  paid:            { label: 'Paid', tone: 'brand' },
  withdrawn:       { label: 'Withdrawn', tone: null },
};
const SPONSOR_PURPOSES = [
  ['vehicle',     'New or replacement vehicle'],
  ['battery',     'EV battery replacement'],
  ['maintenance', 'Servicing and maintenance'],
  ['fuel',        'Running costs for a fixed period'],
  ['insurance',   'Insurance and permits'],
];
const purposeLabel = id => (SPONSOR_PURPOSES.find(p => p[0] === id) || [, 'Other'])[1];
const SLOTS = ['Tomorrow, 10am–1pm', 'Tomorrow, 2pm–6pm', 'Saturday, 10am–1pm', 'Sunday, 10am–1pm'];

/* ---------- placeholder imagery (inline SVG, no network) ---------- */
function svgPhoto(emoji, c1, c2) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>` +
    `<rect width="480" height="300" fill="url(#g)"/><circle cx="408" cy="52" r="68" fill="#fff" opacity=".3"/>` +
    `<text x="240" y="192" font-size="124" text-anchor="middle">${emoji}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}
const PH = {
  copper: svgPhoto('🔌', '#FEF3C7', '#FDE68A'),
  ac:     svgPhoto('❄️', '#DBEAFE', '#BFDBFE'),
  steel:  svgPhoto('🚪', '#E5E7EB', '#D1D5DB'),
  pet:    svgPhoto('🧴', '#D1FAE5', '#A7F3D0'),
  crates: svgPhoto('🧺', '#FFEDD5', '#FED7AA'),
  paper:  svgPhoto('📰', '#FEF9C3', '#FEF08A'),
  bale:   svgPhoto('🏗️', '#D1FAE5', '#86EFAC'),
  fridge: svgPhoto('🧊', '#DBEAFE', '#BFDBFE'),
  window: svgPhoto('🪟', '#E0F2FE', '#BAE6FD'),
  tools:  svgPhoto('🔧', '#FEF3C7', '#FDE68A'),
  poly:   svgPhoto('♻️', '#D1FAE5', '#86EFAC'),
};
const catPhoto = cat => svgPhoto(CATS[cat].icon, '#ECFDF3', '#D3F5E0');

/* ---------- demo account identifiers (seeded by auth.js) ---------- */
const DEMO_USERS = {
  household: 'u_priya',
  vendor:    'u_srinivas',
  factory:   'u_greenearth',
  admin:     'u_admin',
};

/* ---------- seed data (clearly flagged as sample) ---------- */
function seedData() {
  const L = o => Object.assign({
    kind: 'listing', source: 'household', owner: null, mode: 'fixed', stage: 0,
    bids: [], vendor: null, co2: 0, sample: true, created: Date.now() - Math.floor(Math.random() * 6e8),
    slot: SLOTS[0], desc: '',
  }, o);
  const H = o => Object.assign({ kind: 'lot', source: 'hub', stage: 0, members: [], sample: true, epr: true }, o);
  return {
    rates: RATE_DEFS.reduce((m, r) => (m[r.key] = r.base, m), {}),
    ratesUpdated: Date.now() - 36e5 * 5,
    listings: [
      L({ id: 'L1', owner: DEMO_USERS.household, cat: 'metals', rk: 'copper', mode: 'bid',
          title: 'Old copper wiring and brass plumbing fittings', desc: 'Stripped copper wire bundles and brass taps, no plastic coating.',
          kg: 14, ask: 8900, locality: 'Green Valley Apartments, Jubilee Hills', pin: '500033', photo: PH.copper, co2: 42,
          bids: [{ vendor: 'v2', name: 'Fatima Begum', amount: 8450, at: Date.now() - 72e5 }] }),
      L({ id: 'L2', cat: 'ewaste', rk: 'ac', appliance: true, mode: 'bid', title: 'Dismantled 1.5 ton split AC with copper coil',
          desc: 'Indoor and outdoor unit, copper coil intact, iron stand included.', kg: 38, unit: '1 unit', ask: 6200,
          locality: 'EcoNest Residency, Gachibowli', pin: '500032', photo: PH.ac, co2: 115 }),
      L({ id: 'L3', cat: 'metals', rk: 'iron', title: 'Mild steel gate grill and aluminium utensils',
          desc: 'Rusted gate grill plus old aluminium vessels.', kg: 28, ask: 1450,
          locality: 'Sunshine Villa 12, Banjara Hills', pin: '500034', photo: PH.steel, co2: 58 }),
      L({ id: 'L4', cat: 'plastics', rk: 'plastic', source: 'rwa', title: 'Clean PET bottles and HDPE containers',
          desc: 'Rinsed, caps removed, bagged by the society.', kg: 22, ask: 350,
          locality: 'Lotus Zero-Waste Society, Kondapur', pin: '500084', photo: PH.pet, co2: 33 }),
      L({ id: 'L5', cat: 'plastics', rk: 'plastic', title: 'Plastic crates, buckets and PVC pipes',
          desc: 'Hard plastic, mixed colours.', kg: 35, ask: 490,
          locality: 'Shanti Niketan Homes, Madhapur', pin: '500081', photo: PH.crates, co2: 52 }),
      L({ id: 'L6', owner: DEMO_USERS.household, cat: 'paper', rk: 'paper', title: 'Old newspapers, textbooks and cartons',
          desc: 'Dry, tied bundles.', kg: 45, ask: 540, locality: 'Green Meadows 402, Miyapur', pin: '500049', photo: PH.paper, co2: 67 }),
      L({ id: 'L7', cat: 'ewaste', rk: 'fridge', appliance: true, title: 'End-of-life double-door refrigerator',
          desc: 'Not working, compressor intact.', kg: 45, unit: '1 unit', ask: 750,
          locality: 'Rainbow Residency, Kukatpally', pin: '500072', photo: PH.fridge, co2: 135 }),
      L({ id: 'L8', cat: 'metals', rk: 'aluminium', source: 'rwa', mode: 'bid', title: 'Aluminium window frames, society renovation',
          desc: 'Around 120 kg from a renovation drive. Bids invited.', kg: 120, ask: 21000,
          locality: 'Lakeview Towers Society, Hitech City', pin: '500081', photo: PH.window, co2: 312 }),
      // in-flight pipeline so the ledger is not empty
      L({ id: 'L9', cat: 'metals', rk: 'copper', title: 'Copper motor windings', kg: 8, ask: 6500, finalPrice: 6460,
          locality: 'Sai Residency, Ameerpet', pin: '500016', photo: PH.copper, co2: 21, stage: 1, vendor: 'v2' }),
      L({ id: 'L10', cat: 'plastics', rk: 'plastic', title: 'Segregated HDPE drums', kg: 60, ask: 900, finalPrice: 870,
          locality: 'Aditya Enclave, Begumpet', pin: '500016', photo: PH.crates, co2: 90, stage: 2, vendor: 'v1', scaleKg: 58 }),
      L({ id: 'L11', cat: 'metals', rk: 'iron', title: 'Mixed HMS iron, cluster pickup', kg: 410, ask: 15200, finalPrice: 15190,
          locality: 'Kukatpally Housing Board', pin: '500072', photo: PH.steel, co2: 1066, stage: 3, vendor: 'v1', scaleKg: 410, hubName: 'Hub 04' }),
      L({ id: 'L12', cat: 'paper', rk: 'cardboard', title: 'Corrugated cardboard bales', kg: 800, ask: 6400, finalPrice: 6400,
          locality: 'Madhapur cluster', pin: '500081', photo: PH.paper, co2: 1200, stage: 4, vendor: 'v2', scaleKg: 800, hubName: 'Hub 07', inLot: true }),
    ],
    lots: [
      H({ id: 'H4', hub: 'Hub 04 — Kukatpally Eco-Station', vendor: 'v1', cat: 'metals', title: 'Baled HMS-1 iron and copper scrap',
          kg: 4200, hsn: '7204 / 7404', price: 482000, locality: 'Kukatpally', pin: '500072', co2: 10920, photo: PH.bale }),
      H({ id: 'H7', hub: 'Hub 07 — Madhapur Station', vendor: 'v2', cat: 'plastics', title: 'Baled HDPE and PET, washed and segregated',
          kg: 6500, hsn: '3915', price: 99000, locality: 'Madhapur', pin: '500081', co2: 9750, photo: PH.poly }),
      H({ id: 'H2', hub: 'Hub 02 — Secunderabad Yard', vendor: 'v2', cat: 'paper', title: 'Cardboard and kraft paper bales',
          kg: 8200, hsn: '4707', price: 90200, locality: 'Secunderabad', pin: '500003', co2: 12300, photo: PH.paper }),
      H({ id: 'H9', hub: 'Hub 09 — Uppal Metals Yard', vendor: 'v1', cat: 'metals', title: 'Aluminium and brass segregated lot',
          kg: 950, hsn: '7602 / 7402', price: 281500, locality: 'Uppal', pin: '500039', co2: 2470, photo: PH.tools }),
      H({ id: 'H11', hub: 'Hub 11 — Medchal E-Waste Desk', vendor: 'v1', cat: 'ewaste', appliance: true,
          title: 'Dismantled AC compressors, coils and PCBs', kg: 1400, hsn: '8549', price: 98000,
          locality: 'Medchal', pin: '501401', co2: 4200, photo: PH.ac }),
    ],
    orders: [],
    vendors: [
      { id: 'v1', name: 'Srinivas Rao', hub: 'Hub 04 — Kukatpally', userId: DEMO_USERS.vendor, kycVerified: true, scaleVerified: true, status: 'approved' },
      { id: 'v2', name: 'Fatima Begum', hub: 'Hub 07 — Madhapur', userId: null, kycVerified: true, scaleVerified: true, status: 'approved' },
      { id: 'v3', name: 'Mohd Irfan',   hub: 'Hub 12 — Uppal',    userId: null, kycVerified: true, scaleVerified: false, status: 'pending' },
      { id: 'v4', name: 'Lakshmi Devi', hub: 'Hub 13 — LB Nagar', userId: null, kycVerified: false, scaleVerified: false, status: 'pending' },
    ],
    transporters: [
      { id: 't1', userId: null, name: 'Ravi Transport Co.', vehicle: 'tempo', capacityKg: 1500,
        area: 'Kukatpally, Miyapur, Bachupally', pin: '500072', verified: true, status: 'approved',
        trips: 38, kgMoved: 41200, joinedAt: Date.now() - 180 * 864e5, sample: true },
      { id: 't2', userId: null, name: 'Sabiha Logistics', vehicle: 'e3w', capacityKg: 500,
        area: 'Madhapur, Kondapur, Gachibowli', pin: '500081', verified: true, status: 'approved',
        trips: 112, kgMoved: 48600, joinedAt: Date.now() - 300 * 864e5, sample: true },
      { id: 't3', userId: null, name: 'Yadav Carriers', vehicle: 'truck6', capacityKg: 9000,
        area: 'Uppal, Medchal, Secunderabad', pin: '500039', verified: false, status: 'pending',
        trips: 0, kgMoved: 0, joinedAt: Date.now() - 6 * 864e5, sample: true },
    ],
    deliveries: [],
    sponsorships: [
      { id: 'S1', transporterId: 't2', title: 'Replacement battery pack for the e-rickshaw',
        purpose: 'battery', amount: 62000, durationMonths: 0,
        detail: 'The original pack now holds about half its range, which cuts the number of hub runs I can do in a day. A new LFP pack restores a full day of collection.',
        benefits: ['Your name and logo on both sides of the vehicle for 12 months',
                   'Monthly report of tonnage moved and CO₂ avoided',
                   'First refusal on my capacity in Madhapur and Kondapur'],
        status: 'open', createdAt: Date.now() - 9 * 864e5, reviewedAt: Date.now() - 8 * 864e5,
        pledges: [], sample: true },
      { id: 'S2', transporterId: 't1', title: 'Six months of running costs while routes build up',
        purpose: 'fuel', amount: 48000, durationMonths: 6,
        detail: 'Covering diesel and tolls for six months so I can commit to the Kukatpally hub run daily rather than only when a full load is ready.',
        benefits: ['Branding on the tempo for the sponsored period',
                   'Guaranteed next-day collection for the sponsor’s lots',
                   'Quarterly impact summary'],
        status: 'open', createdAt: Date.now() - 4 * 864e5, reviewedAt: Date.now() - 3 * 864e5,
        pledges: [{ id: 'P1', sponsorId: null, sponsorName: 'GreenEarth Recyclers', amount: 18000,
                    status: 'pending_payment', at: Date.now() - 2 * 864e5, paymentRef: null }],
        sample: true },
    ],
    seq: 100,
    seededAt: Date.now(),
  };
}

/* ---------- live database ---------- */
let DB = Store.read(DB_KEY, null);

/* One-time migration of the pre-auth build so earlier demo data is not lost. */
function migrateLegacy() {
  const old = Store.read(LEGACY_KEY, null);
  if (!old || !old.S) return null;
  const d = seedData();
  const s = old.S;
  try {
    if (Array.isArray(s.listings)) {
      d.listings = s.listings.map(l => Object.assign({}, l, {
        kind: 'listing',
        owner: l.owner === 'me' ? DEMO_USERS.household : (l.owner || null),
        sample: l.sample !== undefined ? l.sample : !!l.id && /^L([1-9]|1[0-2])$/.test(l.id),
        source: l.source || 'household',
      }));
    }
    if (Array.isArray(s.lots)) d.lots = s.lots.map(l => Object.assign({ kind: 'lot', source: 'hub' }, l));
    if (Array.isArray(s.orders)) d.orders = s.orders.slice();
    if (Array.isArray(s.vendors)) {
      d.vendors = s.vendors.map(v => {
        const base = seedData().vendors.find(x => x.id === v.id) || {};
        return Object.assign({}, base, {
          id: v.id, name: v.name, hub: v.hub,
          kycVerified: !!v.verified, scaleVerified: !!v.verified,
          status: v.verified ? 'approved' : 'pending',
          userId: v.id === 'v1' ? DEMO_USERS.vendor : (base.userId || null),
        });
      });
    }
    if (s.rates) d.rates = Object.assign(d.rates, s.rates);
    if (typeof s.seq === 'number') d.seq = s.seq;
    d.migratedFrom = LEGACY_KEY;
    return d;
  } catch (e) { console.warn('[migrate] failed, using fresh seed', e); return null; }
}

if (!DB) {
  DB = migrateLegacy() || seedData();
  Store.write(DB_KEY, DB);
}
/* forward-compatibility guards for partially written records */
DB.rates = Object.assign(RATE_DEFS.reduce((m, r) => (m[r.key] = r.base, m), {}), DB.rates || {});
DB.listings = DB.listings || []; DB.lots = DB.lots || []; DB.orders = DB.orders || []; DB.vendors = DB.vendors || [];
DB.transporters = DB.transporters || []; DB.deliveries = DB.deliveries || []; DB.sponsorships = DB.sponsorships || [];
DB.lots.forEach(l => { l.source = 'hub'; l.kind = 'lot'; });
DB.listings.forEach(l => { l.kind = 'listing'; l.source = l.source || 'household'; });

const saveDB = () => Store.write(DB_KEY, DB);
const nextId = p => p + (++DB.seq);
const resetDB = () => { DB = seedData(); saveDB(); return DB; };

/* ---------- domain lookups ---------- */
const rateOf = key => Number(DB.rates[key]) || 0;
const rateUnit = key => (RATE_DEFS.find(r => r.key === key) || {}).unit || 'kg';
const vendorById = id => DB.vendors.find(v => v.id === id) || null;
const vendorName = id => (vendorById(id) || {}).name || 'Unassigned';
const vendorForUser = userId => DB.vendors.find(v => v.userId === userId) || null;
const listingById = id => DB.listings.find(l => l.id === id) || null;
const transporterById = id => DB.transporters.find(t => t.id === id) || null;
const transporterName = id => (transporterById(id) || {}).name || 'Unassigned';
const transporterForUser = userId => DB.transporters.find(t => t.userId === userId) || null;
const sponsorshipById = id => DB.sponsorships.find(s => s.id === id) || null;
const deliveryById = id => DB.deliveries.find(d => d.id === id) || null;
/** Pledges that actually count toward the target: paid, or awaiting payment. */
const pledgedTotal = s => (s.pledges || [])
  .filter(p => p.status === 'pending_payment' || p.status === 'paid')
  .reduce((n, p) => n + (Number(p.amount) || 0), 0);
const paidTotal = s => (s.pledges || [])
  .filter(p => p.status === 'paid').reduce((n, p) => n + (Number(p.amount) || 0), 0);
const lotById = id => DB.lots.find(l => l.id === id) || null;
const itemById = (id, kind) => (kind === 'lot' ? lotById(id) : listingById(id));

function kgOf(qty, rk, unit) {
  const q = Number(qty) || 0;
  return unit === 'pieces' ? q * (PIECE_KG[rk] || 1) : q;
}
function estimateValue(qty, rk) { return (Number(qty) || 0) * rateOf(rk); }
function co2For(cat, kg) { return Math.round((Number(kg) || 0) * CATS[cat].co2); }

/* GST / TCS breakdown for a factory purchase. Indicative, not tax advice. */
function taxBreakdown(cat, taxable, hsn) {
  const gstPct = CATS[cat].gst;
  const gst = taxable * gstPct / 100;
  const tcs = taxable * 0.02;
  return { taxable, gstPct, gst, tcs, hsn: hsn || CATS[cat].hsn, total: taxable + gst + tcs, rcm: gstPct === 18 };
}

/* ---------- search / filter ---------- */
function matchesCat(item, cat) { return cat === 'all' || item.cat === cat; }
function matchesQuery(item, q) {
  const term = String(q || '').trim().toLowerCase();
  if (!term) return true;
  const hay = [item.title, item.desc, CATS[item.cat].label, CATS[item.cat].kw, item.locality, item.hub, item.hsn, item.pin]
    .filter(Boolean).join(' ').toLowerCase();
  const words = hay.split(/[^a-z0-9]+/);
  return term.split(/\s+/).every(t => (t.length <= 2 ? words.includes(t) : hay.includes(t)));
}
function filterItems(items, f) {
  const loc = String(f.loc || '').trim().toLowerCase();
  const min = Number(f.min) || 0;
  return items.filter(it =>
    matchesCat(it, f.cat || 'all') &&
    matchesQuery(it, f.q) &&
    (!loc || ((it.locality || '') + ' ' + (it.hub || '') + ' ' + (it.pin || '')).toLowerCase().includes(loc)) &&
    (Number(it.kg) || 0) >= min &&
    (!f.src || f.src === 'all' || (f.src === 'hub' ? it.source === 'hub' : it.source !== 'hub'))
  );
}
const blankFilter = extra => Object.assign({ q: '', cat: 'all', loc: '', min: '', src: 'all' }, extra || {});
