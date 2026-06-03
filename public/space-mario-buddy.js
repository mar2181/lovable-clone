/* Space Mario — Pet Buddy body for the HS Web App Builder (lovable-clone).
 *
 * Loaded once after the petconcierge embed.js (see components/pet-concierge.tsx).
 * It makes the premium astronaut the ONLY mascot while keeping "Gary's" brain
 * (the live ElevenLabs agent + nav + worker tools) exactly as-is.
 *
 * Four jobs (identical pattern to petbuddyconcierge.com's space-mario-concierge.js,
 * only BASE differs — assets are vendored locally at /space-mario/):
 *   1. ONE BODY. Hard-hides embed.js's own launcher (.pc-sprite) + legacy
 *      .pb-jack-float / .pb-jack-status with !important CSS. The voice state
 *      machine stays alive.
 *   2. TOOL BRIDGE. Registers window.__PetConciergeTools so the agent can DRIVE
 *      the body: point_at / walk_to / jump_onto / look_at / give_tour / do_move.
 *      embed.js merges these into clientTools at session start (built-ins win on
 *      collision, so these are purely additive).
 *   3. VOICE. Clicking Space Mario starts the concierge; he reacts to the call.
 *   4. ZERO-G. Rocket entrance, floats, hovers — the cinematic moves get used.
 *
 * Fully reversible: remove this one <script> tag and the page reverts to Gary.
 */
