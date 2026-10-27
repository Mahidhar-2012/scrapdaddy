/* ===========================================================================
   transport-actions.js — what transporters, sponsors and administrators can
   actually do, plus the administrator's review screen.

   Every action re-checks the caller's role and ownership, so a stale page
   cannot act for someone else.
   ========================================================================= */
'use strict';

/* ---------- guards ---------- */
function requireApprovedTransporter() {
  const t = myTransporter();
  if (!t) { toast('Transporter account not found', 'err'); return null; }
  if (!transporterApproved(t)) { toast('Your transporter account is awaiting verification', 'warn'); return null; }
  return t;
}

/* ---------- delivery jobs ---------- */
A.acceptDelivery = d => {
  const t = requireApprovedTransporter(); if (!t) return;
  const job = deliveryById(d.id);
  if (!job || job.status !== 0) return toast('That job has already been taken', 'warn');
  if (job.kg > t.capacityKg) return toast('That load is heavier than your vehicle carries', 'warn');
  Object.assign(job, { status: 1, transporter: t.id, acceptedAt: Date.now() });
  saveDB(); Router.go('#/transport/mine');
  toast('Run accepted — collect from ' + job.from);
};
A.deliveryDrop = async d => {
  const t = requireApprovedTransporter(); if (!t) return;
  const job = deliveryById(d.id);
  if (!job || job.transporter !== t.id || job.status !== 1) return;
  if (!(await confirmDialog({ title: 'Give up this run?',
    body: 'It goes back on the board for another transporter to take.', confirmLabel: 'Give it up', danger: true }))) return;
  Object.assign(job, { status: 0, transporter: null, acceptedAt: null });
  saveDB(); Router.render(); toast('Returned to the jobs board', 'warn');
};
A.deliveryCollected = d => {
  const t = requireApprovedTransporter(); if (!t) return;
  const job = deliveryById(d.id);
  if (!job || job.transporter !== t.id || job.status !== 1) return;
  job.status = 2; job.collectedAt = Date.now();
  saveDB(); Router.render(); toast('Marked as collected');
};
A.deliveryDelivered = async d => {
  const t = requireApprovedTransporter(); if (!t) return;
  const job = deliveryById(d.id);
  if (!job || job.transporter !== t.id || job.status !== 2) return;
  if (!(await confirmDialog({ title: 'Mark as delivered?',
    body: `Confirms ${num(job.kg / 1000)} tonnes reached ${job.to}. The run is then closed.`,
    confirmLabel: 'Delivered' }))) return;
  job.status = 3; job.deliveredAt = Date.now();
  t.trips = (t.trips || 0) + 1;
  t.kgMoved = (t.kgMoved || 0) + job.kg;
  saveDB(); Router.render();
  toast('Delivered — ' + inr(job.fee) + ' recorded for this run');
};

