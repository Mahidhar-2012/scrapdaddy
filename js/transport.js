/* ===========================================================================
   transport.js — the transporter portal, delivery jobs and sponsorship.

   Two features that lean on each other:

   1. Delivery jobs. When a factory buys a hub lot, that lot has to physically
      move. The order creates a delivery offer; a verified transporter accepts
      it and walks it through collected to delivered. Their record accrues the
      trips and tonnage a sponsor later looks at.

   2. Sponsorship. A transporter asks for one specific, costed thing — a
      battery, six months of running costs — and states what the sponsor gets
      back. An administrator reviews it before it is listed.

   On money, the same rule as subscriptions: a pledge is a commitment, not a
   payment. Nothing here marks anything paid. Only a verified payment or a
   deliberate administrator action can do that, and with no payment provider
   configured a pledge stays "awaiting payment" and says so.
   ========================================================================= */
'use strict';

/* ---------- shared helpers ---------- */
function myTransporter() {
  const u = Auth.user();
  if (!u || u.role !== 'transporter') return null;
  return transporterForUser(u.id) || Auth._ensureTransporterRecord(u);
}
const transporterApproved = t => !!t && t.status === 'approved';

function transporterPendingNotice() {
  return notice('<strong>Account awaiting verification.</strong> You can look around, but accepting delivery jobs and ' +
    'publishing a sponsorship request unlock once an administrator has checked your vehicle and documents.', 'amber', 'hourglass');
}

/** Called when a factory buys a hub lot, so the load has a way of moving. */
function createDeliveryForOrder(order, lot) {
  const d = {
    id: nextId('D'), orderId: order.id, lotId: lot.id,
    from: lot.hub || 'Vendor hub', to: order.buyer || 'Factory',
    buyerId: order.buyerId, vendorId: lot.vendor || null,
    kg: lot.kg, cat: lot.cat, title: lot.title,
    fee: deliveryFee(lot.kg), status: 0, transporter: null,
    offeredAt: Date.now(), acceptedAt: null, collectedAt: null, deliveredAt: null,
  };
  DB.deliveries.unshift(d);
  return d;
}

function deliveryTrack(status) {
  return '<div><div class="track" role="img" aria-label="Status: ' + esc(DELIVERY_STAGES[status]) + '">' +
    DELIVERY_STAGES.map((_, i) => '<i class="' + (i <= status ? 'on' : '') + '"></i>').join('') +
    '</div><div class="t-xs muted strong">' + esc(DELIVERY_STAGES[status]) + '</div></div>';
}
function deliveryCard(d, actions) {
  return `<article class="card card-p">
    <div class="row-between" style="align-items:flex-start">
      <div><h3 style="font-size:15px">${esc(d.title)}</h3>
        <div class="t-xs muted mt-2">${esc(d.from)} → ${esc(d.to)}</div></div>
      ${badge(CATS[d.cat].short, 'brand')}
    </div>
    <div class="mt-3" style="display:flex;gap:18px;border-top:1px solid var(--border);padding-top:10px">
      <div><b>${num(d.kg / 1000)} t</b><div class="t-xs muted">load</div></div>
      <div><b>${inr(d.fee)}</b><div class="t-xs muted">delivery fee</div></div>
      <div><b>${esc(timeAgo(d.offeredAt))}</b><div class="t-xs muted">offered</div></div>
    </div>
    <div class="mt-3">${deliveryTrack(d.status)}</div>
    ${actions ? `<div class="mt-3" style="display:flex;gap:7px;flex-wrap:wrap">${actions}</div>` : ''}
  </article>`;
}

/* =========================================================================
   TRANSPORTER PORTAL
   ========================================================================= */
