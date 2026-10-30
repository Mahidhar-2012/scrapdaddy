/* ===========================================================================
   icons.js — the ScrapHub icon set.

   One consistent family of line icons replacing the emoji the interface used
   to lean on. Emoji render differently on every platform, carry a cartoon tone
   and are read aloud by screen readers, none of which suits a product people
   are asked to trust with money.

   Every icon is a 24x24 stroke drawing that inherits currentColor, so an icon
   always matches the text beside it. They are decorative by default
   (aria-hidden), because the label next to them already says what they mean;
   pass a title only when an icon stands alone.
   ========================================================================= */
'use strict';

/* Path data only — the wrapper adds the common attributes. */
const ICON_PATHS = {
  /* --- navigation and structure --- */
  dashboard:  '<path d="M3 13h8V3H3zM13 21h8V11h-8zM13 7h8V3h-8zM3 21h8v-4H3z"/>',
  home:       '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 21v-6h5v6"/>',
  list:       '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  clipboard:  '<path d="M9 3h6v3H9z"/><path d="M15 4.5h2.5A1.5 1.5 0 0 1 19 6v13.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5V6a1.5 1.5 0 0 1 1.5-1.5H9"/><path d="M9 11h6M9 15h4"/>',
  settings:   '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  menu:       '<path d="M3 6h18M3 12h18M3 18h18"/>',
  users:      '<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/>',
  user:       '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5v-1a4.5 4.5 0 0 1 4.5-4.5h6a4.5 4.5 0 0 1 4.5 4.5v1"/>',
  shield:     '<path d="M12 3 5 6v5.5c0 4.3 2.9 8.1 7 9.3 4.1-1.2 7-5 7-9.3V6z"/>',
  shieldCheck:'<path d="M12 3 5 6v5.5c0 4.3 2.9 8.1 7 9.3 4.1-1.2 7-5 7-9.3V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  logout:     '<path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6"/>',

  /* --- commerce and operations --- */
  truck:      '<path d="M2.5 16V7a1 1 0 0 1 1-1H14v10"/><path d="M14 9.5h3.6a1 1 0 0 1 .8.4l2.6 3.3a1 1 0 0 1 .2.6V16"/><circle cx="7" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/><path d="M9 17.5h6.5M2.5 16H5"/>',
  factory:    '<path d="M3 21V10l5.5 3.5V10L14 13.5V7l6.5 4V21z"/><path d="M7 21v-3.5M12 21v-3.5M17 21v-3.5"/>',
  warehouse:  '<path d="M3 21V9l9-5 9 5v12"/><path d="M8 21v-7h8v7"/><path d="M8 17.5h8"/>',
  box:        '<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
  layers:     '<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 13l9 5 9-5M3 16.5l9 5 9-5"/>',
  scale:      '<path d="M12 4v16M7 20h10"/><path d="M12 7 5 9.5M12 7l7 2.5"/><path d="M2.5 14.5 5 9.5l2.5 5a2.5 2.5 0 0 1-5 0zM16.5 14.5 19 9.5l2.5 5a2.5 2.5 0 0 1-5 0z"/>',
  wallet:     '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2"/><path d="M3 7.5V18a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 7.5z"/><circle cx="16" cy="13.5" r="1.1" fill="currentColor" stroke="none"/>',
  card:       '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
  coins:      '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/><path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  tag:        '<path d="M3.5 11.6V4.5a1 1 0 0 1 1-1h7.1a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7z"/><circle cx="7.8" cy="7.8" r="1.4"/>',
  trending:   '<path d="M3 17l6-6 4 4 7.5-7.5"/><path d="M15 7.5h5.5V13"/>',
  receipt:    '<path d="M5 3.5h14v17l-2.3-1.6-2.4 1.6-2.3-1.6-2.4 1.6L7.3 19 5 20.5z"/><path d="M9 8.5h6M9 12.5h6"/>',
  handshake:  '<path d="M11 7.5 8.6 9.9a1.8 1.8 0 0 0 2.5 2.5l1.4-1.4 3.2 3.2a1.8 1.8 0 0 1-2.5 2.5"/><path d="M13.2 16.7a1.8 1.8 0 0 1-2.6 0l-.9-.9"/><path d="M2.5 8.5 6 5.5l4 1.5M21.5 8.5 18 5.5l-3.5 1.3-2 .7"/><path d="M18 6v8.5M6 6v8.5"/>',
  gift:       '<rect x="3.5" y="9" width="17" height="4" rx="1"/><path d="M5 13v6.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V13M12 9v11.5"/><path d="M12 9S10.5 4 8 4a2 2 0 0 0 0 5zM12 9s1.5-5 4-5a2 2 0 0 1 0 5z"/>',

  /* --- actions --- */
  search:     '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/>',
  filter:     '<path d="M3.5 5.5h17l-6.5 7.5v6l-4 2v-8z"/>',
  refresh:    '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4.5V10H15"/>',
  plus:       '<path d="M12 5v14M5 12h14"/>',
  close:      '<path d="M6 6l12 12M18 6L6 18"/>',
  check:      '<path d="M4.5 12.5 9.5 17.5 19.5 7"/>',
  arrowRight: '<path d="M4 12h15"/><path d="M13 6l6 6-6 6"/>',
  chevronDown:'<path d="M6 9.5l6 6 6-6"/>',
  send:       '<path d="M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 10z"/>',
  download:   '<path d="M12 3.5v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1.5"/>',
  trash:      '<path d="M4 6.5h16M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/><path d="M6.5 6.5 7.4 20a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-13.5"/><path d="M10.5 10.5v6M13.5 10.5v6"/>',
  camera:     '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.8l1.4-2.2a1 1 0 0 1 .84-.46h4.92a1 1 0 0 1 .84.46L16.7 7h2.8A1.5 1.5 0 0 1 21 8.5v10A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z"/><circle cx="12" cy="13" r="3.8"/>',
  image:      '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="10" r="1.8"/><path d="M3.5 17l5-5 3.5 3.5 3-3 5.5 5.5"/>',
  eye:        '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:     '<path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.2 0 10 6 10 6a18 18 0 0 1-3.1 3.6M6.5 7.9A17.6 17.6 0 0 0 2 12s3.8 6 10 6a9.6 9.6 0 0 0 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/>',
  mic:        '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3.5M8.5 21.5h7"/>',
  stop:       '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  volume:     '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16 9a4.5 4.5 0 0 1 0 6M18.8 6.5a8 8 0 0 1 0 11"/>',
  volumeOff:  '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
  message:    '<path d="M21 11.5a8 8 0 0 1-8.5 8 9 9 0 0 1-3.8-.8L3 20.5l1.8-5.4A8 8 0 0 1 4 11.5a8 8 0 0 1 8.5-8 8 8 0 0 1 8.5 8z"/>',
  phone:      '<path d="M21 16.9v2.6a1.7 1.7 0 0 1-1.9 1.7 17 17 0 0 1-7.4-2.6 16.6 16.6 0 0 1-5.1-5.1A17 17 0 0 1 4 6a1.7 1.7 0 0 1 1.7-1.9h2.6a1.7 1.7 0 0 1 1.7 1.5c.1.9.3 1.7.6 2.5a1.7 1.7 0 0 1-.4 1.8l-1.1 1.1a13.6 13.6 0 0 0 5.1 5.1l1.1-1.1a1.7 1.7 0 0 1 1.8-.4c.8.3 1.6.5 2.5.6a1.7 1.7 0 0 1 1.4 1.7z"/>',
  location:   '<path d="M19 10.5c0 5.2-7 11-7 11s-7-5.8-7-11a7 7 0 0 1 14 0z"/><circle cx="12" cy="10.3" r="2.6"/>',
  clock:      '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
  hourglass:  '<path d="M7 3h10M7 21h10"/><path d="M7 3v3.5c0 2 2.2 3.8 3.6 4.8.5.4.5 1 0 1.4C9.2 13.7 7 15.5 7 17.5V21M17 3v3.5c0 2-2.2 3.8-3.6 4.8-.5.4-.5 1 0 1.4 1.4 1 3.6 2.8 3.6 4.8V21"/>',

  /* --- status --- */
  alert:      '<path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  info:       '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.5v5M12 8h.01"/>',
  help:       '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4M12 17h.01"/>',
  ban:        '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  sparkle:    '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  leaf:       '<path d="M20 4S18 14 11 15.5C7 16.4 4.6 14.4 4.3 11.6 3.9 8.2 7 4.6 20 4z"/><path d="M4 20c2-6 6-9 11-11"/>',
  recycle:    '<path d="M7.6 9.5 5 14a2 2 0 0 0 1.7 3H10"/><path d="M12.2 4.6 14.8 9M16.4 14.5 19 10a2 2 0 0 0-1.7-3H14"/><path d="M10.5 20.4 8 16"/><path d="M8 19.2 10.5 20.4 9.3 17.9M14 4.8 11.4 6 13.9 7.2M18.6 12.8 19.3 10 16.6 10.6"/>',

  /* --- material categories --- */
  metals:     '<path d="M12 2.8 20 7v10l-8 4.2L4 17V7z"/><path d="M12 8.2 16 10.4v4.2L12 16.8 8 14.6v-4.2z"/>',
  plastics:   '<path d="M10 2.8h4v2.4l1.6 1.8a3 3 0 0 1 .8 2v11a2 2 0 0 1-2 2H9.6a2 2 0 0 1-2-2V9a3 3 0 0 1 .8-2L10 5.2z"/><path d="M7.8 12.5h8.4"/>',
  paper:      '<path d="M4 5.5h13a1 1 0 0 1 1 1V19a1.5 1.5 0 0 0 1.5 1.5H5.5A1.5 1.5 0 0 1 4 19z"/><path d="M18 8.5h2v10.5a1.5 1.5 0 0 1-1.5 1.5"/><path d="M7 9h7M7 12.5h7M7 16h4"/>',
  ewaste:     '<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2.5v2M15 2.5v2M9 19.5v2M15 19.5v2M2.5 9h2M2.5 15h2M19.5 9h2M19.5 15h2"/>',
};

