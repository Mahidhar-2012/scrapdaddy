/* ===========================================================================
   admin.js — Platform Admin portal. Every route here is registered with
   roles:['admin'] in app.js, and each action re-checks the caller's role so a
   stale view cannot act on behalf of a non-administrator.
   ========================================================================= */
'use strict';

function assertAdmin() {
  if (Auth.role() !== 'admin') { toast('Administrator access required', 'err'); Router.go('#/login'); return false; }
  return true;
}

/* Rows shown in the transaction ledger, derived from real records only. */
function ledgerRows() {
  const rows = [];
  DB.listings.filter(l => l.stage >= 1).forEach(l => rows.push({
    id: l.id, kind: 'Household pickup', cat: l.cat, title: l.title,
    kg: l.scaleKg || l.kg, value: l.finalPrice || l.ask, stage: l.stage,
    parties: `Resident → ${vendorName(l.vendor)}`, locality: l.locality, pin: l.pin,
    source: 'household', ts: l.created, sample: !!l.sample,
  }));
  DB.orders.forEach(o => rows.push({
    id: o.id, kind: 'Factory order', cat: o.cat, title: o.title,
    kg: o.kg, value: o.taxable, stage: 4,
    parties: `${vendorName(o.vendor)} → ${o.buyer}`, locality: '', pin: '',
    source: 'hub', ts: o.ts, sample: false,
  }));
  return rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
const escrowState = stage => stage <= 1 ? ['Not funded', null] : stage === 4 ? ['Released', 'brand'] : ['Held', 'info'];

function viewAdminOverview() {
  const rows = ledgerRows();
  const gmv = rows.reduce((s, r) => s + (r.value || 0), 0);
  const kg = DB.listings.filter(l => l.stage >= 2).reduce((s, l) => s + (l.scaleKg || l.kg), 0);
  const co2 = DB.listings.filter(l => l.stage >= 2).reduce((s, l) => s + (l.co2 || 0), 0);
  const users = Auth.provider.listUsers();
  const pending = DB.vendors.filter(v => v.status === 'pending');
  const byCat = Object.keys(CATS).map(c => {
    const v = DB.listings.filter(l => l.stage >= 2 && l.cat === c).reduce((s, l) => s + (l.scaleKg || l.kg), 0);
    return { label: CATS[c].short, value: v, display: v ? num(v) : '0', highlight: v > 0 };
  });
  return `${notice(`Figures below are computed from the records in this browser, including the seeded sample data.
      They are not production metrics.`, 'amber', 'alert')}
    <div class="stats mt-4">
      ${statCard({ label: 'Transaction value', value: inr(gmv), detail: rows.length + ' transaction' + (rows.length === 1 ? '' : 's'), icon: 'coins' })}
      ${statCard({ label: 'Material collected', value: num(kg) + ' kg', detail: 'Weighed on a scale', icon: 'scale' })}
      ${statCard({ label: 'Accounts', value: users.length, detail: users.filter(u => u.role === 'vendor').length + ' vendor, ' + users.filter(u => u.role === 'household').length + ' household', icon: 'users' })}
      ${statCard({ label: 'CO₂ saved', value: num(co2) + ' kg', detail: 'Across completed pickups', icon: 'leaf' })}
    </div>
    <div class="split even mt-6">
      <section class="card"><div class="card-h"><h3>Collected by category</h3><span class="t-xs muted">kilograms</span></div>
        <div class="card-b">${kg ? barChart(byCat) : emptyState({ icon: 'dashboard', title: 'No completed pickups', text: 'Weighed pickups will be charted here.' })}</div></section>
      <section class="card"><div class="card-h"><h3>Vendors awaiting approval</h3>
        <a class="btn btn-2 btn-sm" href="#/admin/vendors">Manage</a></div>
        <div class="card-b">${pending.length ? pending.map(v => `<div class="kv">
            <span class="k">${esc(v.name)} · <span class="muted">${esc(v.hub)}</span></span>
            <span class="v"><button class="btn btn-sm" data-act="approveVendor" data-id="${esc(v.id)}">Approve</button></span></div>`).join('')
          : emptyState({ icon: 'check', title: 'All clear', text: 'No vendor is waiting for verification.' })}</div></section>
    </div>`;
}

function adminLedgerHtml() {
  const f = filtersFor('admin');
  const rows = filterItems(ledgerRows().map(r => Object.assign({ desc: r.parties }, r)), f);
  if (!rows.length) return emptyState({ icon: 'receipt', title: 'No transactions match', text: 'Adjust the search or filters.' });
  return resultCount(rows.length, 'transaction') + `<section class="card"><div class="tw"><table>
    <thead><tr><th>Ref</th><th>Material</th><th class="n">Weight</th><th>Parties</th><th class="n">Value</th><th>Escrow</th><th>Status</th></tr></thead>
    <tbody>${rows.map(r => {
      const [eLabel, eTone] = escrowState(r.stage);
      return `<tr><td class="strong nowrap">${esc(r.id)}${r.sample ? ' <span class="badge">sample</span>' : ''}
          <div class="t-xs muted">${esc(r.kind)}</div></td>
        <td><div class="trunc" style="max-width:240px">${esc(r.title)}</div>
          <div class="t-xs muted">${esc(CATS[r.cat].label)}</div></td>
        <td class="n nowrap">${num(r.kg)} kg</td>
        <td class="t-sm">${esc(r.parties)}</td>
        <td class="n nowrap">${inr(r.value)}</td>
        <td>${badge(eLabel, eTone)}</td>
        <td>${badge(STAGES[r.stage], r.stage === 4 ? 'brand' : 'info')}</td></tr>`;
    }).join('')}</tbody></table></div></section>`;
}
function viewAdminLedger() {
  const f = filtersFor('admin');
  View.renderResults = () => { const el = $('#results'); if (el) el.innerHTML = adminLedgerHtml(); };
  return toolbar(f, { placeholder: 'Search material, area or party…' }) + `<div id="results">${adminLedgerHtml()}</div>`;
}

function viewAdminVendors() {
  const vs = DB.vendors.slice().sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1));
  return `<section class="card">
    <div class="card-h"><div><h3>Collection vendors</h3>
      <div class="t-xs muted">A vendor can only accept pickups once approved</div></div></div>
    <div class="tw"><table>
      <thead><tr><th>Vendor</th><th>Hub</th><th>ID check</th><th>Scale</th><th>Status</th><th></th></tr></thead>
      <tbody>${vs.map(v => `<tr>
        <td class="strong">${esc(v.name)}${v.sample === false ? ' ' + badge('new') : ''}
          <div class="t-xs muted">${esc(v.id)}${v.userId ? ' · has login' : ' · no login'}</div></td>
        <td class="muted">${esc(v.hub)}</td>
        <td><button class="btn btn-ghost btn-sm" data-act="toggleKyc" data-id="${esc(v.id)}">${v.kycVerified ? `${ico('check')} Verified` : '⏳ Pending'}</button></td>
        <td><button class="btn btn-ghost btn-sm" data-act="toggleScale" data-id="${esc(v.id)}">${v.scaleVerified ? `${ico('check')} Calibrated` : '⏳ Pending'}</button></td>
        <td>${badge(v.status === 'approved' ? 'Approved' : 'Pending', v.status === 'approved' ? 'brand' : 'amber')}</td>
        <td class="n nowrap">${v.status === 'approved'
          ? `<button class="btn btn-2 btn-sm" data-act="suspendVendor" data-id="${esc(v.id)}">Suspend</button>`
          : `<button class="btn btn-sm" data-act="approveVendor" data-id="${esc(v.id)}">Approve</button>`}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="card-f t-xs muted">Approving confirms the ID check and scale calibration have been completed off-platform.</div>
  </section>`;
}

function viewAdminAccounts() {
  const me = Auth.user();
  const users = Auth.provider.listUsers().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return `${notice(`Role changes take effect the next time that person loads a page. An administrator cannot change
      their own role or suspend their own account, and self-service sign-up never offers the administrator role.`, 'info', 'info')}
    <section class="card mt-4"><div class="card-h"><h3>Accounts</h3><span class="t-xs muted">${users.length} total</span></div>
    <div class="tw"><table>
      <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead>
      <tbody>${users.map(u => {
        const self = u.id === me.id;
        return `<tr>
          <td class="strong">${esc(u.name)}${u.sample ? ' ' + badge('demo') : ''}${self ? ' ' + badge('you', 'brand') : ''}
            <div class="t-xs muted">${esc(u.email)}</div></td>
          <td>${self ? badge(ROLE_META[u.role].label, 'brand')
            : `<select class="input" style="height:32px;width:auto;font-size:13px" data-act="setRole" data-id="${esc(u.id)}" aria-label="Role for ${esc(u.name)}">
                ${ROLES.map(r => `<option value="${r}"${u.role === r ? ' selected' : ''}>${ROLE_META[r].label}</option>`).join('')}</select>`}</td>
          <td>${badge(u.status === 'active' ? 'Active' : 'Suspended', u.status === 'active' ? 'brand' : 'danger')}</td>
          <td class="muted t-sm nowrap">${u.createdAt ? timeAgo(u.createdAt) : '—'}</td>
          <td class="n nowrap">${self ? '<span class="t-xs muted">—</span>'
            : `<button class="btn btn-2 btn-sm" data-act="toggleStatus" data-id="${esc(u.id)}">${u.status === 'active' ? 'Suspend' : 'Restore'}</button>`}</td>
        </tr>`;
      }).join('')}</tbody></table></div></section>`;
}

function viewAdminRates() {
  const byHsn = {};
  DB.orders.forEach(o => {
    const k = o.hsn + '|' + o.gstPct;
    byHsn[k] = byHsn[k] || { hsn: o.hsn, gst: o.gstPct, taxable: 0, tax: 0, kg: 0, n: 0 };
    byHsn[k].taxable += o.taxable; byHsn[k].tax += o.gst; byHsn[k].kg += o.kg; byHsn[k].n++;
  });
  const groups = Object.keys(byHsn).map(k => byHsn[k]);
  const region = Pricing.region;
  return `<section class="card">
      <div class="card-h"><div><h3>Reference prices</h3>
        <div class="t-xs muted">Shown to every portal · area: ${esc(Pricing.regionLabel())}</div></div>
        <div class="row" style="gap:8px">
          <select class="input" style="width:auto;height:32px;font-size:13px" data-act="setRegion" aria-label="Pricing area">
            ${Pricing.regions().map(r => `<option value="${esc(r.code)}"${r.code === region ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}
          </select>
          <button class="btn btn-sm" data-act="saveRates">Save changes</button>
        </div></div>
      <div class="card-b">
        ${Pricing.status === 'error'
          ? notice(`<strong>data/prices.json could not be loaded</strong> (${esc(Pricing.error || '')}). The app is running on
             its built-in fallback rates. Anything you save here is stored as an override in this browser.`, 'danger', 'alert')
          : notice(`The price book lives in <code>data/prices.json</code> and can be edited there without touching any code.
             Changes you make here are saved as <strong>overrides for ${esc(Pricing.regionLabel())}</strong>, recorded with
             your name and the time, and they take precedence over the file.`, 'info', 'info')}
        <div class="tw mt-4"><table>
          <thead><tr><th>Material</th><th class="n">Price</th><th>Source in force</th><th>Updated</th><th></th></tr></thead>
          <tbody>${Pricing.all(region).map(p => {
            const over = Pricing.hasOverride(p.material, region);
            const fr = FRESHNESS_LABEL[p.freshness] || FRESHNESS_LABEL.unknown;
            return `<tr>
              <td class="strong">${esc(p.label)}<div class="t-xs muted">per ${esc(p.unit)}</div></td>
              <td class="n"><input class="input" style="height:32px;width:110px;text-align:right" type="number" min="0" step="1"
                   value="${p.available ? p.price : ''}" placeholder="—" data-rate="${esc(p.material)}"
                   aria-label="Price for ${esc(p.label)}"></td>
              <td class="t-sm">${p.available ? esc((p.source && p.source.name) || '—') : '<span class="muted">No entry</span>'}
                <div class="t-xs muted">${p.available ? esc(SOURCE_TYPE_LABEL[p.type] || 'Indicative') : ''}${p.inherited ? ' · inherited from national' : ''}</div></td>
              <td class="nowrap">${p.updatedAt ? `<div class="t-sm">${timeAgo(p.updatedAt)}</div>` : ''}${badge(fr.text, fr.tone)}</td>
              <td class="n">${over ? `<button class="btn btn-ghost btn-sm" data-act="clearOverride" data-v="${esc(p.material)}">Revert</button>` : ''}</td>
            </tr>`;
          }).join('')}</tbody></table></div>
      </div>
    </section>
    <section class="card mt-6"><div class="card-h"><h3>GST by HSN code</h3>
      <span class="t-xs muted">From recorded factory orders</span></div>
      ${groups.length ? `<div class="tw"><table>
        <thead><tr><th>HSN</th><th class="n">GST</th><th class="n">Orders</th><th class="n">Weight</th><th class="n">Taxable</th><th class="n">GST amount</th><th>Treatment</th></tr></thead>
        <tbody>${groups.map(g => `<tr><td class="strong">${esc(g.hsn)}</td><td class="n">${g.gst}%</td>
          <td class="n">${g.n}</td><td class="n">${num(g.kg)} kg</td><td class="n">${inr(g.taxable)}</td><td class="n">${inr(g.tax)}</td>
          <td class="t-sm muted">${g.gst === 18 ? 'Reverse charge on unregistered purchase' : 'Forward charge'}</td></tr>`).join('')}
        </tbody></table></div>`
        : `<div class="card-b">${emptyState({ icon: 'receipt', title: 'No orders recorded', text: 'Tax summaries appear once a factory places an order.' })}</div>`}
      <div class="card-f t-xs muted">Indicative only — metals and e-waste are treated at 18%, paper and plastics at 5%. Not tax advice.</div>
    </section>`;
}

/* ---------- admin actions ---------- */
A.approveVendor = d => {
  if (!assertAdmin()) return;
  const v = vendorById(d.id); if (!v) return;
  v.status = 'approved'; v.kycVerified = true; v.scaleVerified = true;
  saveDB(); Router.render(); toast(`${v.name} approved`);
};
A.suspendVendor = async d => {
  if (!assertAdmin()) return;
  const v = vendorById(d.id); if (!v) return;
  if (!(await confirmDialog({ title: 'Suspend vendor?', body: `${v.name} will not be able to accept new pickups.`, confirmLabel: 'Suspend', danger: true }))) return;
  v.status = 'pending';
  saveDB(); Router.render(); toast(`${v.name} suspended`, 'warn');
};
A.toggleKyc = d => {
  if (!assertAdmin()) return;
  const v = vendorById(d.id); if (!v) return;
  v.kycVerified = !v.kycVerified;
  if (!v.kycVerified) v.status = 'pending';
  saveDB(); Router.render();
};
A.toggleScale = d => {
  if (!assertAdmin()) return;
  const v = vendorById(d.id); if (!v) return;
  v.scaleVerified = !v.scaleVerified;
  if (!v.scaleVerified) v.status = 'pending';
  saveDB(); Router.render();
};
A.setRole = (d, el) => {
  if (!assertAdmin()) return;
  try {
    const u = Auth.adminSetRole(d.id, el.value);
    if (u.role === 'vendor') Auth._ensureVendorRecord(u);
    if (u.role === 'transporter') Auth._ensureTransporterRecord(u);
    Router.render(); toast(`${u.name} is now ${ROLE_META[u.role].label.toLowerCase()}`);
  } catch (e) { toast(e.message, 'err'); Router.render(); }
};
A.toggleStatus = async d => {
  if (!assertAdmin()) return;
  const u = Auth.provider.getUser(d.id); if (!u) return;
  const next = u.status === 'active' ? 'suspended' : 'active';
  if (next === 'suspended' && !(await confirmDialog({
    title: 'Suspend account?', body: `${u.name} will be signed out and cannot sign in again until restored.`,
    confirmLabel: 'Suspend', danger: true }))) return;
  try {
    Auth.adminSetStatus(d.id, next);
    Router.render(); toast(`${u.name} ${next === 'active' ? 'restored' : 'suspended'}`, next === 'active' ? 'ok' : 'warn');
  } catch (e) { toast(e.message, 'err'); }
};
A.saveRates = () => {
  if (!assertAdmin()) return;
  const me = Auth.user();
  const region = Pricing.region;
  let changed = 0;
  $$('[data-rate]').forEach(el => {
    const key = el.dataset.rate;
    if (el.value === '') return;                       // left blank = leave as is
    const v = Math.max(0, Number(el.value) || 0);
    const current = Pricing.get(key, region);
    if (current.available && v === current.price) return;
    Pricing.setOverride(key, region, v, me.name);
    changed++;
  });
  if (!changed) return toast('No changes to save');
  Router.render();
  toast(changed + ' price' + (changed === 1 ? '' : 's') + ' overridden for ' + Pricing.regionLabel());
};
A.clearOverride = d => {
  if (!assertAdmin()) return;
  Pricing.clearOverride(d.v, Pricing.region);
  Router.render();
  toast('Reverted to the price book');
};