function viewTransportOverview() {
  const t = myTransporter();
  const mine = DB.deliveries.filter(d => d.transporter === t.id);
  const active = mine.filter(d => d.status < 3);
  const done = mine.filter(d => d.status === 3);
  const earned = done.reduce((n, d) => n + d.fee, 0);
  const open = DB.deliveries.filter(d => d.status === 0).length;
  const mySponsorships = DB.sponsorships.filter(s => s.transporterId === t.id);
  const live = mySponsorships.find(s => ['open', 'funded', 'active'].indexOf(s.status) >= 0);

  return `${transporterApproved(t) ? '' : transporterPendingNotice() + '<div class="mt-4"></div>'}
    <div class="stats">
      ${statCard({ label: 'Open jobs', value: open, detail: 'Loads waiting for a carrier', icon: 'truck' })}
      ${statCard({ label: 'Runs in progress', value: active.length, detail: 'Accepted but not delivered', icon: 'compass' })}
      ${statCard({ label: 'Completed runs', value: t.trips + done.length,
        detail: num((t.kgMoved + done.reduce((n, d) => n + d.kg, 0)) / 1000) + ' tonnes moved', icon: 'check' })}
      ${statCard({ label: 'Earned here', value: inr(earned), detail: 'Delivery fees on this platform', icon: 'coins' })}
    </div>
    <div class="split mt-6">
      <section class="card"><div class="card-h"><h3>Runs in progress</h3>
        <a class="btn btn-2 btn-sm" href="#/transport/jobs">Find work</a></div>
        <div class="card-b">${active.length
          ? active.slice(0, 4).map(d => `<div class="kv"><span class="k trunc" style="max-width:58%">${esc(d.title)}</span>
              <span class="v">${badge(DELIVERY_STAGES[d.status], d.status === 0 ? 'amber' : 'info')}</span></div>`).join('')
          : emptyState({ icon: 'truck', title: 'Nothing on the road', text: 'Accept a delivery job to get started.',
              action: '<a class="btn" href="#/transport/jobs">Open jobs</a>' })}</div></section>
      <section class="card"><div class="card-h"><h3>Sponsorship</h3>
        <a class="btn btn-2 btn-sm" href="#/transport/sponsorship">Manage</a></div>
        <div class="card-b">${live
          ? `<div class="strong">${esc(live.title)}</div>${sponsorProgress(live)}
             <div class="mt-3">${badge(SPONSOR_STATUS[live.status].label, SPONSOR_STATUS[live.status].tone)}</div>`
          : emptyState({ icon: 'handshake', title: 'No active request',
              text: 'Ask sponsors to fund a vehicle, a battery or running costs.',
              action: '<a class="btn" href="#/transport/sponsorship">Create a request</a>' })}</div></section>
    </div>`;
}

function transportJobsHtml() {
  const t = myTransporter();
  const f = filtersFor('transport');
  const openJobs = DB.deliveries.filter(d => d.status === 0);
  const pool = openJobs.map(d => Object.assign({}, d, { locality: d.from, desc: d.to }));
  const items = filterItems(pool, Object.assign({}, f, { src: 'all' }));
  if (!items.length) {
    return emptyState({ icon: 'truck', title: openJobs.length ? 'No jobs match' : 'No delivery jobs right now',
      text: openJobs.length ? 'Try a different material or clear the filters.'
        : 'A job appears here whenever a factory buys a hub lot that needs moving.' });
  }
  const can = transporterApproved(t);
  return resultCount(items.length, 'job') + `<div class="listgrid">${items.map(d => {
    const tooBig = d.kg > t.capacityKg;
    const actions = `<button class="btn btn-sm" data-act="acceptDelivery" data-id="${esc(d.id)}" ${can && !tooBig ? '' : 'disabled'}>
        ${tooBig ? 'Over your capacity' : 'Accept this run'}</button>` +
      (tooBig ? `<span class="t-xs muted" style="align-self:center">Your ${esc(vehicleLabel(t.vehicle))} carries ${num(t.capacityKg)} kg</span>` : '');
    return deliveryCard(d, actions);
  }).join('')}</div>`;
}
function viewTransportJobs() {
  const t = myTransporter();
  const f = filtersFor('transport');
  View.renderResults = () => { const el = $('#results'); if (el) el.innerHTML = transportJobsHtml(); };
  return (transporterApproved(t) ? '' : transporterPendingNotice() + '<div class="mt-4"></div>') +
    toolbar(f, { placeholder: 'Search by material, hub or factory…' }) +
    `<div id="results">${transportJobsHtml()}</div>`;
}

function viewTransportMine() {
  const t = myTransporter();
  const mine = DB.deliveries.filter(d => d.transporter === t.id).sort((a, b) => b.offeredAt - a.offeredAt);
  if (!mine.length) return emptyState({ icon: 'compass', title: 'No runs yet',
    text: 'Jobs you accept appear here so you can mark collection and delivery.',
    action: '<a class="btn" href="#/transport/jobs">Find work</a>' });
  return `<div class="listgrid">${mine.map(d => {
    let actions;
    if (d.status === 1) {
      actions = `<button class="btn btn-sm" data-act="deliveryCollected" data-id="${esc(d.id)}">Mark collected</button>
        <button class="btn btn-2 btn-sm" data-act="deliveryDrop" data-id="${esc(d.id)}">Give up this run</button>`;
    } else if (d.status === 2) {
      actions = `<button class="btn btn-sm" data-act="deliveryDelivered" data-id="${esc(d.id)}">Mark delivered</button>`;
    } else {
      actions = badge('Completed · ' + inr(d.fee), 'brand');
    }
    return deliveryCard(d, actions);
  }).join('')}</div>`;
}