/* ---------- sponsorship: transporter ---------- */
A.createSponsorship = () => {
  const t = requireApprovedTransporter(); if (!t) return;
  if (DB.sponsorships.some(s => s.transporterId === t.id && ['in_review', 'open', 'funded', 'active'].indexOf(s.status) >= 0)) {
    return toast('You already have a request in progress', 'warn');
  }
  const get = n => { const el = $('[data-input="' + n + '"]'); return el ? el.value.trim() : ''; };
  const title = get('sp_title'), detail = get('sp_detail');
  const amount = Math.round(Number(get('sp_amount')) || 0);
  const months = Math.max(0, Math.min(36, Number(get('sp_months')) || 0));
  const benefits = get('sp_benefits').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8);

  if (!title) return toast('Say what you need', 'warn');
  if (!(amount >= 1000)) return toast('Enter an amount of at least ₹1,000', 'warn');
  if (detail.length < 20) return toast('Explain why you need it, in a sentence or two', 'warn');
  if (!benefits.length) return toast('List at least one thing the sponsor gets', 'warn');

  DB.sponsorships.unshift({
    id: nextId('S'), transporterId: t.id, title, purpose: get('sp_purpose') || 'vehicle',
    amount, durationMonths: months, detail, benefits,
    status: 'in_review', createdAt: Date.now(), reviewedAt: null, pledges: [], sample: false,
  });
  saveDB(); Router.render();
  toast('Submitted — an administrator will review it before sponsors see it');
};
A.cancelSponsorship = async d => {
  const t = requireApprovedTransporter(); if (!t) return;
  const s = sponsorshipById(d.id);
  if (!s || s.transporterId !== t.id) return;
  const pledged = pledgedTotal(s);
  if (!(await confirmDialog({ title: 'Withdraw this request?',
    body: pledged ? `${inr(pledged)} has been pledged. Withdrawing cancels those pledges; nobody has been charged.`
                  : 'It will no longer be visible to sponsors.',
    confirmLabel: 'Withdraw', danger: true }))) return;
  s.status = 'cancelled';
  (s.pledges || []).forEach(p => { if (p.status === 'pending_payment') p.status = 'withdrawn'; });
  saveDB(); Router.render(); toast('Request withdrawn', 'warn');
};
A.completeSponsorship = async d => {
  const t = requireApprovedTransporter(); if (!t) return;
  const s = sponsorshipById(d.id);
  if (!s || s.transporterId !== t.id || s.status !== 'active') return;
  if (!(await confirmDialog({ title: 'Mark this sponsorship completed?',
    body: 'Confirms the agreed period is over and the benefits have been delivered.', confirmLabel: 'Mark completed' }))) return;
  s.status = 'completed'; s.completedAt = Date.now();
  saveDB(); Router.render(); toast('Sponsorship closed');
};

/* ---------- sponsorship: sponsor ---------- */
A.openPledge = d => {
  const u = Auth.user();
  if (!u || u.role !== 'factory') return toast('Only factory accounts can sponsor', 'warn');
  const s = sponsorshipById(d.id);
  if (!s) return;
  const remaining = Math.max(0, s.amount - pledgedTotal(s));
  Modal.open({
    title: 'Pledge support',
    body: `<p class="lead">${esc(s.title)}</p>
      <div class="kv mt-3"><span class="k">Target</span><span class="v">${inr(s.amount)}</span></div>
      <div class="kv"><span class="k">Still needed</span><span class="v">${inr(remaining)}</span></div>
      ${field({ label: 'Your pledge (₹)', name: 'pledge_amount', type: 'number',
        value: remaining > 0 ? Math.min(remaining, 10000) : 1000,
        attrs: ' min="500" inputmode="numeric" data-autofocus' })}
      ${notice('This records a commitment. No payment is taken now, and nothing is charged to you. ' +
        'The transporter sees it as "awaiting payment" until money has actually changed hands.', 'amber', 'ℹ️')}`,
    footer: `<button class="btn btn-2" data-act="modalClose">Cancel</button>
             <button class="btn" data-act="confirmPledge" data-id="${esc(s.id)}">Record pledge</button>`,
  });
};
A.confirmPledge = async d => {
  const u = Auth.user();
  if (!u || u.role !== 'factory') return;
  const s = sponsorshipById(d.id);
  const el = $('[data-input="pledge_amount"]');
  const amount = Math.round(Number(el && el.value) || 0);
  if (!s) return;
  if (!(amount >= 500)) { if (el) el.focus(); return toast('Enter at least ₹500', 'warn'); }

  s.pledges = (s.pledges || []).filter(p => !(p.sponsorId === u.id && p.status !== 'withdrawn'));
  s.pledges.push({ id: nextId('P'), sponsorId: u.id, sponsorName: u.name, amount,
                   status: 'pending_payment', at: Date.now(), paymentRef: null });
  if (pledgedTotal(s) >= s.amount && s.status === 'open') s.status = 'funded';
  saveDB(); Modal.close(); Router.render();

  const billing = await Billing.status();
  toast(billing.configured
    ? 'Pledge recorded — complete payment to activate it'
    : 'Pledge recorded as a commitment. No payment was taken.');
};
A.withdrawPledge = async d => {
  const u = Auth.user();
  const s = sponsorshipById(d.id);
  if (!s || !u) return;
  const p = (s.pledges || []).find(x => x.sponsorId === u.id && x.status !== 'withdrawn');
  if (!p) return;
  if (p.status === 'paid') return toast('A paid pledge cannot be withdrawn here — contact support', 'warn');
  if (!(await confirmDialog({ title: 'Withdraw your pledge?',
    body: `Removes your ${inr(p.amount)} commitment from this request.`, confirmLabel: 'Withdraw', danger: true }))) return;
  p.status = 'withdrawn';
  if (s.status === 'funded' && pledgedTotal(s) < s.amount) s.status = 'open';
  saveDB(); Router.render(); toast('Pledge withdrawn', 'warn');
};

