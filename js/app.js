/* ===========================================================================
   app.js — routes, access guards, authentication screens, event wiring.
   ========================================================================= */
'use strict';

/* ---------- authentication screens ---------- */
const AuthForm = { email: '', password: '', name: '', role: 'household', confirm: '', busy: false, error: null, field: null, show: false };

function authShell(inner) {
  const tonnes = DB.lots.reduce((s, l) => s + l.kg, 0) / 1000;
  return `<div class="auth">
    <section class="auth-art">
      <div class="glow"></div>
      <div class="bl lg">♻️ Scrap<b>Daddy</b></div>
      <div class="bl">
        <h2>Turn household scrap into fair, traceable value.</h2>
        <p>One platform for residents, local vendors and recycling factories — with weighed quantities,
           transparent rates and GST-ready paperwork.</p>
        <ul class="auth-pts">
          <li><span class="tick">✓</span><span>Free doorstep pickup at published rates</span></li>
          <li><span class="tick">✓</span><span>Verified vendors who weigh on a digital scale</span></li>
          <li><span class="tick">✓</span><span>Bulk lots and tax paperwork for factories</span></li>
        </ul>
      </div>
      <div class="auth-stats">
        <div><b>${DB.listings.length}</b><span>sample listings</span></div>
        <div><b>${DB.vendors.length}</b><span>sample vendors</span></div>
        <div><b>${num(tonnes)}t</b><span>sample hub stock</span></div>
      </div>
    </section>
    <section class="auth-form"><div class="auth-box">${inner}</div></section>
  </div>`;
}
const authError = () => AuthForm.error ? `<div class="mt-3" style="margin-bottom:16px">${notice(esc(AuthForm.error), 'danger', '⚠️')}</div>` : '';
const submitBtn = label => `<button class="btn btn-lg btn-block" type="submit" ${AuthForm.busy ? 'disabled' : ''}>
  ${AuthForm.busy ? '<span class="spinner sm"></span> Please wait…' : esc(label)}</button>`;

function viewSignIn() {
  const expired = Auth.expiredReason;
  Auth.expiredReason = null;
  return authShell(`
    <h1>Sign in</h1>
    <p class="sub">Access your ScrapDaddy portal.</p>
    ${expired ? `<div style="margin-bottom:16px">${notice(expired === 'idle'
      ? 'You were signed out after 30 minutes of inactivity.'
      : 'Your session reached its time limit. Please sign in again.', 'amber', '⏱️')}</div>` : ''}
    ${authError()}
    <form data-form="signin" novalidate>
      ${field({ label: 'Email', name: 'email', type: 'email', value: AuthForm.email, placeholder: 'you@example.com',
        autocomplete: 'email', error: AuthForm.field === 'email' ? ' ' : null, attrs: ' data-autofocus' })}
      <label class="field" for="f_password"><span class="lbl">Password</span>
        <span class="input-group">
          <input class="input" id="f_password" name="password" data-input="password" autocomplete="current-password"
            type="${AuthForm.show ? 'text' : 'password'}" value="${esc(AuthForm.password)}" placeholder="Your password">
          <button class="btn btn-ghost btn-icon" type="button" data-act="togglePw"
            aria-label="${AuthForm.show ? 'Hide' : 'Show'} password">${AuthForm.show ? '🙈' : '👁️'}</button>
        </span>
      </label>
      <div class="row-between" style="margin:-4px 0 16px">
        <span></span><a href="#/forgot" class="t-sm">Forgot password?</a>
      </div>
      ${submitBtn('Sign in')}
    </form>
    <p class="auth-alt">New to ScrapDaddy? <a href="#/signup">Create an account</a></p>
    <div class="auth-foot">
      <div class="t-xs muted strong">DEMO ACCOUNTS — sample data, safe to use</div>
      <div class="demo-accounts">
        ${Auth.demoAccounts().map(d => `<button class="demo-acc" type="button" data-act="useDemo" data-email="${esc(d.email)}">
            <span class="avatar" style="width:28px;height:28px;font-size:11px">${esc(ROLE_META[d.role].icon)}</span>
            <span><span class="nm">${esc(d.name)}</span><br><span class="em">${esc(d.email)}</span></span>
            <span class="go">Use →</span></button>`).join('')}
      </div>
    </div>`);
}