(function () {
  if (window.__SPACE_MARIO_CONCIERGE) return;
  window.__SPACE_MARIO_CONCIERGE = true;

  var BASE = '/space-mario/';
  var ENGINE = ['hermes-player.js', 'hermes-behavior.js', 'hermes-spatial.js', 'space-mario.js', 'manifest.js'];

  // The real moves in the manifest — the whitelist do_move() validates against.
  var MOVES = ['backflip', 'bow', 'celebrate', 'cheer', 'clap', 'dance', 'facepalm',
    'float', 'flyforward', 'hover', 'idle', 'jet', 'jump', 'leap', 'lookaround',
    'moonwalk', 'nod', 'peek', 'point', 'run', 'salute', 'shrug', 'sit', 'sleep',
    'spin', 'stretch', 'talk', 'think', 'thumbsup', 'turn', 'turnpoint', 'walk', 'wave',
    'pointup', 'pointdown', 'pointleft', 'pointright', 'reach', 'waveoff', 'shakeno',
    'lookup', 'land', 'standup'];

  /* ───────────────────────── 1. ONE BODY ───────────────────────── */
  function injectHideCss() {
    if (document.getElementById('sm-hide-legacy')) return;
    var s = document.createElement('style');
    s.id = 'sm-hide-legacy';
    s.textContent =
      '.pc-overlay .pc-sprite{display:none!important;visibility:hidden!important;}' +
      '.pb-jack-float{display:none!important;visibility:hidden!important;pointer-events:none!important;}' +
      '.pb-jack-status{display:none!important;visibility:hidden!important;}';
    (document.head || document.documentElement).appendChild(s);
  }
  function hideLegacy() {
    injectHideCss();
    var ns = document.querySelectorAll('.pb-jack-float, .pb-jack-status');
    for (var i = 0; i < ns.length; i++) {
      ns[i].style.display = 'none';
      ns[i].setAttribute('aria-hidden', 'true');
      ns[i].tabIndex = -1;
    }
  }

  /* ───────────────── target resolver (data-pc | selector | visible text) ───────────────── */
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
  function isVisible(n) {
    try { var r = n.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && getComputedStyle(n).visibility !== 'hidden'; }
    catch (e) { return true; }
  }
  function findByText(text) {
    var needle = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!needle) return null;
    var sel = 'h1,h2,h3,h4,h5,h6,button,a,[role=button],[aria-label],.pet-card h3,.sm-feature-title,[data-pc]';
    var nodes = document.querySelectorAll(sel), best = null, bestLen = 1e9;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!isVisible(n)) continue;
      var hay = ((n.getAttribute && n.getAttribute('aria-label')) || n.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!hay) continue;
      if (hay === needle) return n;
      if (hay.indexOf(needle) !== -1 && hay.length < bestLen) { best = n; bestLen = hay.length; }
    }
    return best;
  }
  function resolveEl(q) {
    if (!q) return null;
    if (q.nodeType) return q;
    q = String(q).trim();
    var el = document.querySelector('[data-pc="' + cssEsc(q) + '"]');
    if (el) return el;
    try { el = document.querySelector(q); if (el) return el; } catch (e) {}
    return findByText(q);
  }
  function bring(el) { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} }

  function smInst() { return window.__SM_INST || null; }
  function withBody(fn) {
    var i = smInst();
    if (!i || !i.behavior) return 'One sec — Space Mario is still warming up his jets. Ask me again in a moment.';
    try { return fn(i.behavior, i); } catch (e) { console.error('[space-mario] tool error', e); return 'I had trouble doing that just now.'; }
  }

  /* ───────────────────────── 2. TOOL BRIDGE ───────────────────────── */
  function registerTools() {
    var host = (window.__PetConciergeTools && typeof window.__PetConciergeTools === 'object') ? window.__PetConciergeTools : {};
    var tools = {
      point_at: function (p) {
        p = p || {}; var el = resolveEl(p.target);
        if (!el) return 'I could not find "' + (p.target || '') + '" on this page.';
        bring(el);
        return withBody(function (b) { setTimeout(function () { b.goPointAt(el, { hold: 2800 }); }, 420); return 'Flying over to point at ' + (p.target || 'it') + '.'; });
      },
      walk_to: function (p) {
        p = p || {}; var el = resolveEl(p.target);
        if (!el) return 'I could not find "' + (p.target || '') + '".';
        bring(el);
        return withBody(function (b) { setTimeout(function () { b.goTo(el); }, 420); return 'Heading over to ' + (p.target || 'it') + '.'; });
      },
      jump_onto: function (p) {
        p = p || {}; var el = resolveEl(p.target);
        if (!el) return 'I could not find "' + (p.target || '') + '".';
        bring(el);
        return withBody(function (b) { setTimeout(function () { b.jumpTo(el, { point: true }); }, 420); return 'Hopping up onto ' + (p.target || 'it') + '.'; });
      },
      look_at: function (p) {
        p = p || {}; var el = resolveEl(p.target);
        if (!el) return 'I could not find "' + (p.target || '') + '".';
        return withBody(function (b) { b.lookAt(el, {}); return 'Looking over at ' + (p.target || 'it') + '.'; });
      },
      do_move: function (p) {
        p = p || {}; var mv = String(p.move || '').toLowerCase().replace(/[^a-z]/g, '');
        if (MOVES.indexOf(mv) === -1) return 'I do not have a "' + (p.move || '') + '" move. Try one of: wave, point, cheer, thumbsup, salute, jet, float, hover, spin, dance, backflip, bow.';
        return withBody(function (b) { b.react(mv); return 'Doing ' + mv + '.'; });
      },
      give_tour: function (p) {
        p = p || {};
        var raw = p.stops;
        var list = Array.isArray(raw) ? raw : String(raw || '').split(',');
        var stops = list.map(function (s) {
          var tgt = (s && s.target != null) ? s.target : s;
          var el = resolveEl(String(tgt).trim());
          return el ? { target: el, say: (s && s.say), hold: ((s && s.hold_ms) || 2800) } : null;
        }).filter(Boolean);
        if (!stops.length) return 'I could not find any of those stops on this page.';
        return withBody(function (b) { b.tour(stops, { onStep: function () {} }); return 'Starting the tour — ' + stops.length + ' stops. Narrate as I fly.'; });
      }
    };
    for (var k in tools) { if (!(k in host)) host[k] = tools[k]; }
    window.__PetConciergeTools = host;
    try { console.log('[space-mario] body tools registered:', Object.keys(tools).join(', ')); } catch (e) {}
  }
  registerTools(); // immediate — embed.js reads window.__PetConciergeTools at session start

  /* ───────────────────────── 3 + 4. mount + voice + zero-g ───────────────────────── */
  function loadSeq(list, done) {
    var i = 0;
    (function next() {
      if (i >= list.length) return done();
      var s = document.createElement('script');
      s.src = BASE + list[i++]; s.async = false;
      s.onload = next;
      s.onerror = function () { console.error('[space-mario] failed to load', s.src); next(); };
      document.head.appendChild(s);
    })();
  }

  function startVoice(i) {
    try { i && i.behavior && i.behavior.react('wave'); } catch (e) {}
    var tries = 0;
    (function go() {
      if (window.PetConcierge && typeof window.PetConcierge.start === 'function') {
        try { window.PetConcierge.start(); } catch (e) { console.error('[space-mario] PetConcierge.start failed', e); }
      } else if (tries++ < 40) { setTimeout(go, 150); }
      else { console.warn('[space-mario] window.PetConcierge not ready — voice unavailable'); }
    })();
  }

  function wireVoice(i) {
    if (!i || !i.behavior) return;
    var talkTimer = null;
    function talkLoop(on) {
      if (on) {
        if (!talkTimer) {
          try { i.behavior.react('talk'); } catch (e) {}
          talkTimer = setInterval(function () { if (i.behavior && !i.behavior.busy) { try { i.behavior.react('talk'); } catch (e) {} } }, 2600);
        }
      } else if (talkTimer) { clearInterval(talkTimer); talkTimer = null; }
    }
    var tries = 0;
    (function poll() {
      if (window.PetConcierge && typeof window.PetConcierge.on === 'function') {
        try {
          window.PetConcierge.on('start', function () { try { i.behavior.react('salute'); } catch (e) {} talkLoop(true); });
          window.PetConcierge.on('end', function () { talkLoop(false); });
          window.PetConcierge.on('error', function (m) { if (m != null && m !== '' && m !== 'null') talkLoop(false); });
        } catch (e) {}
      } else if (tries++ < 50) { setTimeout(poll, 200); }
    })();
    var jack = document.querySelector('.pb-jack-float');
    if (jack) {
      try {
        new MutationObserver(function () {
          var st = jack.getAttribute('data-pc-state') || '';
          if (st === 'live') talkLoop(true);
          else { talkLoop(false); if (st === 'connecting') { try { i.behavior.react('think'); } catch (e) {} } }
        }).observe(jack, { attributes: true, attributeFilter: ['data-pc-state'] });
      } catch (e) {}
    }
  }

  /* ───────────────────── dismiss / hush / recall controls ───────────────────── */
  var STORAGE_DISMISS = 'sm-dismissed';

  function toggleVoice(i) {
    try {
      if (window.PetConcierge && window.PetConcierge.isActive) {
        try { i && i.behavior && i.behavior.react('waveoff'); } catch (e) {}
        try { window.PetConcierge.end(); } catch (e) {}
        return;
      }
    } catch (e) {}
    startVoice(i);
  }

  function sendAway(i) {
    if (!i || !i.behavior || !i.el) return;
    var b = i.behavior, el = i.el;
    try { if (window.PetConcierge && window.PetConcierge.isActive) window.PetConcierge.end(); } catch (e) {}
    try { sessionStorage.setItem(STORAGE_DISMISS, '1'); } catch (e) {}
    try { b.react('waveoff'); } catch (e) {}
    setTimeout(function () {
      try {
        b.busy = true;
        var bh = el.offsetHeight || 200;
        b.p.play('jet', { facing: 1, restart: true });
        b._glide(b.x, (window.innerHeight + bh + 40), b._dur(1400)).then(function () { el.style.display = 'none'; showRecallTab(); });
      } catch (e) { el.style.display = 'none'; showRecallTab(); }
    }, 850);
  }

  function recallMario() {
    try { sessionStorage.removeItem(STORAGE_DISMISS); } catch (e) {}
    hideRecallTab();
    var i = smInst();
    if (i && i.el && i.behavior) {
      i.el.style.display = '';
      try { i.behavior.busy = false; i.behavior.replayEntrance(); } catch (e) {}
    } else { mount(); }
  }

  function showRecallTab() {
    var ex = document.getElementById('sm-recall');
    if (ex) { ex.style.display = ''; return; }
    var t = document.createElement('button');
    t.id = 'sm-recall'; t.type = 'button'; t.textContent = '🚀 Bring back your concierge';
    t.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483601;border:1px solid #2f6b46;' +
      'background:#13241c;color:#b9f5cf;font:600 13px/1 system-ui;padding:11px 14px;border-radius:999px;' +
      'cursor:pointer;box-shadow:0 8px 26px #0008;';
    t.addEventListener('click', function (e) { e.stopPropagation(); recallMario(); });
    document.body.appendChild(t);
  }
  function hideRecallTab() { var t = document.getElementById('sm-recall'); if (t) t.style.display = 'none'; }

  function attachControls(i) {
    if (!i || !i.el || i.el.querySelector('.sm-dismiss')) return;
    var btn = document.createElement('button');
    btn.className = 'sm-dismiss'; btn.type = 'button';
    btn.title = 'Send Space Mario away'; btn.setAttribute('aria-label', 'Send Space Mario away');
    btn.textContent = '✕';
    btn.style.cssText = 'position:absolute;top:8px;right:8px;width:26px;height:26px;border-radius:50%;' +
      'border:1px solid #ffffff55;background:#0b0e18cc;color:#fff;font:700 13px/1 system-ui;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .18s;z-index:5;pointer-events:auto;';
    btn.addEventListener('click', function (e) { e.stopPropagation(); sendAway(i); });
    i.el.appendChild(btn);
    i.el.addEventListener('mouseenter', function () { btn.style.opacity = '1'; });
    i.el.addEventListener('mouseleave', function () { btn.style.opacity = '0'; });
    i.el.addEventListener('touchstart', function () { btn.style.opacity = '1'; setTimeout(function () { btn.style.opacity = '0'; }, 3000); }, { passive: true });
  }

  function mount() {
    hideLegacy();
    try { if (sessionStorage.getItem(STORAGE_DISMISS) === '1') { showRecallTab(); return; } } catch (e) {}
    if (!window.SpaceMario) { console.error('[space-mario] engine not available'); return; }
    var vw = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1024;
    var bodySize = vw < 640 ? 156 : 220;
    window.SpaceMario.mount({
      base: BASE, corner: 'br', personality: 'normal', size: bodySize,
      entrance: 'rise',
      speed: 0.7,
      idleCalmMs: 22000,
      idlePlayMs: 240000,
      z: 2147483600, onClick: toggleVoice,
      onReady: function (inst) { window.__SM_INST = inst; wireVoice(inst); attachControls(inst); }
    });
  }

  function boot() { hideLegacy(); loadSeq(ENGINE, mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(hideLegacy, 1500);
})();