/* =========================================================================
   ADMINISTRATOR: transport and sponsorship oversight
   ========================================================================= */
function viewAdminTransport() {
  const pendingT = DB.transporters.filter(t => t.status === 'pending');
  const review = DB.sponsorships.filter(s => s.status === 'in_review');
  const live = DB.sponsorships.filter(s => ['open', 'funded', 'active'].indexOf(s.status) >= 0);
  const closed = DB.sponsorships.filter(s => ['completed', 'declined', 'cancelled'].indexOf(s.status) >= 0);
  const deliveries = DB.deliveries;

  return `<div class="stats">
      ${statCard({ label: 'Transporters', value: DB.transporters.length,
        detail: pendingT.length + ' awaiting verification', icon: '🚚' })}
      ${statCard({ label: 'Deliveries', value: deliveries.length,
        detail: deliveries.filter(d => d.status === 3).length + ' completed', icon: '🧭' })}
      ${statCard({ label: 'Sponsorships live', value: live.length,
        detail: review.length + ' awaiting review', icon: '🤝' })}
      ${statCard({ label: 'Pledged', value: inr(DB.sponsorships.reduce((n, s) => n + pledgedTotal(s), 0)),
        detail: inr(DB.sponsorships.reduce((n, s) => n + paidTotal(s), 0)) + ' actually received', icon: '💰' })}
    </div>

    <h3 class="mt-6">Sponsorship requests awaiting review</h3>
    <div class="mt-3">${review.length
      ? `<div class="listgrid">${review.map(s => sponsorshipCard(s, { forSponsor: true,
          actions: `<button class="btn btn-sm" data-act="approveSponsorship" data-id="${esc(s.id)}">Approve and list</button>
                    <button class="btn btn-2 btn-sm" data-act="declineSponsorship" data-id="${esc(s.id)}">Decline</button>` })).join('')}</div>`
      : emptyState({ icon: '✅', title: 'Nothing to review', text: 'New sponsorship requests appear here first.' })}</div>

    <h3 class="mt-6">Transporters</h3>
    <section class="card mt-3"><div class="tw"><table>
      <thead><tr><th>Transporter</th><th>Vehicle</th><th>Area</th><th class="n">Runs</th><th>Status</th><th></th></tr></thead>
      <tbody>${DB.transporters.map(t => `<tr>
        <td class="strong">${esc(t.name)}${t.sample === false ? ' ' + badge('new') : ''}
          <div class="t-xs muted">${esc(t.id)}${t.userId ? ' · has login' : ' · no login'}</div></td>
        <td class="muted">${esc(vehicleLabel(t.vehicle))}<div class="t-xs muted">${num(t.capacityKg)} kg</div></td>
        <td class="muted t-sm">${esc(t.area || '—')}</td>
        <td class="n">${num(t.trips)}<div class="t-xs muted">${num(t.kgMoved / 1000)} t</div></td>
        <td>${badge(t.status === 'approved' ? 'Approved' : 'Pending', t.status === 'approved' ? 'brand' : 'amber')}</td>
        <td class="n nowrap">${t.status === 'approved'
          ? `<button class="btn btn-2 btn-sm" data-act="suspendTransporter" data-id="${esc(t.id)}">Suspend</button>`
          : `<button class="btn btn-sm" data-act="approveTransporter" data-id="${esc(t.id)}">Approve</button>`}</td>
      </tr>`).join('')}</tbody></table></div>
      <div class="card-f t-xs muted">Approving confirms the vehicle, licence and insurance have been checked off-platform.</div>
    </section>

    ${live.length ? `<h3 class="mt-6">Live sponsorships</h3>
      <section class="card mt-3"><div class="tw"><table>
        <thead><tr><th>Request</th><th>Transporter</th><th class="n">Target</th><th class="n">Pledged</th><th class="n">Received</th><th>Status</th><th></th></tr></thead>
        <tbody>${live.map(s => `<tr>
          <td class="strong"><div class="trunc" style="max-width:220px">${esc(s.title)}</div>
            <div class="t-xs muted">${esc(purposeLabel(s.purpose))}</div></td>
          <td class="muted">${esc(transporterName(s.transporterId))}</td>
          <td class="n">${inr(s.amount)}</td>
          <td class="n">${inr(pledgedTotal(s))}</td>
          <td class="n">${inr(paidTotal(s))}</td>
          <td>${badge(SPONSOR_STATUS[s.status].label, SPONSOR_STATUS[s.status].tone)}</td>
          <td class="n nowrap">${s.status !== 'active' && pledgedTotal(s) > 0
            ? `<button class="btn btn-sm" data-act="activateSponsorship" data-id="${esc(s.id)}">Mark funds received</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>
        <div class="card-f t-xs muted">"Mark funds received" is a deliberate administrative action recording that money actually
          arrived outside the platform. It is the only way a pledge becomes paid while no payment provider is connected.</div>
      </section>` : ''}

    ${closed.length ? `<h3 class="mt-6">Closed</h3>
      <section class="card mt-3"><div class="tw"><table>
        <thead><tr><th>Request</th><th>Transporter</th><th class="n">Target</th><th>Outcome</th></tr></thead>
        <tbody>${closed.map(s => `<tr><td><div class="trunc" style="max-width:240px">${esc(s.title)}</div></td>
          <td class="muted">${esc(transporterName(s.transporterId))}</td>
          <td class="n">${inr(s.amount)}</td>
          <td>${badge(SPONSOR_STATUS[s.status].label, SPONSOR_STATUS[s.status].tone)}</td></tr>`).join('')}
        </tbody></table></div></section>` : ''}`;
}

/* ---------- administrator actions ---------- */
A.approveTransporter = d => {
  if (!assertAdmin()) return;
  const t = transporterById(d.id); if (!t) return;
  t.status = 'approved'; t.verified = true;
  saveDB(); Router.render(); toast(t.name + ' approved');
};
A.suspendTransporter = async d => {
  if (!assertAdmin()) return;
  const t = transporterById(d.id); if (!t) return;
  if (!(await confirmDialog({ title: 'Suspend transporter?',
    body: t.name + ' will not be able to accept new runs.', confirmLabel: 'Suspend', danger: true }))) return;
  t.status = 'pending'; t.verified = false;
  saveDB(); Router.render(); toast(t.name + ' suspended', 'warn');
};
A.approveSponsorship = d => {
  if (!assertAdmin()) return;
  const s = sponsorshipById(d.id); if (!s || s.status !== 'in_review') return;
  s.status = 'open'; s.reviewedAt = Date.now();
  saveDB(); Router.render(); toast('Listed for sponsors');
};
A.declineSponsorship = async d => {
  if (!assertAdmin()) return;
  const s = sponsorshipById(d.id); if (!s || s.status !== 'in_review') return;
  if (!(await confirmDialog({ title: 'Decline this request?',
    body: 'It will not be shown to sponsors. The transporter can submit a new one.',
    confirmLabel: 'Decline', danger: true }))) return;
  s.status = 'declined'; s.reviewedAt = Date.now();
  saveDB(); Router.render(); toast('Request declined', 'warn');
};
A.activateSponsorship = async d => {
  if (!assertAdmin()) return;
  const s = sponsorshipById(d.id); if (!s) return;
  const pledged = pledgedTotal(s);
  if (!pledged) return toast('Nothing has been pledged yet', 'warn');
  if (!(await confirmDialog({ title: 'Record funds as received?',
    body: `Confirms ${inr(pledged)} actually reached ${transporterName(s.transporterId)}. ` +
          'Only do this once you have verified the transfer outside the platform.',
    confirmLabel: 'Funds received' }))) return;
  (s.pledges || []).forEach(p => { if (p.status === 'pending_payment') { p.status = 'paid'; p.paidAt = Date.now(); } });
  s.status = 'active'; s.activatedAt = Date.now();
  saveDB(); Router.render(); toast('Marked as funded and active');
};