function viewSignUp() {
  const score = passwordScore(AuthForm.password);
  const colors = ['#C62828', '#C62828', '#B45309', '#16A34A', '#15803D'];
  return authShell(`
    <h1>Create your account</h1>
    <p class="sub">Free to join. Choose the portal that matches you.</p>
    ${authError()}
    <form data-form="signup" novalidate>
      ${field({ label: 'Full name', name: 'name', value: AuthForm.name, placeholder: 'Your name', autocomplete: 'name', attrs: ' data-autofocus' })}
      ${field({ label: 'Email', name: 'email', type: 'email', value: AuthForm.email, placeholder: 'you@example.com', autocomplete: 'email' })}
      <div class="field"><span class="lbl">I am a…</span>
        <div class="seg block" role="group" aria-label="Account type">
          ${SIGNUP_ROLES.map(r => `<button type="button" data-act="pickRole" data-v="${r}" aria-pressed="${AuthForm.role === r}">
            ${ROLE_META[r].icon} ${esc(ROLE_META[r].label)}</button>`).join('')}
        </div>
        <span class="hint">${esc(ROLE_META[AuthForm.role].blurb)}</span>
      </div>
      <label class="field" for="f_password"><span class="lbl">Password</span>
        <span class="input-group">
          <input class="input" id="f_password" name="password" data-input="password" autocomplete="new-password"
            type="${AuthForm.show ? 'text' : 'password'}" value="${esc(AuthForm.password)}" placeholder="At least 8 characters">
          <button class="btn btn-ghost btn-icon" type="button" data-act="togglePw"
            aria-label="${AuthForm.show ? 'Hide' : 'Show'} password">${AuthForm.show ? '🙈' : '👁️'}</button>
        </span>
        <span class="pw-meter"><i id="pwBar" style="width:${score * 25}%;background:${colors[score]}"></i></span>
        <span class="hint">Use at least 8 characters, including a letter and a number.</span>
      </label>
      ${submitBtn('Create account')}
    </form>
    <p class="auth-alt">Already have an account? <a href="#/login">Sign in</a></p>`);
}

function viewForgot() {
  return authShell(`
    <h1>Reset password</h1>
    <p class="sub">Set a new password for your account.</p>
    ${notice(`<strong>Demo limitation.</strong> No email is sent — the new password is applied immediately in this browser.
      A real deployment must email a single-use, expiring reset link from the server.`, 'amber', '⚠️')}
    <div class="mt-4"></div>
    ${authError()}
    <form data-form="reset" novalidate>
      ${field({ label: 'Email', name: 'email', type: 'email', value: AuthForm.email, placeholder: 'you@example.com', autocomplete: 'email', attrs: ' data-autofocus' })}
      ${field({ label: 'New password', name: 'password', type: 'password', value: AuthForm.password, placeholder: 'At least 8 characters', autocomplete: 'new-password' })}
      ${submitBtn('Set new password')}
    </form>
    <p class="auth-alt"><a href="#/login">Back to sign in</a></p>`);
}

/* ---------- error views ---------- */
const viewForbidden = () => emptyState({
  icon: '🔒', title: 'You do not have access to this area',
  text: 'This page belongs to a different ScrapDaddy portal. If you think this is wrong, contact an administrator.',
  action: `<a class="btn" href="${Auth.homeFor(Auth.role())}">Back to my portal</a>`,
});
const viewNotFound = () => emptyState({
  icon: '🧭', title: 'Page not found', text: 'That link does not lead anywhere in ScrapDaddy.',
  action: `<a class="btn" href="${Auth.isSignedIn() ? Auth.homeFor(Auth.role()) : '#/login'}">Go back</a>`,
});

