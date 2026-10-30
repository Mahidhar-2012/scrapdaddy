/* ===========================================================================
   subscriptions.js — vendor plans and entitlements.

   Two rules this file exists to enforce:
     1. Entitlements are checked where the action happens, not only in the UI.
     2. A plan is never marked paid without either a verified payment event or
        an explicit administrator action. With no payment provider configured,
        an upgrade lands in `pending_payment` and grants nothing.
   ========================================================================= */
'use strict';

const PLANS = [
  {
    id: 'free', name: 'Starter', price: 0, period: 'month', badge: null,
    tagline: 'For collectors getting started on ScrapHub.',
    entitlements: { jobsPerMonth: 10, canPublishLots: false, maxOpenPickups: 3, priorityPlacement: false, analytics: false },
    features: [
      'Up to 10 accepted pickups a month',
      'Up to 3 pickups in progress at once',
      'Digital scale weighing and instant payout records',
      'Masked customer contact',
    ],
    limits: ['Cannot bale and publish factory lots', 'No priority placement on the jobs board'],
  },
  {
    id: 'growth', name: 'Growth', price: 499, period: 'month', badge: 'Most popular',
    tagline: 'For an established hub running a daily round.',
    entitlements: { jobsPerMonth: 60, canPublishLots: true, maxOpenPickups: 12, priorityPlacement: true, analytics: true },
    features: [
      'Up to 60 accepted pickups a month',
      'Up to 12 pickups in progress at once',
      'Bale hub inventory and publish factory lots',
      'Priority placement on the jobs board',
      'Hub inventory analytics',
    ],
    limits: [],
  },
  {
    id: 'pro', name: 'Pro', price: 1499, period: 'month', badge: null,
    tagline: 'For multi-hub operators and bulk aggregators.',
    entitlements: { jobsPerMonth: Infinity, canPublishLots: true, maxOpenPickups: Infinity, priorityPlacement: true, analytics: true },
    features: [
      'Unlimited accepted pickups',
      'Unlimited pickups in progress',
      'Bale and publish factory lots',
      'Priority placement on the jobs board',
      'Hub inventory analytics',
    ],
    limits: [],
  },
];
const planById = id => PLANS.find(p => p.id === id) || PLANS[0];

const SUB_STATUS = {
  active:          { label: 'Active', tone: 'brand' },
  trialing:        { label: 'Trial', tone: 'info' },
  pending_payment: { label: 'Payment required', tone: 'amber' },
  past_due:        { label: 'Past due', tone: 'danger' },
  cancelling:      { label: 'Cancels at period end', tone: 'amber' },
  cancelled:       { label: 'Cancelled', tone: null },
  expired:         { label: 'Expired', tone: 'danger' },
};