/* ---------- sponsorship, transporter side ---------- */
function sponsorProgress(s) {
  const pledged = pledgedTotal(s), paid = paidTotal(s);
  const pct = Math.min(100, Math.round(pledged / s.amount * 100));
  return `<div class="mt-2">
    <div class="row-between t-sm"><span class="muted">${inr(pledged)} pledged of ${inr(s.amount)}</span>
      <span class="strong">${pct}%</span></div>
    <div class="pw-meter mt-2" style="height:7px"><i style="width:${pct}%;background:var(--brand)"></i></div>
    ${paid < pledged ? `<div class="t-xs muted mt-2">${inr(paid)} received so far — the rest is pledged but not yet paid.</div>` : ''}
  </div>`;
}

function sponsorshipCard(s, opts) {
  const o = opts || {};
  const t = transporterById(s.transporterId);
  const st = SPONSOR_STATUS[s.status] || SPONSOR_STATUS.open;
  return `<article class="card card-p">
    <div class="row-between" style="align-items:flex-start">
      <div><h3 style="font-size:15px">${esc(s.title)}</h3>
        <div class="t-xs muted mt-2">${esc(purposeLabel(s.purpose))}${s.durationMonths ? ' · ' + s.durationMonths + ' months' : ''}</div></div>
      ${badge(st.label, st.tone)}
    </div>
    ${o.forSponsor && t ? `<div class="row mt-3" style="gap:9px">
      <span class="avatar">${esc(initials(t.name))}</span>
      <div><div class="strong t-sm">${esc(t.name)}</div>
        <div class="t-xs muted">${esc(vehicleLabel(t.vehicle))} · ${num(t.trips)} runs · ${num(t.kgMoved / 1000)} t moved${t.verified ? ` · ${ico('check')} verified` : ''}</div>
        <div class="t-xs muted">${esc(t.area || 'Area not stated')}</div></div></div>` : ''}
    <p class="t-sm mt-3">${esc(s.detail)}</p>
    ${sponsorProgress(s)}
    ${(s.benefits || []).length ? `<div class="scan-sec"><div class="scan-sec-h">${ico('gift')} What the sponsor gets</div>
      <ul class="scan-list">${s.benefits.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>` : ''}
    ${(s.pledges || []).length ? `<div class="scan-sec"><div class="scan-sec-h">${ico('handshake')} Pledges</div>
      ${s.pledges.map(p => `<div class="kv"><span class="k">${esc(p.sponsorName)} · ${timeAgo(p.at)}</span>
        <span class="v">${inr(p.amount)} ${badge(PLEDGE_STATUS[p.status].label, PLEDGE_STATUS[p.status].tone)}</span></div>`).join('')}</div>` : ''}
    ${o.actions ? `<div class="mt-3" style="display:flex;gap:7px;flex-wrap:wrap">${o.actions}</div>` : ''}
  </article>`;
}

function viewTransportSponsorship() {
  const t = myTransporter();
  const mine = DB.sponsorships.filter(s => s.transporterId === t.id);
  const hasLive = mine.some(s => ['in_review', 'open', 'funded', 'active'].indexOf(s.status) >= 0);
  const canCreate = transporterApproved(t) && !hasLive;

  return `${transporterApproved(t) ? '' : transporterPendingNotice() + '<div class="mt-4"></div>'}
    ${notice('A sponsorship is an agreement, not a loan or an investment. You ask for one specific, costed thing and say ' +
      'what the sponsor gets in return. An administrator checks the request before sponsors can see it, and ' +
      '<strong>a pledge only becomes money once it has actually been paid</strong> — the status shows which is which.', 'info', 'info')}
    <div class="mt-4">${mine.length
      ? `<div class="listgrid">${mine.map(s => {
          let actions = '';
          if (s.status === 'open' || s.status === 'in_review') {
            actions = `<button class="btn btn-2 btn-sm" data-act="cancelSponsorship" data-id="${esc(s.id)}">Withdraw request</button>`;
          } else if (s.status === 'active') {
            actions = `<button class="btn btn-2 btn-sm" data-act="completeSponsorship" data-id="${esc(s.id)}">Mark completed</button>`;
          }
          return sponsorshipCard(s, { actions });
        }).join('')}</div>`
      : emptyState({ icon: 'handshake', title: 'No sponsorship requests yet',
          text: 'Ask sponsors to fund a vehicle, a battery, servicing or running costs.' })}</div>
    ${canCreate ? `<section class="card card-p mt-6"><h3>New sponsorship request</h3>
      <p class="t-sm muted" style="margin:4px 0 14px">Be specific about the amount and what a sponsor receives.</p>
      ${field({ label: 'What do you need?', name: 'sp_title', value: '', placeholder: 'e.g. Replacement battery pack for the e-rickshaw' })}
      <div class="grid-2">
        ${field({ label: 'Purpose', name: 'sp_purpose', type: 'select', value: 'vehicle', options: SPONSOR_PURPOSES })}
        ${field({ label: 'Amount needed (₹)', name: 'sp_amount', type: 'number', value: '', placeholder: '50000', attrs: ' min="1000" inputmode="numeric"' })}
      </div>
      ${field({ label: 'Period in months (0 if one-off)', name: 'sp_months', type: 'number', value: '0', attrs: ' min="0" max="36"' })}
      ${field({ label: 'Why you need it', name: 'sp_detail', type: 'textarea', rows: 3, value: '',
        placeholder: 'What it is for and what difference it makes to the work you can take on.' })}
      ${field({ label: 'What the sponsor gets (one per line)', name: 'sp_benefits', type: 'textarea', rows: 3, value: '',
        placeholder: 'Branding on the vehicle for 12 months' })}
      <button class="btn mt-3" data-act="createSponsorship">Submit for review</button>
    </section>`
    : (mine.length && transporterApproved(t)
      ? '<p class="t-sm muted mt-4">You can have one active request at a time. Withdraw or complete the current one to create another.</p>' : '')}`;
}

/* =========================================================================
   SPONSOR SIDE (factories)
   ========================================================================= */
function sponsorListHtml() {
  const f = filtersFor('sponsor');
  const q = String(f.q || '').trim().toLowerCase();
  const openList = DB.sponsorships.filter(s => ['open', 'funded', 'active'].indexOf(s.status) >= 0);
  const items = openList.filter(s => {
    if (!q) return true;
    const t = transporterById(s.transporterId) || {};
    return (s.title + ' ' + s.detail + ' ' + purposeLabel(s.purpose) + ' ' + (t.name || '') + ' ' + (t.area || ''))
      .toLowerCase().indexOf(q) >= 0;
  });
  if (!items.length) return emptyState({ icon: 'handshake', title: openList.length ? 'Nothing matches' : 'No open requests',
    text: openList.length ? 'Try a different search.' : 'Transporters have no live sponsorship requests at the moment.' });
  const u = Auth.user();
  return resultCount(items.length, 'request') + `<div class="listgrid">${items.map(s => {
    const mine = (s.pledges || []).find(p => p.sponsorId === u.id && p.status !== 'withdrawn');
    const actions = mine
      ? `<span class="badge badge-amber">You pledged ${inr(mine.amount)}</span>
         <button class="btn btn-2 btn-sm" data-act="withdrawPledge" data-id="${esc(s.id)}">Withdraw pledge</button>`
      : `<button class="btn btn-sm" data-act="openPledge" data-id="${esc(s.id)}">Pledge support</button>`;
    return sponsorshipCard(s, { forSponsor: true, actions });
  }).join('')}</div>`;
}
function viewFactorySponsor() {
  const f = filtersFor('sponsor');
  View.renderResults = () => { const el = $('#results'); if (el) el.innerHTML = sponsorListHtml(); };
  const u = Auth.user();
  const myPledges = [];
  DB.sponsorships.forEach(s => (s.pledges || []).forEach(p => {
    if (p.sponsorId === u.id && p.status !== 'withdrawn') myPledges.push({ s, p });
  }));
  const committed = myPledges.reduce((n, x) => n + x.p.amount, 0);
  const requests = {};
  myPledges.forEach(x => { requests[x.s.id] = 1; });
  return `${notice('Sponsoring a transporter funds a specific thing they have costed — a battery, a vehicle, running costs — ' +
      'in return for what they have listed. <strong>A pledge here is a commitment, not a payment.</strong> Nothing is charged, ' +
      'and the request stays "awaiting payment" until money has actually changed hands.', 'info', 'handshake')}
    ${myPledges.length ? `<div class="stats mt-4">
      ${statCard({ label: 'Your pledges', value: myPledges.length, detail: 'Across ' + Object.keys(requests).length + ' request(s)', icon: 'handshake' })}
      ${statCard({ label: 'Committed', value: inr(committed), detail: 'Not yet charged', icon: 'coins' })}
    </div>` : ''}
    <div class="mt-4">${toolbar(f, { placeholder: 'Search transporters or requests…', hideCats: true })}</div>
    <div id="results">${sponsorListHtml()}</div>`;
}