/* Icons whose drawing reads better filled than stroked. */
const SOLID_ICONS = { check: 0 };

/**
 * One inline SVG icon.
 * @param {string} name   key from ICON_PATHS
 * @param {object} [opts] { size, cls, title, strokeWidth }
 */
function ico(name, opts) {
  const o = opts || {};
  const d = ICON_PATHS[name];
  if (!d) { console.warn('[icons] unknown icon:', name); return ''; }
  const size = o.size || 20;
  const labelled = !!o.title;
  return `<svg class="ico${o.cls ? ' ' + o.cls : ''}" width="${size}" height="${size}" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="${o.strokeWidth || 1.7}"
    stroke-linecap="round" stroke-linejoin="round"
    ${labelled ? `role="img" aria-label="${esc(o.title)}"` : 'aria-hidden="true" focusable="false"'}
  >${d}</svg>`;
}

/** The category icon for a material group. */
const CAT_ICON = { metals: 'metals', plastics: 'plastics', paper: 'paper', ewaste: 'ewaste' };
const catIcon = (cat, opts) => ico(CAT_ICON[cat] || 'box', opts);

/** The icon that stands for a role. */
const ROLE_ICON = { household: 'home', vendor: 'truck', factory: 'factory', transporter: 'truck', admin: 'shieldCheck' };
const roleIcon = (role, opts) => ico(ROLE_ICON[role] || 'user', opts);

/* ---------------------------------------------------------------- brand ---- */
/** Full lockup: emblem plus wordmark. */
function brandLockup(opts) {
  const o = opts || {};
  return `<span class="brand-lockup${o.cls ? ' ' + o.cls : ''}">
    <img src="assets/mark.png" alt="" class="brand-mark" width="${o.mark || 30}" height="${o.mark || 30}">
    <span class="brand-word">Scrap<b>Hub</b></span>
  </span>`;
}
/** Emblem alone, for tight spaces. */
const brandMark = (size) =>
  `<img src="assets/mark.png" alt="ScrapHub" class="brand-mark" width="${size || 32}" height="${size || 32}">`;