const Subscriptions = {
  /** The subscription record for a vendor, created on first read. */
  forVendor(vendorId) {
    const v = vendorById(vendorId);
    if (!v) return null;
    if (!v.subscription) {
      v.subscription = {
        planId: 'free', status: 'active', startedAt: Date.now(),
        renewsAt: null, cancelAtPeriodEnd: false, paymentRef: null, history: [],
      };
      saveDB();
    }
    return v.subscription;
  },

  /** The plan whose entitlements actually apply right now. */
  effectivePlan(vendorId) {
    const s = this.forVendor(vendorId);
    if (!s) return planById('free');
    const granted = s.status === 'active' || s.status === 'trialing' || s.status === 'cancelling';
    if (!granted) return planById('free');
    if (s.renewsAt && Date.now() > s.renewsAt) return planById('free'); // lapsed
    return planById(s.planId);
  },

  entitlements(vendorId) { return this.effectivePlan(vendorId).entitlements; },

  /* ---------- usage ---------- */
  periodStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); },
  jobsThisPeriod(vendorId) {
    const from = this.periodStart();
    return DB.listings.filter(l => l.vendor === vendorId && (l.acceptedAt || 0) >= from).length;
  },
  openPickups(vendorId) {
    return DB.listings.filter(l => l.vendor === vendorId && l.stage >= 1 && l.stage <= 3).length;
  },
  usage(vendorId) {
    const e = this.entitlements(vendorId);
    const used = this.jobsThisPeriod(vendorId);
    const open = this.openPickups(vendorId);
    return {
      jobsUsed: used, jobsLimit: e.jobsPerMonth,
      jobsLeft: e.jobsPerMonth === Infinity ? Infinity : Math.max(0, e.jobsPerMonth - used),
      openUsed: open, openLimit: e.maxOpenPickups,
      pct: e.jobsPerMonth === Infinity ? 0 : Math.min(100, Math.round(used / e.jobsPerMonth * 100)),
    };
  },

  /**
   * The single entitlement gate. Returns null when allowed, or a reason string.
   * Called by the vendor actions themselves, not just by the views.
   */
  check(vendorId, action) {
    const e = this.entitlements(vendorId);
    const u = this.usage(vendorId);
    if (action === 'accept_job') {
      if (u.jobsLeft !== Infinity && u.jobsLeft <= 0) {
        return `You have used all ${u.jobsLimit} pickups on the ${this.effectivePlan(vendorId).name} plan this month.`;
      }
      if (u.openLimit !== Infinity && u.openUsed >= u.openLimit) {
        return `You already have ${u.openUsed} pickups in progress, the limit on the ${this.effectivePlan(vendorId).name} plan.`;
      }
      return null;
    }
    if (action === 'publish_lot') {
      return e.canPublishLots ? null
        : `Publishing factory lots is part of the Growth plan. You are on ${this.effectivePlan(vendorId).name}.`;
    }
    return null;
  },

  /* ---------- plan changes ---------- */
  /**
   * Starts a plan change. A downgrade to Free applies immediately. An upgrade
   * to a paid plan requires payment: with no provider configured it becomes
   * `pending_payment`, which grants nothing.
   */
  async requestChange(vendorId, planId) {
    const s = this.forVendor(vendorId);
    const plan = planById(planId);
    const prev = s.planId;

    if (plan.price === 0) {
      Object.assign(s, { planId: 'free', status: 'active', renewsAt: null, cancelAtPeriodEnd: false, paymentRef: null });
      s.history.push({ at: Date.now(), event: 'downgraded', from: prev, to: 'free' });
      saveDB();
      return { ok: true, status: 'active', message: 'You are now on the Starter plan.' };
    }

    const billing = await Billing.status();
    if (!billing.configured) {
      Object.assign(s, { planId: plan.id, status: 'pending_payment', renewsAt: null, cancelAtPeriodEnd: false });
      s.history.push({ at: Date.now(), event: 'change_requested', from: prev, to: plan.id, note: 'payment provider not configured' });
      saveDB();
      return {
        ok: false, status: 'pending_payment',
        message: 'Payment is not set up yet, so the plan has not started. Your request is recorded as awaiting payment.',
      };
    }

    const order = await Billing.createOrder({ vendorId, planId: plan.id, amount: plan.price });
    if (!order.ok) {
      Object.assign(s, { planId: plan.id, status: 'pending_payment' });
      s.history.push({ at: Date.now(), event: 'payment_failed', to: plan.id, note: order.error || 'order could not be created' });
      saveDB();
      return { ok: false, status: 'pending_payment', message: order.error || 'The payment could not be started.' };
    }
    Object.assign(s, { planId: plan.id, status: 'pending_payment', paymentRef: order.orderId });
    s.history.push({ at: Date.now(), event: 'order_created', to: plan.id, ref: order.orderId });
    saveDB();
    return { ok: true, status: 'pending_payment', order, message: 'Complete the payment to activate your plan.' };
  },

  cancel(vendorId) {
    const s = this.forVendor(vendorId);
    if (s.planId === 'free') return { ok: false, message: 'You are already on the free Starter plan.' };
    s.cancelAtPeriodEnd = true;
    s.status = 'cancelling';
    s.history.push({ at: Date.now(), event: 'cancel_requested', from: s.planId });
    saveDB();
    return { ok: true, message: s.renewsAt
      ? 'Your plan will not renew. You keep its features until the period ends.'
      : 'Your plan will not renew.' };
  },
  resume(vendorId) {
    const s = this.forVendor(vendorId);
    if (!s.cancelAtPeriodEnd) return { ok: false, message: 'This plan is not cancelling.' };
    s.cancelAtPeriodEnd = false;
    s.status = s.renewsAt && Date.now() < s.renewsAt ? 'active' : 'pending_payment';
    s.history.push({ at: Date.now(), event: 'cancel_revoked' });
    saveDB();
    return { ok: true, message: 'Your plan will renew as usual.' };
  },

  /**
   * Activation. Only two callers are legitimate: a verified payment webhook
   * replayed to the client, or an administrator acting deliberately.
   */
  activate(vendorId, { planId, byAdmin, paymentRef, periodDays }) {
    if (!byAdmin && !paymentRef) throw new Error('Activation needs a verified payment reference or an administrator.');
    const s = this.forVendor(vendorId);
    const days = periodDays || 30;
    Object.assign(s, {
      planId: planId || s.planId, status: 'active', startedAt: Date.now(),
      renewsAt: Date.now() + days * 864e5, cancelAtPeriodEnd: false,
      paymentRef: paymentRef || null,
    });
    s.history.push({ at: Date.now(), event: 'activated', to: s.planId, by: byAdmin ? 'administrator' : 'payment', ref: paymentRef || null });
    saveDB();
    return s;
  },
};

/* ---------------------------------------------------------------------------
   Billing — the payment provider boundary.

   Razorpay is the intended provider (India, UPI/cards/netbanking). Orders are
   created server-side and activation happens only from a webhook whose
   signature the server has verified. Nothing here can mark a plan paid on its
   own; without the backend, status() reports `configured: false` and the UI
   says so plainly.
   --------------------------------------------------------------------------- */
const Billing = {
  _cache: null,
  async status() {
    if (this._cache) return this._cache;
    const health = await Api.health();
    this._cache = {
      configured: !!(health.ok && health.providers && health.providers.payments && health.providers.payments.configured),
      provider: (health.providers && health.providers.payments && health.providers.payments.provider) || 'razorpay',
      reason: health.ok ? ((health.providers.payments && health.providers.payments.reason) || null) : health.error,
    };
    return this._cache;
  },
  reset() { this._cache = null; },
  async createOrder({ vendorId, planId, amount }) {
    try {
      const res = await Api.post('billing/create-order', { vendorId, planId, amount });
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, orderId: res.data.orderId, amount: res.data.amount, currency: res.data.currency, keyId: res.data.keyId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
