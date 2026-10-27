/* ===========================================================================
   auth.js — accounts, password hashing, sessions, role checks.

   ARCHITECTURE NOTE (important, please read before Phase 2)
   ---------------------------------------------------------------------------
   ScrapDaddy is currently a static site (GitHub Pages). There is no server, so
   every check in this file runs in the visitor's own browser. That is enough to
   give real users real accounts, sessions and role-based navigation, but it is
   NOT a security boundary: anyone with browser dev tools can edit local state.

   The code is therefore written against one narrow provider interface:

     provider.createUser({email,password,name,role,...}) -> user
     provider.verify(email, password)                    -> user | null
     provider.getUser(id)                                -> user | null
     provider.updateUser(id, patch)                      -> user
     provider.listUsers()                                -> user[]
     provider.setPassword(email, password)               -> user

   LocalAuthProvider (below) implements it in localStorage. To make auth real,
   implement the same interface against a backend (see RemoteAuthProvider at the
   bottom) and set Auth.provider to it — no view code has to change.
   ========================================================================= */
'use strict';

const USERS_KEY = 'scrapdaddy.users.v1';
const SESSION_KEY = 'scrapdaddy.session.v1';

const ROLES = ['household', 'vendor', 'factory', 'transporter', 'admin'];
/* Roles a visitor may pick when creating their own account. 'admin' is absent
   by design: an administrator can only be created by another administrator. */
const SIGNUP_ROLES = ['household', 'vendor', 'factory', 'transporter'];

const ROLE_META = {
  household: { label: 'Household',  icon: '🏡', home: '#/household', blurb: 'Sell scrap from your home or society.' },
  vendor:    { label: 'Vendor',     icon: '🛺', home: '#/vendor',    blurb: 'Collect, weigh and consolidate scrap.' },
  factory:   { label: 'Factory',    icon: '🏭', home: '#/factory',   blurb: 'Buy graded lots with GST paperwork.' },
  transporter: { label: 'Transporter', icon: '🚚', home: '#/transport', blurb: 'Move lots from hubs to factories.' },
  admin:     { label: 'Administrator', icon: '🛡️', home: '#/admin',  blurb: 'Platform operations and oversight.' },
};

const SESSION_IDLE_MS = 30 * 60 * 1000;   // signed out after 30 min of inactivity
const SESSION_MAX_MS = 12 * 60 * 60 * 1000; // hard cap regardless of activity
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 1000;

/* ---------- byte / base64 helpers ---------- */
const bytesToB64 = bytes => btoa(String.fromCharCode.apply(null, Array.from(bytes)));
const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const randomB64 = n => bytesToB64(crypto.getRandomValues(new Uint8Array(n)));

const subtleReady = () => typeof crypto !== 'undefined' && !!crypto.subtle && !!crypto.subtle.deriveBits;

/* PBKDF2-SHA256 when the browser exposes WebCrypto (HTTPS / localhost).
   The fallback exists only so the app still opens from file:// — it is weak and
   is recorded in the record so verification stays consistent. */
const PBKDF2_ITERS = 120000;
async function derive(password, saltB64, iters) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations: iters, hash: 'SHA-256' }, key, 256);
  return bytesToB64(new Uint8Array(bits));
}
function weakHash(password, saltB64) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = saltB64 + '|' + password;
  for (let round = 0; round < 1200; round++) {
    for (let i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
      h2 = Math.imul(h2 + s.charCodeAt(i) + round, 2246822519) >>> 0;
    }
  }
  return 'w' + h1.toString(36) + h2.toString(36);
}
async function hashPassword(password) {
  const salt = subtleReady() ? randomB64(16) : String(Date.now()) + Math.random().toString(36).slice(2);
  if (subtleReady()) return { alg: 'pbkdf2-sha256', iters: PBKDF2_ITERS, salt, hash: await derive(password, salt, PBKDF2_ITERS) };
  return { alg: 'fallback-weak', iters: 1200, salt, hash: weakHash(password, salt) };
}
async function checkPassword(password, rec) {
  if (!rec || !rec.hash) return false;
  if (rec.alg === 'pbkdf2-sha256') {
    if (!subtleReady()) return false;
    return (await derive(password, rec.salt, rec.iters || PBKDF2_ITERS)) === rec.hash;
  }
  return weakHash(password, rec.salt) === rec.hash;
}