/* ---------- route table ---------- */
const ROUTES = [
  { path: '#/login',  chrome: 'auth', guest: true, render: viewSignIn },
  { path: '#/signup', chrome: 'auth', guest: true, render: viewSignUp },
  { path: '#/forgot', chrome: 'auth', guest: true, render: viewForgot },

  { path: '#/household',          roles: ['household'], title: 'Overview',    subtitle: 'Your scrap at a glance', render: viewHouseholdOverview },
  { path: '#/household/sell',     roles: ['household'], title: 'Sell scrap',  subtitle: 'List an item for pickup', render: viewHouseholdSell },
  { path: '#/household/listings', roles: ['household'], title: 'My listings', subtitle: 'Track offers and pickups', render: viewHouseholdListings },

  { path: '#/vendor',         roles: ['vendor'], title: 'Overview',      subtitle: 'Your collection round', render: viewVendorOverview },
  { path: '#/vendor/find',    roles: ['vendor'], title: 'Jobs board',    subtitle: 'Open pickups near you', render: viewVendorFind },
  { path: '#/vendor/pickups', roles: ['vendor'], title: 'My pickups',    subtitle: 'Weigh, pay and move to hub', render: viewVendorPickups },
  { path: '#/vendor/hub',     roles: ['vendor'], title: 'Hub inventory', subtitle: 'Bale and publish factory lots', render: viewVendorHub },
  { path: '#/vendor/plan',    roles: ['vendor'], title: 'Plan & billing', subtitle: 'Your subscription and limits', render: viewVendorPlan },

  { path: '#/factory',        roles: ['factory'], title: 'Overview',    subtitle: 'Supply and purchasing', render: viewFactoryOverview },
  { path: '#/factory/market', roles: ['factory'], title: 'Marketplace', subtitle: 'Graded lots and direct listings', render: viewFactoryMarket },
  { path: '#/factory/orders', roles: ['factory'], title: 'Orders',      subtitle: 'Your purchases and paperwork', render: viewFactoryOrders },
  { path: '#/factory/sponsor', roles: ['factory'], title: 'Sponsor a transporter', subtitle: 'Back the carriers who move your lots', render: viewFactorySponsor },

  { path: '#/transport',             roles: ['transporter'], title: 'Overview',     subtitle: 'Your runs and sponsorship', render: viewTransportOverview },
  { path: '#/transport/jobs',        roles: ['transporter'], title: 'Delivery jobs', subtitle: 'Loads waiting for a carrier', render: viewTransportJobs },
  { path: '#/transport/mine',        roles: ['transporter'], title: 'My runs',       subtitle: 'Collect and deliver', render: viewTransportMine },
  { path: '#/transport/sponsorship', roles: ['transporter'], title: 'Sponsorship',   subtitle: 'Ask sponsors to fund your work', render: viewTransportSponsorship },

  { path: '#/admin',          roles: ['admin'], title: 'Platform overview', subtitle: 'Operations dashboard', render: viewAdminOverview },
  { path: '#/admin/ledger',   roles: ['admin'], title: 'Transactions',      subtitle: 'Every recorded movement', render: viewAdminLedger },
  { path: '#/admin/vendors',  roles: ['admin'], title: 'Vendors',           subtitle: 'Verification and approval', render: viewAdminVendors },
  { path: '#/admin/accounts', roles: ['admin'], title: 'Accounts',          subtitle: 'Roles and access', render: viewAdminAccounts },
  { path: '#/admin/transport', roles: ['admin'], title: 'Transport & sponsorship', subtitle: 'Carriers, runs and funding', render: viewAdminTransport },
  { path: '#/admin/rates',    roles: ['admin'], title: 'Rates & compliance', subtitle: 'Reference prices and GST', render: viewAdminRates },

  { path: '#/rates',   roles: ROLES, title: 'Scrap prices', subtitle: 'Reference prices with their sources', render: viewPrices },
  { path: '#/account', roles: ROLES, title: 'Settings',     subtitle: 'Profile, password and session', render: viewAccount },
];