/* ---------- validation shared by UI and provider ---------- */
function passwordProblem(pw) {
  const v = String(pw || '');
  if (v.length < 8) return 'Use at least 8 characters.';
  if (!/[a-zA-Z]/.test(v)) return 'Include at least one letter.';
  if (!/[0-9]/.test(v)) return 'Include at least one number.';
  return null;
}
function passwordScore(pw) {
  const v = String(pw || '');
  let s = 0;
  if (v.length >= 8) s++;
  if (v.length >= 12) s++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
  if (/[0-9]/.test(v)) s++;
  if (/[^a-zA-Z0-9]/.test(v)) s++;
  return Math.min(4, s);
}

/* ---------- local provider ---------- */
const LocalAuthProvider = {
  name: 'local',
  _all() { return Store.read(USERS_KEY, []); },
  _put(list) { Store.write(USERS_KEY, list); },
  listUsers() { return this._all().map(u => this._public(u)); },
  _public(u) {
    if (!u) return null;
    const { pw, ...rest } = u; // never hand the password record to view code
    return rest;
  },
  getUser(id) { return this._public(this._all().find(u => u.id === id)); },
  getByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return this._all().find(u => u.email === e) || null;
  },
  async createUser({ email, password, name, role, phone, locality, pin, sample }) {
    const e = String(email || '').trim().toLowerCase();
    if (!isEmail(e)) throw new AuthError('Enter a valid email address.', 'email');
    if (this.getByEmail(e)) throw new AuthError('An account already exists with this email.', 'email');
    const pwProblem = passwordProblem(password);
    if (pwProblem) throw new AuthError(pwProblem, 'password');
    if (!ROLES.includes(role)) throw new AuthError('Choose a valid account type.', 'role');
    const user = {
      id: uid('u'), email: e, name: String(name || '').trim() || e.split('@')[0],
      role, phone: phone || '', locality: locality || '', pin: pin || '',
      status: 'active', createdAt: Date.now(), sample: !!sample,
      pw: await hashPassword(password),
    };
    const list = this._all(); list.push(user); this._put(list);
    return this._public(user);
  },
  async verify(email, password) {
    const u = this.getByEmail(email);
    if (!u) return null;
    const ok = await checkPassword(password, u.pw);
    return ok ? this._public(u) : null;
  },
  updateUser(id, patch) {
    const list = this._all();
    const i = list.findIndex(u => u.id === id);
    if (i < 0) throw new AuthError('Account not found.');
    // Role changes never travel through the generic update path.
    const { role, pw, id: _ignore, ...safe } = patch || {};
    list[i] = Object.assign({}, list[i], safe);
    this._put(list);
    return this._public(list[i]);
  },
  setRole(id, role) {
    if (!ROLES.includes(role)) throw new AuthError('Unknown role.');
    const list = this._all();
    const i = list.findIndex(u => u.id === id);
    if (i < 0) throw new AuthError('Account not found.');
    list[i].role = role; this._put(list);
    return this._public(list[i]);
  },
  async setPassword(email, password) {
    const problem = passwordProblem(password);
    if (problem) throw new AuthError(problem, 'password');
    const list = this._all();
    const i = list.findIndex(u => u.email === String(email || '').trim().toLowerCase());
    if (i < 0) throw new AuthError('No account found with that email.', 'email');
    list[i].pw = await hashPassword(password);
    this._put(list);
    return this._public(list[i]);
  },
};

class AuthError extends Error {
  constructor(message, field) { super(message); this.name = 'AuthError'; this.field = field || null; }
}

/* ---------- demo accounts ----------
   Sample accounts so the product can be reviewed without signing up. They are
   flagged sample:true and are listed on the sign-in screen — except the
   administrator, whose credentials are handed over separately. */
const DEMO_SEED = [
  { id: DEMO_USERS.household, email: 'priya@demo.scrapdaddy.in', password: 'demo1234', name: 'Priya Reddy',
    role: 'household', phone: '9876543210', locality: 'Green Valley Apartments, Jubilee Hills', pin: '500033' },
  { id: DEMO_USERS.vendor, email: 'srinivas@demo.scrapdaddy.in', password: 'demo1234', name: 'Srinivas Rao',
    role: 'vendor', phone: '9876500447', locality: 'Kukatpally', pin: '500072' },
  { id: DEMO_USERS.factory, email: 'buyer@demo.scrapdaddy.in', password: 'demo1234', name: 'GreenEarth Recyclers',
    role: 'factory', phone: '9876511234', locality: 'Patancheru Industrial Area', pin: '502319' },
  { id: DEMO_USERS.admin, email: 'admin@scrapdaddy.in', password: 'ScrapAdmin!2026', name: 'Platform Admin',
    role: 'admin', phone: '', locality: '', pin: '', hidden: true },
];