/* ---------- router with access guards ---------- */
const Router = {
  current: null,
  go(hash) {
    if (location.hash === hash) this.render();
    else location.hash = hash;
  },
  parse() {
    const raw = location.hash || '';
    const [path, query] = raw.split('?');
    return { path: path || '', params: new URLSearchParams(query || '') };
  },
  render() {
    const { path, params } = this.parse();
    const signedIn = !!Auth.check();

    // root / unknown-but-empty → send somewhere sensible
    if (!path || path === '#' || path === '#/') {
      return this.go(signedIn ? Auth.homeFor(Auth.role()) : '#/login');
    }
    const route = ROUTES.find(r => r.path === path);

    // guest-only screens
    if (route && route.guest) {
      if (signedIn) return this.go(Auth.homeFor(Auth.role()));
      return this.paintAuth(route);
    }
    // everything else requires a session
    if (!signedIn) {
      AuthForm.error = null;
      const next = encodeURIComponent(path);
      location.hash = '#/login?next=' + next;
      return;
    }
    if (!route) return this.paintApp({ title: 'Not found' }, viewNotFound());
    if (!Auth.can(route.roles)) {
      console.warn('[guard] blocked', path, 'for role', Auth.role());
      return this.paintApp({ title: 'Access denied' }, viewForbidden());
    }
    this.current = route;
    // reset before the view runs: views register their own partial re-render
    View.renderResults = null;
    this.paintApp(route, route.render(params));
  },
  paintAuth(route) {
    this.current = route;
    $('#sidebar').hidden = true;
    $('#topbar').hidden = true;
    $('#banner').innerHTML = '';
    Chat.open = false;
    Chat.mount();
    document.body.classList.add('is-auth');
    $('#view').style.padding = '0';
    $('#view').style.maxWidth = 'none';
    $('#view').innerHTML = route.render();
    const a = $('[data-autofocus]');
    if (a) setTimeout(() => a.focus(), 40);
  },
  paintApp(route, html) {
    $('#sidebar').hidden = false;
    $('#topbar').hidden = false;
    document.body.classList.remove('is-auth');
    $('#view').style.padding = '';
    $('#view').style.maxWidth = '';
    renderShell(route);
    renderDemoBanner();
    $('#view').innerHTML = html;
    closeNav();
    Chat.mount();
    if (route.path === '#/household/sell') {
      bindPhotoInput();
      if (View.scanReady === null) refreshScanAvailability();
    }
  },
  start() {
    window.addEventListener('hashchange', () => { Modal.close(); this.render(); window.scrollTo(0, 0); });
    this.render();
  },
};

/* ---------- navigation drawer (mobile) ---------- */
function openNav() { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; const b = $('.burger'); if (b) b.setAttribute('aria-expanded', 'true'); }
function closeNav() { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; const b = $('.burger'); if (b) b.setAttribute('aria-expanded', 'false'); }
A.toggleNav = () => { $('#sidebar').classList.contains('open') ? closeNav() : openNav(); };
A.goAccount = () => Router.go('#/account');
A.hideDemoBanner = () => { Store.write('scrapdaddy.demoBannerHidden', true); renderDemoBanner(); };
A.modalClose = () => Modal.close();
A.togglePw = () => { AuthForm.show = !AuthForm.show; Router.render(); };
A.pickRole = d => { AuthForm.role = d.v; Router.render(); };
A.useDemo = d => {
  const acc = Auth.demoAccounts().find(a => a.email === d.email);
  if (!acc) return;
  AuthForm.email = acc.email; AuthForm.password = acc.password; AuthForm.error = null;
  submitSignIn();
};
A.signOut = () => {
  Auth.signOut();
  View.filters = {}; View.form = null;
  View.scanReport = null; View.scanError = null; View.healthSnapshot = null;
  Chat.open = false; Chat.messages = []; Chat.stopListening(); Chat.shutUp();
  AuthForm.email = ''; AuthForm.password = ''; AuthForm.error = null;
  Router.go('#/login');
  toast('Signed out');
};
A.toggleFilters = () => {
  const f = currentFilters();
  if (f) { f.open = !f.open; Router.render(); }
};
A.clearFilters = () => {
  const f = currentFilters();
  if (!f) return;
  Object.assign(f, blankFilter({ src: f.src === 'hub' || f.src === 'household' ? f.src : 'all' }), { open: true });
  Router.render();
};
A.setCat = d => {
  const f = currentFilters();
  if (!f) return;
  f.cat = d.v;
  Router.render();
};
function currentFilters() {
  const p = (location.hash || '').split('?')[0];
  if (p === '#/household/listings') return filtersFor('hh');
  if (p === '#/vendor/find') return filtersFor('vendor');
  if (p === '#/factory/market') return filtersFor('factory', { src: 'hub' });
  if (p === '#/admin/ledger') return filtersFor('admin');
  if (p === '#/transport/jobs') return filtersFor('transport');
  if (p === '#/factory/sponsor') return filtersFor('sponsor');
  return null;
}

/* ---------- authentication submits ---------- */
async function submitSignIn() {
  if (AuthForm.busy) return;
  AuthForm.busy = true; AuthForm.error = null; Router.render();
  try {
    const user = await Auth.signIn(AuthForm.email, AuthForm.password);
    AuthForm.busy = false; AuthForm.password = '';
    const next = Router.parse().params.get('next');
    const target = next ? decodeURIComponent(next) : Auth.homeFor(user.role);
    const route = ROUTES.find(r => r.path === target);
    Router.go(route && !route.guest && Auth.can(route.roles) ? target : Auth.homeFor(user.role));
    toast(`Welcome back, ${user.name.split(' ')[0]}`);
  } catch (e) {
    AuthForm.busy = false; AuthForm.error = e.message; AuthForm.field = e.field || null;
    Router.render();
  }
}
async function submitSignUp() {
  if (AuthForm.busy) return;
  if (!String(AuthForm.name).trim()) { AuthForm.error = 'Please enter your name.'; return Router.render(); }
  if (!isEmail(AuthForm.email)) { AuthForm.error = 'Enter a valid email address.'; return Router.render(); }
  const problem = passwordProblem(AuthForm.password);
  if (problem) { AuthForm.error = problem; return Router.render(); }
  AuthForm.busy = true; AuthForm.error = null; Router.render();
  try {
    const user = await Auth.signUp({ name: AuthForm.name, email: AuthForm.email, password: AuthForm.password, role: AuthForm.role });
    AuthForm.busy = false; AuthForm.password = '';
    Router.go(Auth.homeFor(user.role));
    toast('Account created — welcome to ScrapDaddy');
  } catch (e) {
    AuthForm.busy = false; AuthForm.error = e.message; Router.render();
  }
}
async function submitReset() {
  if (AuthForm.busy) return;
  AuthForm.busy = true; AuthForm.error = null; Router.render();
  try {
    await Auth.resetPassword(AuthForm.email, AuthForm.password);
    AuthForm.busy = false; AuthForm.password = '';
    Router.go('#/login');
    toast('Password updated — please sign in');
  } catch (e) {
    AuthForm.busy = false; AuthForm.error = e.message; Router.render();
  }
}

/* ---------- global event wiring ---------- */
document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  if (kind === 'signin') submitSignIn();
  else if (kind === 'signup') submitSignUp();
  else if (kind === 'reset') submitReset();
  else if (kind === 'chat') {
    const input = $('#chatInput');
    if (input && input.value.trim()) { const v = input.value; input.value = ''; Chat.send(v); }
  }
});

document.addEventListener('click', e => {
  if (e.target === $('#modal')) return Modal.close();
  if (e.target === $('#scrim')) return closeNav();
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const act = el.dataset.act;
  const fn = A[act];
  if (!fn) return;
  e.preventDefault();
  Auth.touch();
  try { fn(el.dataset, el); }
  catch (err) { console.error('[action] ' + act, err); toast('Something went wrong — please try again', 'err'); }
});