/* ---------- session + public API ---------- */
const Auth = {
  provider: LocalAuthProvider,
  _session: null,
  _listeners: [],
  ready: false,

  async init() {
    await this._seedDemoAccounts();
    this._session = this._loadSession();
    this.ready = true;
    return this._session;
  },

  async _seedDemoAccounts() {
    const existing = this.provider.listUsers();
    for (const d of DEMO_SEED) {
      if (existing.some(u => u.email === d.email)) continue;
      try {
        const u = await this.provider.createUser({
          email: d.email, password: d.password, name: d.name, role: d.role,
          phone: d.phone, locality: d.locality, pin: d.pin, sample: true,
        });
        // keep the stable demo ids so seeded listings stay linked to their owner
        if (u.id !== d.id) {
          const list = Store.read(USERS_KEY, []);
          const rec = list.find(x => x.id === u.id);
          if (rec) { rec.id = d.id; rec.hidden = !!d.hidden; Store.write(USERS_KEY, list); }
        }
      } catch (e) { console.warn('[auth] demo seed skipped', d.email, e.message); }
    }
  },

  /** Sample accounts offered on the sign-in screen (never the administrator). */
  demoAccounts() {
    return DEMO_SEED.filter(d => !d.hidden)
      .map(d => ({ email: d.email, password: d.password, name: d.name, role: d.role }));
  },

  /* --- session plumbing --- */
  _loadSession() {
    const s = Store.read(SESSION_KEY, null);
    if (!s || !s.uid) return null;
    const now = Date.now();
    if (now > s.absExp) { this._clear(); this.expiredReason = 'max'; return null; }
    if (now > s.idleExp) { this._clear(); this.expiredReason = 'idle'; return null; }
    const user = this.provider.getUser(s.uid);
    if (!user || user.status !== 'active') { this._clear(); return null; }
    // the stored role is advisory; the account record is the source of truth
    s.role = user.role;
    return s;
  },
  _clear() { Store.remove(SESSION_KEY); this._session = null; },
  _start(user) {
    const now = Date.now();
    const s = { uid: user.id, role: user.role, iat: now, idleExp: now + SESSION_IDLE_MS, absExp: now + SESSION_MAX_MS };
    Store.write(SESSION_KEY, s);
    this._session = s;
    this._emit();
    return s;
  },
  touch() {
    const s = this._session;
    if (!s) return;
    const now = Date.now();
    if (now > s.absExp || now > s.idleExp) return; // let the next check expire it
    if (s.idleExp - now > SESSION_IDLE_MS - 60000) return; // throttle writes to once a minute
    s.idleExp = now + SESSION_IDLE_MS;
    Store.write(SESSION_KEY, s);
  },
  /** Re-reads storage; returns null when the session has expired or was cleared. */
  check() { this._session = this._loadSession(); return this._session; },
  session() { return this._session; },
  user() { return this._session ? this.provider.getUser(this._session.uid) : null; },
  role() { const u = this.user(); return u ? u.role : null; },
  isSignedIn() { return !!this._session && !!this.user(); },
  can(roles) {
    if (!roles || !roles.length) return true;
    const r = this.role();
    return !!r && roles.indexOf(r) !== -1;
  },
  homeFor(role) { return (ROLE_META[role] || ROLE_META.household).home; },

  onChange(fn) { this._listeners.push(fn); },
  _emit() { this._listeners.forEach(fn => { try { fn(this._session); } catch (e) { console.error(e); } }); },

  /* --- rate limiting for sign-in --- */
  _attemptKey(email) { return 'scrapdaddy.att.' + String(email || '').trim().toLowerCase(); },
  _attempts(email) { return Store.read(this._attemptKey(email), { n: 0, until: 0 }); },
  lockedFor(email) {
    const a = this._attempts(email);
    return a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 1000) : 0;
  },
  _fail(email) {
    const a = this._attempts(email);
    a.n = (a.n || 0) + 1;
    if (a.n >= MAX_ATTEMPTS) { a.until = Date.now() + LOCK_MS; a.n = 0; }
    Store.write(this._attemptKey(email), a);
  },
  _succeed(email) { Store.remove(this._attemptKey(email)); },

  /* --- actions --- */
  async signIn(email, password) {
    const wait = this.lockedFor(email);
    if (wait) throw new AuthError(`Too many attempts. Try again in ${wait} seconds.`);
    const user = await this.provider.verify(email, password);
    if (!user) { this._fail(email); throw new AuthError('Email or password is incorrect.', 'password'); }
    if (user.status !== 'active') throw new AuthError('This account has been suspended. Contact support.');
    this._succeed(email);
    this._start(user);
    return user;
  },
  async signUp(data) {
    // Hard stop: self-service sign-up can never mint an administrator.
    if (!SIGNUP_ROLES.includes(data.role)) throw new AuthError('Choose a valid account type.', 'role');
    const user = await this.provider.createUser(Object.assign({}, data, { role: data.role }));
    if (user.role === 'vendor') this._ensureVendorRecord(user);
    if (user.role === 'transporter') this._ensureTransporterRecord(user);
    this._start(user);
    return user;
  },
  signOut() { this._clear(); this._emit(); },
  async resetPassword(email, password) {
    const user = await this.provider.setPassword(email, password);
    this._succeed(email);
    return user;
  },
  async changePassword(current, next) {
    const u = this.user();
    if (!u) throw new AuthError('You are not signed in.');
    const ok = await this.provider.verify(u.email, current);
    if (!ok) throw new AuthError('Current password is incorrect.', 'current');
    await this.provider.setPassword(u.email, next);
    return true;
  },
  updateProfile(patch) {
    const u = this.user();
    if (!u) throw new AuthError('You are not signed in.');
    return this.provider.updateUser(u.id, patch);
  },
  /** Administrator-only. Guarded again by the caller's route permissions. */
  adminSetRole(userId, role) {
    if (this.role() !== 'admin') throw new AuthError('Administrator access required.');
    if (userId === this._session.uid) throw new AuthError('You cannot change your own role.');
    return this.provider.setRole(userId, role);
  },
  adminSetStatus(userId, status) {
    if (this.role() !== 'admin') throw new AuthError('Administrator access required.');
    if (userId === this._session.uid) throw new AuthError('You cannot suspend your own account.');
    return this.provider.updateUser(userId, { status });
  },

  /** A new transporter account gets a carrier record, pending admin approval. */
  _ensureTransporterRecord(user) {
    if (transporterForUser(user.id)) return transporterForUser(user.id);
    const t = {
      id: nextId('t'), userId: user.id, name: user.name, vehicle: 'e3w', capacityKg: vehicleCapacity('e3w'),
      area: user.locality || '', pin: user.pin || '', verified: false, status: 'pending',
      trips: 0, kgMoved: 0, joinedAt: Date.now(), sample: false,
    };
    DB.transporters.push(t); saveDB();
    return t;
  },

  /** A new vendor account gets a collection record, pending admin approval. */
  _ensureVendorRecord(user) {
    if (vendorForUser(user.id)) return vendorForUser(user.id);
    const v = {
      id: nextId('v'), name: user.name, hub: user.locality ? ('Hub — ' + user.locality) : 'Hub — pending',
      userId: user.id, kycVerified: false, scaleVerified: false, status: 'pending', sample: false,
    };
    DB.vendors.push(v); saveDB();
    return v;
  },
};

/* ---------------------------------------------------------------------------
   RemoteAuthProvider — the Phase 2 drop-in. NOT ACTIVE.
   It is included so the backend contract is pinned down now; wiring it up needs
   a host that can run server code (see the Phase 1 report) plus the endpoints
   below. Until then Auth.provider stays on LocalAuthProvider.
   --------------------------------------------------------------------------- */
function RemoteAuthProvider(baseUrl) {
  const call = async (path, body, method) => {
    const res = await fetch(baseUrl + path, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // server sets an httpOnly session cookie
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AuthError(data.message || 'Request failed.', data.field);
    return data;
  };
  return {
    name: 'remote',
    createUser: d => call('/auth/signup', d),
    verify: (email, password) => call('/auth/signin', { email, password }).catch(() => null),
    getUser: () => { throw new AuthError('Remote provider requires an async session lookup.'); },
    listUsers: () => call('/admin/users', null, 'GET'),
    updateUser: (id, patch) => call('/users/' + id, patch, 'PATCH'),
    setPassword: (email, password) => call('/auth/reset', { email, password }),
  };
}