document.addEventListener('change', e => {
  const el = e.target;
  // selects carry their action here, since the click handler skips them
  if (el.tagName === 'SELECT' && el.dataset.act && A[el.dataset.act]) { A[el.dataset.act](el.dataset, el); return; }
  if (el.dataset.filter) return; // handled on input
  const name = el.dataset.input;
  if (!name) return;
  if (el.closest('#sellWrap') && View.form) {
    const f = View.form;
    if (name === 'cat') {
      f.cat = el.value;
      f.rk = MATERIALS[f.cat][0][0];
      f.unit = PIECE_KG[f.rk] ? 'pieces' : 'kg';
      redrawSell();
    } else if (name === 'rk') {
      f.rk = el.value;
      if (PIECE_KG[f.rk]) f.unit = 'pieces';
      redrawSell();
    } else if (name === 'unit' || name === 'slot') {
      f[name] = el.value;
      redrawSell();
    }
  }
});

let filterTimer = null;
document.addEventListener('input', e => {
  const el = e.target;
  Auth.touch();
  if (el.dataset.filter) {
    const f = currentFilters();
    if (!f) return;
    f[el.dataset.filter] = el.value;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { if (View.renderResults) View.renderResults(); }, 140);
    return;
  }
  const name = el.dataset.input;
  if (!name) return;
  // authentication screens
  if (el.closest('[data-form]')) {
    if (name in AuthForm) AuthForm[name] = el.value;
    if (name === 'password' && $('#pwBar')) {
      const score = passwordScore(el.value);
      const colors = ['#C62828', '#C62828', '#B45309', '#16A34A', '#15803D'];
      $('#pwBar').style.width = (score * 25) + '%';
      $('#pwBar').style.background = colors[score];
    }
    return;
  }
  // sell form: update state without re-rendering so focus is kept
  if (el.closest('#sellWrap') && View.form) {
    const f = View.form;
    if (['title', 'desc', 'qty', 'ask', 'locality', 'pin'].indexOf(name) >= 0) {
      f[name] = el.value;
      const kg = kgOf(f.qty, f.rk, f.unit);
      const v = $('#estValue'), m = $('#estMeta');
      if (v) v.textContent = estimateText(f);
      const nEl = $('#estNote');
      if (nEl) nEl.textContent = estRangeText(f);
      if (m) m.textContent = `${num(kg)} kg · ${num(co2For(f.cat, kg))} kg CO₂ saved`;
    }
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (Modal.isOpen()) Modal.close();
    else if ($('#sidebar').classList.contains('open')) closeNav();
  }
  Modal.trap(e);
});
['click', 'keydown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, () => Auth.touch(), { passive: true }));

/* Re-check the session periodically and when the tab regains focus, so an
   expired session cannot sit on a protected screen. */
function watchSession() {
  if (!Auth.ready) return;
  const path = (location.hash || '').split('?')[0];
  const route = ROUTES.find(r => r.path === path);
  if (route && route.guest) return;
  if (!Auth.check() && !$('#sidebar').hidden) {
    Modal.close();
    Router.go('#/login');
    toast('Your session expired — please sign in again', 'warn');
  }
}
setInterval(watchSession, 30000);
window.addEventListener('focus', watchSession);
window.addEventListener('storage', e => { if (e.key === SESSION_KEY) watchSession(); });

/* ---------- bootstrap ---------- */
(async function boot() {
  if (!Store.available()) {
    $('#boot').innerHTML = `<div class="boot-in"><div class="boot-logo">⚠️</div>
      <p style="max-width:34ch">ScrapDaddy needs browser storage to keep you signed in.
      Please turn off private browsing or allow site data, then reload.</p></div>`;
    return;
  }
  try {
    await Promise.all([
      Auth.init(),
      Pricing.load(),   // never rejects: falls back to built-in rates and reports it
    ]);
  } catch (e) {
    console.error('[boot] startup failed', e);
  }
  $('#boot').hidden = true;
  $('#root').hidden = false;
  Auth.onChange(() => { /* reserved: cross-tab sync hooks */ });
  Router.start();
})();
