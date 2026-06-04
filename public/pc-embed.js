/*!
 * Pet Concierge — voice-driven floating sprite, drop-in for any website.
 *
 * Usage:
 *   <script src="https://www.petbuddyconcierge.com/embed.js" data-token="your-token"
 *           data-endpoint="https://petconcierge.vercel.app/api/voice-session"
 *           data-asset-base="https://petconcierge.vercel.app"></script>
 *
 * Optional attributes:
 *   data-endpoint  — override the signed-URL endpoint (defaults to <script origin>/api/voice-session)
 *   data-asset-base — override where /pets/donald/spritesheet.webp is served from
 *   data-autostart — "false" to NOT auto-bind click handler (host controls via window.PetConcierge.start())
 *   data-name      — override the displayed name (default "Donald")
 *   data-accent    — override accent color (default #ef4444)
 *
 * Ported from C:/Users/mario/donald-sprite-skill/components/TrumpAgent.tsx
 * Bakes in every one of the 11 hard-won rules from docs/hard-won-lessons.md.
 *
 * License: MIT (this loader). Spritesheet asset Apache-2.0 (claumarin / OpenDesign).
 */
(function () {
  "use strict";

  if (window.__PetConciergeLoaded) {
    console.warn("[PC] embed.js already loaded, ignoring second load");
    return;
  }
  window.__PetConciergeLoaded = true;

  // ── Autoplay guard ────────────────────────────────────────────────────────
  // The ElevenLabs SDK creates its OUTPUT AudioContext when the session
  // starts. If startSession resolves AFTER the click's transient
  // user-activation has lapsed (e.g. a cold cross-origin SDK import on first
  // load, as happens when the buddy is embedded on a fresh third-party page),
  // that context is born "suspended" — the agent connects and animates but
  // produces NO sound. We register every AudioContext the page creates and
  // expose resumeAudio(), called right after startSession and on any user
  // gesture, to un-suspend them. Wrapped in try/catch so a failure here can
  // never break buddies: on any error the native AudioContext is left intact.
  const __pcAudioContexts = [];
  function resumeAudio() {
    for (let i = 0; i < __pcAudioContexts.length; i++) {
      const c = __pcAudioContexts[i];
      try {
        if (c && c.state === "suspended" && typeof c.resume === "function") c.resume();
      } catch (_) {}
    }
  }
  (function patchAudioContext() {
    try {
      const Native = window.AudioContext || window.webkitAudioContext;
      if (!Native || Native.__pcWrapped) return;
      function Wrapped(options) {
        const ctx = (options === undefined) ? new Native() : new Native(options);
        try { __pcAudioContexts.push(ctx); } catch (_) {}
        return ctx; // ctor returning an object → `new Wrapped()` yields a real AudioContext
      }
      Wrapped.prototype = Native.prototype; // keep `instanceof AudioContext` true
      Wrapped.__pcWrapped = true;
      if (window.AudioContext) window.AudioContext = Wrapped;
      if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
      ["pointerdown", "click", "keydown", "touchend"].forEach(function (ev) {
        window.addEventListener(ev, resumeAudio, true);
      });
    } catch (_) { /* leave native AudioContext untouched on any failure */ }
  })();

  // ── Config from <script data-*> attributes ────────────────────────────────
  const SCRIPT_EL = document.currentScript ||
    Array.from(document.scripts).find(function (s) {
      return /embed\.js(\?.*)?$/.test(s.src || "");
    });
  function attr(name, fallback) {
    if (!SCRIPT_EL) return fallback;
    const v = SCRIPT_EL.getAttribute(name);
    return (v == null || v === "") ? fallback : v;
  }
  function originOf(url) {
    try { return new URL(url, location.href).origin; } catch (_) { return ""; }
  }

  const SCRIPT_ORIGIN = SCRIPT_EL && SCRIPT_EL.src ? originOf(SCRIPT_EL.src) : location.origin;

  // data-pet defaults — sensible per-pet name/glyph/greeting so customers
  // who pick "juan" don't end up with a sprite labeled "Donald" reading
  // Trump's "we've got deals to close" line. data-name / data-glyph /
  // data-greeting / data-sprite-src always win when explicitly set.
  const PET_DEFAULTS = {
    donald: { name: "Donald", glyph: "🇺🇸", greeting: "Alright, let's get to work. We've got deals to close." },
    jack:   { name: "Jack",   glyph: "💼", greeting: "Hey, I'm Jack. Tell me what you're looking for and I'll get you there." },
    juan:   { name: "Juan",   glyph: "💼", greeting: "Hi, I'm Juan. Ask me anything — I'll show you around." },
    gary:   { name: "Gary",   glyph: "👓", greeting: "Hi there, I'm Gary. What can I help you find today?" },
    choco:  { name: "Choco",  glyph: "🐶", greeting: "Hi! I'm Choco. Want me to show you around?" },
    happy:  { name: "Happy",  glyph: "🦊", greeting: "Hey there! I'm Happy. Ask me anything about this site." },
    "space-mario": { name: "Space Mario", glyph: "🚀", greeting: "Mission control here. Tap me and I'll show you around." },
  };
  const petKey = (attr("data-pet", "") || "donald").toLowerCase();
  const PET_DEF = PET_DEFAULTS[petKey] || PET_DEFAULTS.donald;

  const CONFIG = {
    token:      attr("data-token", ""),
    endpoint:   attr("data-endpoint", SCRIPT_ORIGIN + "/api/voice-session"),
    // Voice backend. "elevenlabs" (default) = today's ConvAI path, untouched.
    // "selfhosted" = the Pipecat/Chatterbox box (Phase B). The Vercel broker
    // (B6) normally selects this per-pet; data-backend forces it for staging.
    backend:    attr("data-backend", "elevenlabs"),
    // Self-hosted only: base origin of the GPU box (…/api/offer + …/api/dev-token).
    // In production the broker returns connectUrl; this is the staging fallback.
    connectUrl: attr("data-connect-url", ""),
    assetBase:  attr("data-asset-base", SCRIPT_ORIGIN),
    autostart:  attr("data-autostart", "true") !== "false",
    pet:        petKey,
    name:       attr("data-name", PET_DEF.name),
    accent:     attr("data-accent", "#ef4444"),
    glyph:      attr("data-glyph", PET_DEF.glyph),
    greeting:   attr("data-greeting", PET_DEF.greeting),
    // "none" → render the emoji glyph only, no atlas spritesheet. Any other
    // value is treated as a path (relative to assetBase) to a sprite atlas.
    // Default derived from data-pet so customers don't need to specify the
    // sprite path; explicit data-sprite-src always wins.
    spriteSrc:  attr("data-sprite-src", "/pets/" + petKey + "/spritesheet.webp"),
    // Builder-pet only: the host AI app builder's worker URL (used by
    // read_code_view to fetch the generated project's source files).
    // Default empty — non-builder hosts simply never call read_code_view.
    workerUrl:  attr("data-worker", ""),
    // Opt-in expressive behaviors. Default OFF so existing Pet Buddy
    // customer sites are unaffected. lovable-clone (Gary) opts in via
    // data-ambient="true" and data-wander="true" on its <script> tag.
    // Ambient = randomly cycle non-idle atlas rows during idle gaps
    //           (waving, jumping, waiting, review) so the pet feels alive.
    // Wander  = slow horizontal stroll across viewport every 30-60s while
    //           nothing else is happening; uses running-left/-right poses.
    // Both pause automatically during calls, drags, bubble-open, and when
    // the browser reports prefers-reduced-motion.
    ambient:    attr("data-ambient", "false") === "true",
    wander:     attr("data-wander", "false") === "true",
  };

  const VERSION = "0.1.0";
  const STORAGE_KEY_POS = "petconcierge.position";
  const STORAGE_KEY_MIC = "petconcierge.preferredMic";
  // Set by navigate_to right before the page reload. Read by boot() on the
  // next page; if recent + matching token, we auto-reconnect so the call
  // survives the full-document navigation a static site forces on us.
  const STORAGE_KEY_RESUME = "petconcierge.resume";
  // Text-zoom multiplier set by the set_text_size tool. Persisted so the
  // visitor's chosen size survives navigation, and re-applied on boot().
  const STORAGE_KEY_TEXT_SCALE = "petconcierge.textScale";
  // Onboarding memory. A full-document navigation tears down the WebSocket and
  // starts a BRAND-NEW ElevenLabs conversation that has zero transcript history
  // — so without this the agent forgets the website/email/business the visitor
  // already gave it the instant it changes pages ("he has no context of the
  // information I just gave him"). We persist every collected detail here and
  // replay it into each (re)connect's contextualUpdate so the agent stays
  // stateful across navigations. Same-origin sessionStorage is shared with the
  // host page's own wizard, so the form and the agent see the same facts.
  const STORAGE_KEY_MEMORY = "petconcierge.memory";
  const MEMORY_TTL_MS = 30 * 60 * 1000; // 30 min — long enough for a real signup, short enough to not leak across visits
  const RESUME_TTL_MS = 15000;
  const MAX_RECONNECT_ATTEMPTS = 2;
  const NAVIGATE_DELAY_MS = 1800;
  const READ_PAGE_MAX_CHARS = 8000;

  // 8×13 atlas — see C:/Users/mario/donald-sprite-skill/components/codexAtlas.ts.
  // Each row is one animation state; cols is the frame count per row. Rows 9-12
  // (pointing-right/left/up/down) were added 2026-05-31 so every pet can point
  // in four directions. ALL sprite sheets must use the 13-row layout to match.
  const ATLAS = {
    cols: 8,
    rows: 13,
    rowsDef: [
      { index: 0, id: "idle",           frames: 6, fps: 6 },
      { index: 1, id: "running-right",  frames: 8, fps: 8 },
      { index: 2, id: "running-left",   frames: 8, fps: 8 },
      { index: 3, id: "waving",         frames: 4, fps: 6 },
      { index: 4, id: "jumping",        frames: 5, fps: 7 },
      { index: 5, id: "failed",         frames: 8, fps: 7 },
      { index: 6, id: "waiting",        frames: 6, fps: 6 },
      { index: 7, id: "running",        frames: 6, fps: 8 },
      { index: 8, id: "review",         frames: 6, fps: 6 },
      { index: 9, id: "pointing-right", frames: 4, fps: 6 },
      { index: 10, id: "pointing-left", frames: 4, fps: 6 },
      { index: 11, id: "pointing-up",   frames: 4, fps: 6 },
      { index: 12, id: "pointing-down", frames: 4, fps: 6 },
    ],
  };
  function atlasRow(id) {
    return ATLAS.rowsDef.find(function (r) { return r.id === id; }) || ATLAS.rowsDef[0];
  }

  // The atlas grew from 9 to 13 rows (2026-05-31, directional pointing). Pets
  // built / embedded BEFORE that are still 8x9 sheets, so the renderer must NOT
  // assume a fixed row count — that 13-row assumption slices an older 9-row pet
  // down to ~0.7 of its body ("half body" on live customer sites). Instead we
  // detect each loaded sheet's real row count from its pixel size (cells are
  // 192x208) and render against THAT, so 9-row and 13-row pets both display
  // correctly. Defaults to ATLAS.rows until the sprite image loads.
  const CELL_W = 192, CELL_H = 208;
  let SHEET_ROWS = ATLAS.rows;
  function detectRows(nw, nh) {
    if (!nw || !nh) return ATLAS.rows;
    const cellW = nw / ATLAS.cols;
    const r = Math.round(nh / (cellW * (CELL_H / CELL_W)));
    return r >= 1 && r <= 64 ? r : ATLAS.rows;
  }

  // ── State (module scope; tools close over this, not over captured values) ─
  const STATE = {
    conversation: null,
    isCallActive: false,
    // HARD-WON RULE 2: `starting` covers the 200ms async window between the
    // drag-end "click" handler and startCall finishing — without it a double-
    // tap (or drag-end + Talk-button hover-click) opens TWO WebSocket
    // sessions. Set true at the top of startCall, cleared in every exit path.
    starting: false,
    isSpeaking: false,
    inputLevel: 0,
    error: null,
    reconnectAttempts: 0,
    pathname: location.pathname,
    micMeterTimer: null,
    speakRowTimer: null,
    currentRowId: "idle",
    // HARD-WON RULE 5: cancel the pending navigate_to setTimeout if the user
    // ends the call mid-delay — otherwise the resume sentinel still gets
    // written and the next page auto-resumes against the user's intent.
    pendingNavTimer: null,
    listeners: { start: [], end: [], error: [] },
    // Intake questionnaire accumulator (builder pets only)
    intake: { open: false, answers: {} },
    // Ambient + wander loop timers. Set when CONFIG.ambient/wander are on
    // and the loops start. Always cleared via clearTimeout on teardown so
    // a re-init doesn't double-fire. isDragging is mirrored from the drag
    // handler so the loops can short-circuit without coupling to its
    // private `drag` variable.
    ambientTimer: null,
    wanderTimer: null,
    isDragging: false,
    // Choreography (run_choreography tool). A "tour" plays beats on a timeline;
    // these hold every pending setTimeout id + the live highlight ring so
    // abortChoreo() can cancel the whole sequence the instant the visitor
    // barges in. Empty/null when no tour is playing.
    choreoTimers: [],
    choreoRing: null,
    choreoActive: false,
  };

  // Display labels for the 5 intake fields (handwritten on the on-page tablet)
  const INTAKE_FIELDS = {
    app_type:     "App type",
    target_user:  "Who's it for",
    must_haves:   "Top features",
    visual_style: "Style / vibe",
    integrations: "Integrations",
  };

  // ── Default route labels (host overridable via window.__PetConciergeRoutes) ─
  // Generic fallbacks. A host site can publish a richer map like:
  //   window.__PetConciergeRoutes = [
  //     { match: /^\/products\//, label: "Product page" },
  //     { match: /^\/cart/, label: "Shopping cart" },
  //   ];
  // BEFORE this script loads, or anytime after.
  const DEFAULT_ROUTE_LABELS = [
    { match: /^\/$/, label: "Home" },
    { match: /^\/about/, label: "About" },
    { match: /^\/pricing/, label: "Pricing" },
    { match: /^\/contact/, label: "Contact" },
    { match: /^\/cart/, label: "Cart" },
    { match: /^\/checkout/, label: "Checkout" },
    { match: /^\/products?\//, label: "Product" },
    { match: /^\/blog/, label: "Blog" },
  ];
  function labelForPath(pathname) {
    const overrides = window.__PetConciergeRoutes || [];
    const all = overrides.concat(DEFAULT_ROUTE_LABELS);
    for (let i = 0; i < all.length; i++) {
      try { if (all[i].match.test(pathname)) return all[i].label; }
      catch (_) {}
    }
    return pathname || "Home";
  }

  // ── CSS injection ─────────────────────────────────────────────────────────
  // Ported verbatim from skill package pet.css with .pet-* class names
  // re-prefixed to .pc-* (Pet Concierge) so we don't collide with any host
  // site that happens to use .pet-* for its own styling.
  function injectStyles() {
    if (document.getElementById("__pc_style")) return;
    const css = `
      .pc-overlay { position: fixed; z-index: 2147483600; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; pointer-events: none; --pc-accent: ${CONFIG.accent}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      .pc-overlay > * { pointer-events: auto; }
      .pc-sprite { position: relative; width: 96px; height: 96px; background: transparent; border: 0; box-shadow: none; display: flex; align-items: center; justify-content: center; cursor: grab; user-select: none; touch-action: none; transition: transform 160ms ease; }
      .pc-sprite:hover { transform: translateY(-2px); }
      .pc-sprite:active { cursor: grabbing; }
      .pc-sprite[data-pc-voice="true"] { cursor: pointer; }
      .pc-sprite-glyph { font-size: 52px; line-height: 1; animation: pc-float 3.4s ease-in-out infinite; filter: drop-shadow(0 1px 0 rgba(0,0,0,0.08)); display: inline-block; }
      .pc-sprite-shadow { position: absolute; bottom: -12px; left: 50%; width: 64px; height: 8px; background: rgba(0,0,0,0.35); border-radius: 50%; filter: blur(4px); transform: translateX(-50%); animation: pc-shadow 3.4s ease-in-out infinite; }
      @keyframes pc-float { 0%,100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-4px) rotate(2deg); } }
      @keyframes pc-shadow { 0%,100% { transform: translateX(-50%) scale(1); opacity: 0.35; } 50% { transform: translateX(-50%) scale(0.85); opacity: 0.20; } }
      @media (prefers-reduced-motion: reduce) { .pc-sprite-glyph, .pc-sprite-shadow { animation: none !important; } }
      .pc-sprite[data-pc-live="true"] { filter: drop-shadow(0 0 12px var(--pc-accent)); animation: pc-live-pulse 1.6s ease-in-out infinite; }
      @keyframes pc-live-pulse { 0%,100% { filter: drop-shadow(0 0 8px var(--pc-accent)); } 50% { filter: drop-shadow(0 0 18px var(--pc-accent)); } }
      .pc-image { display: inline-block; background-position: 0 0; background-repeat: no-repeat; background-size: 100% 100%; width: 100%; height: 100%; image-rendering: pixelated; image-rendering: -moz-crisp-edges; }
      .pc-image.atlas { background-repeat: no-repeat; }
      .pc-bubble { max-width: 260px; background: rgba(15,23,42,0.95); color: rgba(255,255,255,0.92); border: 1px solid var(--pc-accent); border-radius: 12px; padding: 10px 12px 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); font-size: 12.5px; line-height: 1.4; position: relative; animation: pc-bubble-in 200ms ease-out; }
      .pc-bubble::after { content: ""; position: absolute; right: 18px; bottom: -6px; width: 12px; height: 12px; background: rgba(15,23,42,0.95); border-right: 1px solid var(--pc-accent); border-bottom: 1px solid var(--pc-accent); transform: rotate(45deg); }
      .pc-bubble-name { font-weight: 600; font-size: 12px; color: var(--pc-accent); margin-bottom: 2px; }
      .pc-bubble-line { color: rgba(255,255,255,0.92); }
      .pc-bubble-hint { font-size: 10.5px; color: rgba(255,255,255,0.55); margin-top: 4px; }
      .pc-bubble-actions { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
      .pc-bubble-btn { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.65); border: 1px solid rgba(255,255,255,0.12); cursor: pointer; font-family: inherit; }
      .pc-bubble-btn:hover { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.95); border-color: rgba(255,255,255,0.22); }
      .pc-bubble-btn-primary { background: var(--pc-accent); color: #fff; border-color: var(--pc-accent); }
      .pc-bubble-btn-primary:hover { background: var(--pc-accent); filter: brightness(1.1); color: #fff; }
      @keyframes pc-bubble-in { from { opacity: 0; transform: translateY(4px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .pc-live-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #ef4444; margin-left: 6px; vertical-align: middle; box-shadow: 0 0 0 0 rgba(239,68,68,0.6); animation: pc-live-dot-pulse 1.4s ease-out infinite; }
      @keyframes pc-live-dot-pulse { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); } 70% { box-shadow: 0 0 0 8px rgba(239,68,68,0); } 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); } }
      .pc-mic-meter { margin: 8px 0 4px; height: 6px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden; border: 1px solid rgba(255,255,255,0.12); }
      .pc-mic-meter-fill { height: 100%; background: linear-gradient(90deg, var(--pc-accent), rgba(34,197,94,0.9)); border-radius: 999px; transition: width 80ms linear; box-shadow: 0 0 8px var(--pc-accent); width: 0%; }
      .pc-bubble-error { margin-top: 6px; font-size: 11px; padding: 4px 8px; border-radius: 6px; background: rgba(239,68,68,0.14); color: rgba(252,165,165,1); border: 1px solid rgba(239,68,68,0.4); line-height: 1.3; }
      .pc-tablet { display: none; width: 280px; max-height: 320px; overflow: hidden; background: #fef3c7; background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 22px, rgba(0,0,0,0.06) 22px, rgba(0,0,0,0.06) 23px); border: 1px solid rgba(0,0,0,0.14); border-left: 3px solid rgba(220, 38, 38, 0.45); border-radius: 4px; padding: 14px 16px 14px 18px; box-shadow: 0 10px 28px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.55) inset; font-family: "Caveat", "Kalam", "Comic Sans MS", cursive; color: #1e293b; transform: rotate(-1.4deg); }
      .pc-tablet[data-pc-open="true"] { display: block; animation: pc-tablet-in 320ms ease-out; }
      .pc-tablet.fading { animation: pc-tablet-out 380ms ease-in forwards; }
      .pc-tablet-title { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; font-weight: 700; font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px dashed rgba(0,0,0,0.18); }
      .pc-tablet-row { padding: 6px 0; opacity: 0; transform: translateX(-6px); animation: pc-tablet-row-in 360ms ease-out forwards; }
      .pc-tablet-label { display: inline-block; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px; min-width: 88px; }
      .pc-tablet-value { font-size: 17px; line-height: 1.25; color: #0f172a; display: block; margin-top: 1px; }
      @keyframes pc-tablet-in { from { opacity: 0; transform: translateY(6px) rotate(-3deg); } to { opacity: 1; transform: translateY(0) rotate(-1.4deg); } }
      @keyframes pc-tablet-out { to { opacity: 0; transform: translateY(6px) rotate(-3deg); } }
      @keyframes pc-tablet-row-in { to { opacity: 1; transform: translateX(0); } }
    `;
    const style = document.createElement("style");
    style.id = "__pc_style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── localStorage helpers ──────────────────────────────────────────────────
  function loadPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_POS);
      if (!raw) return { right: 24, bottom: 24 };
      const p = JSON.parse(raw);
      return {
        right:  typeof p.right === "number" ? p.right : 24,
        bottom: typeof p.bottom === "number" ? p.bottom : 24,
      };
    } catch (_) { return { right: 24, bottom: 24 }; }
  }
  function savePosition(p) {
    try { localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(p)); } catch (_) {}
  }
  function readMicPref() {
    try { return localStorage.getItem(STORAGE_KEY_MIC); } catch (_) { return null; }
  }
  function clearMicPref() {
    try { localStorage.removeItem(STORAGE_KEY_MIC); } catch (_) {}
  }

  // ── Text-size (page zoom) ─────────────────────────────────────────────────
  // The set_text_size tool lets the agent enlarge/shrink the WHOLE page for
  // visitors who can't read small text. We keep one multiplier at module scope,
  // persist it to localStorage so it survives navigation, and re-apply it on
  // boot(). Applied via document.documentElement.style.zoom (most reliable
  // cross-site); browsers without `zoom` fall back to scaling :root font-size.
  const TEXT_SCALE_MIN = 0.8, TEXT_SCALE_MAX = 2.0;
  let textScale = 1.0;
  function clampTextScale(n) {
    if (!isFinite(n)) return 1.0;
    return Math.max(TEXT_SCALE_MIN, Math.min(TEXT_SCALE_MAX, n));
  }
  function loadTextScale() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TEXT_SCALE);
      if (raw == null || raw === "") return 1.0;
      const n = parseFloat(raw);
      return isFinite(n) ? clampTextScale(n) : 1.0;
    } catch (_) { return 1.0; }
  }
  function applyTextScale(mult) {
    textScale = clampTextScale(mult);
    try {
      const root = document.documentElement;
      if (root && typeof root.style.zoom !== "undefined") {
        root.style.zoom = String(textScale);
      } else if (root) {
        // Fallback for engines without `zoom`: scale the root font-size from a
        // 100% baseline so rem-based layouts grow/shrink proportionally.
        root.style.fontSize = (textScale * 100) + "%";
      }
    } catch (_) {}
    try { localStorage.setItem(STORAGE_KEY_TEXT_SCALE, String(textScale)); } catch (_) {}
    return textScale;
  }

  // ── Spritesheet renderer (atlas frame walker) ─────────────────────────────
  // 8×9 grid; backgroundPosition picks a single cell. We animate frame
  // horizontally inside the chosen row at the row's native FPS.
  function setSpriteRow(spriteImgEl, rowId) {
    if (!spriteImgEl) return;
    // Glyph-only mode (data-sprite-src="none" or the atlas 404'd): no atlas to
    // walk — the CSS .pc-sprite-glyph float animation carries the motion.
    if (!spriteImgEl.classList.contains("pc-image")) {
      STATE.currentRowId = rowId;
      return;
    }
    let row = atlasRow(rowId);
    if (row.index >= SHEET_ROWS) row = ATLAS.rowsDef[0]; // row absent on a shorter (9-row) sheet
    if (STATE.speakRowTimer) {
      clearInterval(STATE.speakRowTimer);
      STATE.speakRowTimer = null;
    }
    STATE.currentRowId = rowId;
    const cols = ATLAS.cols;
    const rows = SHEET_ROWS;
    const yPct = rows > 1 ? (row.index / (rows - 1)) * 100 : 0;
    let frame = 0;
    const render = function () {
      const xPct = cols > 1 ? (frame / (cols - 1)) * 100 : 0;
      spriteImgEl.style.backgroundPosition = xPct + "% " + yPct + "%";
    };
    render();
    if (row.frames > 1) {
      const intervalMs = Math.max(16, Math.round(1000 / row.fps));
      STATE.speakRowTimer = setInterval(function () {
        frame = (frame + 1) % row.frames;
        render();
      }, intervalMs);
    }
  }

  // ── Expressive idle behaviors (opt-in via CONFIG.ambient / CONFIG.wander) ─
  // Donald (in Mission Control) has two behaviors the petconcierge embed never
  // ported until 2026-05-28: (1) randomly cycle non-idle atlas rows during
  // idle gaps so the pet feels alive, (2) slowly wander horizontally so it
  // isn't permanently glued to the corner. Both default OFF — hosts opt in by
  // setting data-ambient="true" / data-wander="true" on the <script> tag.
  //
  // Both honor prefers-reduced-motion (browser-level accessibility setting)
  // and self-pause during: an active call, a drag-in-progress, a speak-row
  // animation, or an open bubble. They never persist position changes —
  // savePosition() is only called by the drag handler, so the user's chosen
  // home corner is preserved across page reloads regardless of how far the
  // pet has wandered.
  function prefersReducedMotion() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_) { return false; }
  }
  function isPetBusy() {
    if (STATE.isCallActive) return true;
    if (STATE.isDragging) return true;
    if (STATE.speakRowTimer) return true;
    if (UI.bubble && UI.bubble.style.display !== "none") return true;
    return false;
  }

  // Rows excluded from ambient pool: "idle" is the resting state, the running
  // rows are reserved for wander pose. The rest are fair game.
  const AMBIENT_EXCLUDED = { idle: 1, "running-right": 1, "running-left": 1 };

  function startAmbient() {
    if (!CONFIG.ambient) return;
    if (prefersReducedMotion()) return;
    if (STATE.ambientTimer) return;
    const pool = ATLAS.rowsDef.filter(function (r) { return !AMBIENT_EXCLUDED[r.id] && r.index < SHEET_ROWS; });
    if (pool.length === 0) return;

    let lastId = null;
    function playBeat() {
      STATE.ambientTimer = null;
      if (!CONFIG.ambient) return;
      if (isPetBusy()) {
        // Reschedule a shorter check — pet might free up soon.
        STATE.ambientTimer = window.setTimeout(playBeat, 4000);
        return;
      }
      // Pick a row different from the last one if we have ≥2 choices.
      let def = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1 && def.id === lastId) {
        def = pool[(pool.indexOf(def) + 1) % pool.length];
      }
      lastId = def.id;
      setSpriteRow(UI.spriteImg, def.id);
      // Hold the animation for ~1.5 full cycles, capped 800-3500 ms.
      const playMs = Math.max(800, Math.min(3500, Math.round((def.frames / def.fps) * 1500)));
      window.setTimeout(function () {
        if (!STATE.speakRowTimer && !STATE.isCallActive) setSpriteRow(UI.spriteImg, "idle");
      }, playMs);
      // Rest 8-22 s before next beat (mirrors Mission Control's PetOverlay).
      const restMs = 8000 + Math.floor(Math.random() * 14000);
      STATE.ambientTimer = window.setTimeout(playBeat, restMs);
    }
    // Initial delay so the pet doesn't perform immediately on page load.
    STATE.ambientTimer = window.setTimeout(playBeat, 3000 + Math.floor(Math.random() * 5000));
  }

  function startWander() {
    if (!CONFIG.wander) return;
    if (prefersReducedMotion()) return;
    if (STATE.wanderTimer) return;
    const SPRITE_W = 96;
    function easeInOutQuad(t) {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
    function walkTo(targetRight) {
      return new Promise(function (resolve) {
        const overlay = UI.overlay;
        if (!overlay) return resolve();
        const startRight = parseFloat(overlay.style.right) || 24;
        const distance = Math.abs(targetRight - startRight);
        // 0.9 px / ms (matches Donald's run step), bounded 600-2400 ms.
        const durMs = Math.max(600, Math.min(2400, distance / 0.9));
        // Increasing `right` moves the element LEFT (further from right edge).
        const pose = targetRight > startRight ? "running-left" : "running-right";
        setSpriteRow(UI.spriteImg, pose);
        const startedAt = performance.now();
        function frame(now) {
          // Cancel mid-walk if the pet becomes busy — snap to idle and stop.
          if (STATE.isCallActive || STATE.isDragging || STATE.speakRowTimer) {
            if (!STATE.speakRowTimer) setSpriteRow(UI.spriteImg, "idle");
            return resolve();
          }
          const t = Math.min(1, (now - startedAt) / durMs);
          const e = easeInOutQuad(t);
          overlay.style.right = (startRight + (targetRight - startRight) * e) + "px";
          if (t >= 1) {
            if (!STATE.speakRowTimer && !STATE.isCallActive) setSpriteRow(UI.spriteImg, "idle");
            return resolve();
          }
          window.requestAnimationFrame(frame);
        }
        window.requestAnimationFrame(frame);
      });
    }
    function nextWander() {
      STATE.wanderTimer = null;
      if (!CONFIG.wander) return;
      if (isPetBusy()) {
        STATE.wanderTimer = window.setTimeout(nextWander, 10000);
        return;
      }
      // Horizontal range in CSS `right` space: [24, innerWidth - SPRITE - 24].
      // Guard against tiny viewports (mobile portrait can be < 360px).
      const minR = 24;
      const maxR = Math.max(minR + 120, window.innerWidth - SPRITE_W - 24);
      const target = minR + Math.floor(Math.random() * (maxR - minR));
      walkTo(target).then(function () {
        const restMs = 30000 + Math.floor(Math.random() * 30000); // 30-60 s
        STATE.wanderTimer = window.setTimeout(nextWander, restMs);
      });
    }
    // First wander 8-20 s after mount so it doesn't fire before the user
    // even notices the pet exists.
    STATE.wanderTimer = window.setTimeout(nextWander, 8000 + Math.floor(Math.random() * 12000));
  }

  function startExpressive() {
    startAmbient();
    startWander();
  }

  // ── DOM build ─────────────────────────────────────────────────────────────
  const UI = { overlay: null, sprite: null, spriteImg: null, bubble: null,
               bubbleName: null, bubbleLine: null, micMeterFill: null,
               errorEl: null, talkBtn: null, hintEl: null,
               tablet: null, tabletBody: null };

  function buildDom() {
    const pos = loadPosition();

    const overlay = document.createElement("div");
    overlay.className = "pc-overlay";
    overlay.setAttribute("role", "complementary");
    overlay.setAttribute("aria-label", CONFIG.name + " companion");
    overlay.style.right = pos.right + "px";
    overlay.style.bottom = pos.bottom + "px";

    const bubble = document.createElement("div");
    bubble.className = "pc-bubble";
    bubble.style.display = "none";
    bubble.setAttribute("role", "status");

    const bubbleName = document.createElement("div");
    bubbleName.className = "pc-bubble-name";
    bubbleName.textContent = CONFIG.name;
    bubble.appendChild(bubbleName);

    const bubbleLine = document.createElement("div");
    bubbleLine.className = "pc-bubble-line";
    bubbleLine.textContent = CONFIG.greeting;
    bubble.appendChild(bubbleLine);

    const meter = document.createElement("div");
    meter.className = "pc-mic-meter";
    meter.setAttribute("role", "meter");
    meter.setAttribute("title", "Mic level — moves when you talk");
    meter.style.display = "none";
    const meterFill = document.createElement("div");
    meterFill.className = "pc-mic-meter-fill";
    meter.appendChild(meterFill);
    bubble.appendChild(meter);

    const errorEl = document.createElement("div");
    errorEl.className = "pc-bubble-error";
    errorEl.style.display = "none";
    errorEl.setAttribute("role", "alert");
    bubble.appendChild(errorEl);

    const hint = document.createElement("div");
    hint.className = "pc-bubble-hint";
    hint.textContent = "Click " + CONFIG.name + " to talk";
    bubble.appendChild(hint);

    const actions = document.createElement("div");
    actions.className = "pc-bubble-actions";
    const talkBtn = document.createElement("button");
    talkBtn.type = "button";
    talkBtn.className = "pc-bubble-btn pc-bubble-btn-primary";
    talkBtn.textContent = "Talk";
    actions.appendChild(talkBtn);
    bubble.appendChild(actions);

    const sprite = document.createElement("div");
    sprite.className = "pc-sprite";
    sprite.setAttribute("aria-label", CONFIG.name);
    sprite.setAttribute("title", CONFIG.name + " — click to talk");
    sprite.setAttribute("data-pc-voice", "true");

    // Sprite element. Two modes:
    //   data-sprite-src="none" → emoji glyph only (no atlas, keeps the float anim).
    //   otherwise → load the atlas spritesheet; fall back to the glyph if it 404s.
    const spriteImg = document.createElement("span");
    spriteImg.setAttribute("aria-hidden", "true");
    if (CONFIG.spriteSrc === "none") {
      spriteImg.className = "pc-sprite-glyph";
      spriteImg.textContent = CONFIG.glyph;
    } else {
      spriteImg.className = "pc-sprite-glyph pc-image atlas";
      const url = CONFIG.assetBase.replace(/\/$/, "") +
        (CONFIG.spriteSrc.charAt(0) === "/" ? CONFIG.spriteSrc : "/" + CONFIG.spriteSrc);
      spriteImg.style.backgroundImage = "url(" + url + ")";
      spriteImg.style.backgroundSize = (ATLAS.cols * 100) + "% " + (ATLAS.rows * 100) + "%";
      // Detect the sheet's REAL row count once it loads and re-fit the atlas, so
      // older 8x9 pets aren't sliced to half a body by the 13-row default.
      const probe = new Image();
      probe.onload = function () {
        SHEET_ROWS = detectRows(probe.naturalWidth, probe.naturalHeight);
        spriteImg.style.backgroundSize = (ATLAS.cols * 100) + "% " + (SHEET_ROWS * 100) + "%";
        setSpriteRow(spriteImg, STATE.currentRowId || "idle");
      };
      probe.onerror = function () {
        spriteImg.style.backgroundImage = "";
        spriteImg.classList.remove("pc-image", "atlas");
        spriteImg.textContent = CONFIG.glyph;
      };
      probe.src = url;
    }
    sprite.appendChild(spriteImg);

    const shadow = document.createElement("span");
    shadow.className = "pc-sprite-shadow";
    shadow.setAttribute("aria-hidden", "true");
    sprite.appendChild(shadow);

    // Intake notepad (builder-pet only). Hidden until start_intake_questionnaire
    // is invoked. Sits in the overlay flex column so it stacks above the sprite.
    const tablet = document.createElement("div");
    tablet.className = "pc-tablet";
    tablet.setAttribute("role", "region");
    tablet.setAttribute("aria-label", "Project brief notepad");
    const tabletTitle = document.createElement("div");
    tabletTitle.className = "pc-tablet-title";
    tabletTitle.textContent = "Project brief";
    tablet.appendChild(tabletTitle);
    const tabletBody = document.createElement("div");
    tabletBody.className = "pc-tablet-body";
    tablet.appendChild(tabletBody);

    overlay.appendChild(bubble);
    overlay.appendChild(tablet);
    overlay.appendChild(sprite);
    document.body.appendChild(overlay);

    Object.assign(UI, {
      overlay: overlay, sprite: sprite, spriteImg: spriteImg, bubble: bubble,
      bubbleName: bubbleName, bubbleLine: bubbleLine, micMeterEl: meter,
      micMeterFill: meterFill, errorEl: errorEl, talkBtn: talkBtn, hintEl: hint,
      tablet: tablet, tabletBody: tabletBody,
    });

    setSpriteRow(spriteImg, "idle");
    attachDragHandlers(sprite, overlay);
    sprite.addEventListener("pointerenter", function () {
      if (!STATE.isCallActive) showBubble(true);
    });
    sprite.addEventListener("pointerleave", function () {
      if (!STATE.isCallActive) {
        setTimeout(function () { if (!STATE.isCallActive) showBubble(false); }, 1200);
      }
    });
    // HARD-WON RULE 2: route the click through toggleCall() — bare
    // `if (isCallActive) endCall(); else startCall();` could race the drag-
    // end click handler and spawn two WebSocket sessions.
    talkBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleCall();
    });

    // Opt-in idle behaviors. No-op when data-ambient/data-wander aren't set.
    startExpressive();
  }

  // ── Drag handler ──────────────────────────────────────────────────────────
  function attachDragHandlers(sprite, overlay) {
    let drag = null;
    sprite.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      sprite.setPointerCapture(e.pointerId);
      const rect = overlay.getBoundingClientRect();
      drag = {
        startX: e.clientX, startY: e.clientY,
        startRight: window.innerWidth - rect.right,
        startBottom: window.innerHeight - rect.bottom,
        moved: false,
      };
      // Mirror to module-scope so the wander loop pauses without coupling.
      STATE.isDragging = true;
    });
    sprite.addEventListener("pointermove", function (e) {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true;
      const right = Math.max(8, Math.min(window.innerWidth - 120, drag.startRight - dx));
      const bottom = Math.max(8, Math.min(window.innerHeight - 120, drag.startBottom - dy));
      overlay.style.right = right + "px";
      overlay.style.bottom = bottom + "px";
    });
    function endDrag(e) {
      const wasDrag = drag;
      drag = null;
      STATE.isDragging = false;
      try { sprite.releasePointerCapture(e.pointerId); } catch (_) {}
      if (wasDrag && wasDrag.moved) {
        const rect = overlay.getBoundingClientRect();
        savePosition({
          right: window.innerWidth - rect.right,
          bottom: window.innerHeight - rect.bottom,
        });
      } else if (wasDrag) {
        // Pure click on sprite = toggle call (sprite IS the call button).
        // HARD-WON RULE 2: toggleCall() guards against the double-start race
        // between this handler and the Talk-button click during the 200ms
        // async startCall window.
        toggleCall();
      }
    }
    sprite.addEventListener("pointerup", endDrag);
    sprite.addEventListener("pointercancel", endDrag);
  }

  // ── Bubble + error helpers ────────────────────────────────────────────────
  function showBubble(visible) {
    if (!UI.bubble) return;
    UI.bubble.style.display = visible ? "" : "none";
  }
  function setError(msg) {
    STATE.error = msg || null;
    if (!UI.errorEl) return;
    if (msg) {
      UI.errorEl.textContent = msg;
      UI.errorEl.style.display = "";
      showBubble(true);
      try { setSpriteRow(UI.spriteImg, "failed"); } catch (_) {}
    } else {
      UI.errorEl.style.display = "none";
    }
    emit("error", msg);
  }
  function setBubbleLine(text) {
    if (UI.bubbleLine) UI.bubbleLine.textContent = text;
  }
  function setHint(text) {
    if (UI.hintEl) UI.hintEl.textContent = text;
  }
  function setTalkBtnLabel(text) {
    if (UI.talkBtn) UI.talkBtn.textContent = text;
  }
  function setLive(active) {
    STATE.isCallActive = active;
    if (UI.sprite) {
      if (active) UI.sprite.setAttribute("data-pc-live", "true");
      else UI.sprite.removeAttribute("data-pc-live");
    }
    if (UI.bubbleName) {
      UI.bubbleName.innerHTML = "";
      UI.bubbleName.appendChild(document.createTextNode(CONFIG.name));
      if (active) {
        const dot = document.createElement("span");
        dot.className = "pc-live-dot";
        dot.setAttribute("aria-label", "live call");
        UI.bubbleName.appendChild(dot);
      }
    }
    setHint(active ? "Click " + CONFIG.name + " to end call" : "Click " + CONFIG.name + " to talk");
    setTalkBtnLabel(active ? "End call" : "Talk");
    if (UI.micMeterEl) UI.micMeterEl.style.display = active ? "" : "none";
    if (!active) setMicLevel(0);
  }
  function setMicLevel(level) {
    STATE.inputLevel = level;
    if (UI.micMeterFill) {
      UI.micMeterFill.style.width = Math.min(100, Math.max(0, level * 100)) + "%";
    }
  }

  // ── Rule 4: mic validation + resolution ───────────────────────────────────
  // Briefly opens `deviceId` via getUserMedia, samples ~250ms of audio,
  // confirms the buffer isn't all-zero and RMS clears a noise floor.
  // Stale localStorage preferences pointing at a device that enumerates but
  // produces no audio (the eMeet-C960 bug) get the WS dropped within 60ms,
  // so we MUST catch that here.
  async function validateMicProducesAudio(deviceId) {
    let stream = null;
    let audioCtx = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const start = performance.now();
      while (performance.now() - start < 250) {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        let any = false;
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] !== 0) any = true;
          sum += buf[i] * buf[i];
        }
        if (any || Math.sqrt(sum / buf.length) > 0.0001) return true;
        await new Promise(function (r) { setTimeout(r, 25); });
      }
      return false;
    } catch (_) {
      return false;
    } finally {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      if (audioCtx) audioCtx.close().catch(function () {});
    }
  }

  // Resolve which mic device the SDK should open. Priority:
  //   1. localStorage preference — HEALTH-CHECKED, cleared if silent.
  //   2. defaultFromPermGrant — whatever the OS just confirmed worked.
  //   3. Generic fallback, excluding stereo-mix / virtual.
  async function resolveMicDeviceId(defaultFromPermGrant) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(function (d) { return d.kind === "audioinput"; });

      const stored = readMicPref();
      if (stored) {
        const match = inputs.find(function (d) { return d.deviceId === stored; });
        if (match) {
          const ok = await validateMicProducesAudio(stored);
          if (ok) return match.deviceId;
          console.warn("[PC] stored mic preference produced silent audio — clearing " + STORAGE_KEY_MIC + ".");
          clearMicPref();
        }
      }
      if (defaultFromPermGrant) {
        const match = inputs.find(function (d) { return d.deviceId === defaultFromPermGrant; });
        if (match) return match.deviceId;
      }
      const fallback = inputs.find(function (d) {
        const label = (d.label || "").toLowerCase();
        return label.indexOf("stereo mix") === -1 && label.indexOf("virtual") === -1;
      });
      return fallback ? fallback.deviceId : undefined;
    } catch (_) {
      return undefined;
    }
  }

  // ── Rule 5: visual-row TreeWalker for read_page ───────────────────────────
  // HARD-WON RULE 1: Skip ONLY truly invisible/structural tags. Marketing sites
  // routinely put the hero/pricing/CTA inside <header> and <section> siblings —
  // if we skip <header>/<nav>/<footer>/<aside>, the agent answers "I don't see
  // that on this page" for content the visitor just looked at. Demo killer.
  // Visibility filters in isReadable() / extractStructuredPageText still drop
  // off-screen / display:none subtrees, so genuinely hidden regions are safe.
  const READ_PAGE_SKIP_TAGS = (function () {
    const s = ["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","IFRAME"];
    const set = {};
    s.forEach(function (t) { set[t] = true; });
    return set;
  })();
  function isVisibleForClick(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") < 0.05) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return true;
  }
  function isReadable(el) {
    if (!el || !(el instanceof HTMLElement)) return true;
    if (el.hidden) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    if (el.dataset && el.dataset.pcSkip === "true") return false;
    if (READ_PAGE_SKIP_TAGS[el.tagName]) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") < 0.05) return false;
    return true;
  }
  function extractStructuredPageText(root) {
    const lines = [];
    let line = "";
    let prefix = "";
    let currentTop = Number.NEGATIVE_INFINITY;
    function flush() {
      const merged = (prefix + line).trim().replace(/\s+/g, " ");
      if (merged) lines.push(merged);
      line = ""; prefix = "";
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const stopAt = root.parentElement;
    let node = walker.nextNode();
    while (node) {
      const raw = node.textContent;
      if (raw && raw.trim()) {
        let headingLevel = 0;
        let visible = true;
        let anc = node.parentElement;
        while (anc && anc !== stopAt) {
          if (!isReadable(anc)) { visible = false; break; }
          if (!headingLevel) {
            const m = /^H([1-6])$/.exec(anc.tagName);
            if (m) headingLevel = parseInt(m[1], 10);
          }
          anc = anc.parentElement;
        }
        if (visible) {
          const parent = node.parentElement;
          const rect = parent ? parent.getBoundingClientRect() : null;
          const laidOut = !rect || rect.width !== 0 || rect.height !== 0;
          if (laidOut) {
            const top = rect ? Math.round(rect.top) : currentTop;
            if (Math.abs(top - currentTop) > 4) {
              flush();
              currentTop = top;
              prefix = headingLevel ? new Array(headingLevel + 1).join("#") + " " : "";
            }
            if (line && line[line.length - 1] !== " ") line += " ";
            line += raw.trim();
          }
        }
      }
      node = walker.nextNode();
    }
    flush();
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // ── Page discovery (sitemap.xml + nav scrape → {{available_pages}}) ──────
  // Sitemap is preferred (carries human descriptions via <petbuddy:desc>).
  // Nav anchors fill gaps when no sitemap is present. Cached at module scope.
  let DISCOVERED_PAGES = null;
  let DISCOVERED_PAGES_PROMISE = null;
  function titleCaseFromPath(path) {
    if (!path || path === "/") return "Home";
    const parts = path.replace(/^\/+|\/+$/g, "").split(/[-_/]/).filter(Boolean);
    if (!parts.length) return "Home";
    return parts.map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }
  async function discoverPages() {
    const pages = new Map(); // path -> { label, description }
    try {
      const res = await fetch("/sitemap.xml", { cache: "no-cache" });
      const sm = res.ok ? await res.text() : "";
      if (sm) {
        const blocks = sm.match(/<url>[\s\S]*?<\/url>/g) || [];
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          const locMatch = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/);
          const descMatch = block.match(/<(?:[a-z]+:)?desc>\s*([^<]+?)\s*<\/(?:[a-z]+:)?desc>/);
          if (!locMatch) continue;
          try {
            const u = new URL(locMatch[1]);
            if (u.host === location.host) {
              pages.set(u.pathname, {
                label: titleCaseFromPath(u.pathname),
                description: descMatch ? descMatch[1].trim() : "",
              });
            }
          } catch (_) {}
        }
      }
    } catch (_) { /* no sitemap is fine — fall through to nav scrape */ }
    try {
      const anchors = document.querySelectorAll("nav a, header a, footer a");
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        try {
          const u = new URL(a.href);
          if (u.host !== location.host || !u.pathname) continue;
          if (!pages.has(u.pathname)) {
            const text = (a.textContent || "").trim();
            pages.set(u.pathname, {
              label: text || titleCaseFromPath(u.pathname),
              description: "",
            });
          }
        } catch (_) {}
      }
    } catch (_) {}
    const out = [];
    pages.forEach(function (meta, path) {
      out.push({ path: path, label: meta.label, description: meta.description });
    });
    return out;
  }
  function startDiscovery() {
    if (DISCOVERED_PAGES_PROMISE) return DISCOVERED_PAGES_PROMISE;
    DISCOVERED_PAGES_PROMISE = discoverPages()
      .then(function (list) {
        DISCOVERED_PAGES = list;
        console.log("[PC] discovered " + list.length + " pages (sitemap + nav)");
        return list;
      })
      .catch(function (e) {
        console.warn("[PC] page discovery failed", e);
        DISCOVERED_PAGES = [];
        return [];
      });
    return DISCOVERED_PAGES_PROMISE;
  }
  function formatDiscoveredPages(list) {
    if (!list || !list.length) {
      return "(No sitemap or nav links discovered on this site. Only the current page is known.)";
    }
    return list.map(function (p) {
      return "- " + p.path + " — " + p.label + (p.description ? ": " + p.description : "");
    }).join("\n");
  }

  // ── Highlight ring CSS (one-time inject, used by highlight_element tool) ─
  function ensureHighlightStyles() {
    if (document.getElementById("__pc_highlight_style")) return;
    const style = document.createElement("style");
    style.id = "__pc_highlight_style";
    style.textContent =
      ".pc-highlight-ring { position: absolute; pointer-events: none; " +
        "border-radius: 10px; " +
        "box-shadow: 0 0 0 3px #6366f1, 0 0 24px rgba(99,102,241,.6); " +
        "animation: pc-highlight-pulse 1.4s ease-in-out infinite; " +
        "z-index: 2147483647; transition: top .15s ease, left .15s ease, width .15s ease, height .15s ease; } " +
      "@keyframes pc-highlight-pulse { " +
        "0%,100% { transform: scale(1); opacity: 1; } " +
        "50% { transform: scale(1.04); opacity: .72; } }";
    document.head.appendChild(style);
  }

  // Draw a pulsing indigo ring locked onto `el` for `durationMs`. A reposition
  // interval keeps it pinned even if the page/element shifts (scroll, layout).
  // Shared by highlight_element AND find_on_page so the ring drawing lives in
  // exactly one place. Fully guarded — a failure returns null and never throws.
  function showHighlightRing(el, durationMs) {
    if (!el) return null;
    var duration = Math.max(500, Math.min(15000, isFinite(durationMs) && durationMs > 0 ? durationMs : 3000));
    try {
      ensureHighlightStyles();
      var ring = document.createElement("div");
      ring.className = "pc-highlight-ring";
      document.body.appendChild(ring);
      var reposition = function () {
        var r = el.getBoundingClientRect();
        ring.style.top    = (r.top    + window.scrollY - 4) + "px";
        ring.style.left   = (r.left   + window.scrollX - 4) + "px";
        ring.style.width  = (r.width  + 8) + "px";
        ring.style.height = (r.height + 8) + "px";
      };
      reposition();
      var interval = setInterval(reposition, 50);
      setTimeout(function () {
        clearInterval(interval);
        if (ring.parentNode) ring.parentNode.removeChild(ring);
      }, duration);
      return ring;
    } catch (_) {
      return null;
    }
  }

  // ── Choreography abort (barge-in) ─────────────────────────────────────────
  // Cancel any in-flight run_choreography "tour": clear every pending beat
  // timer and remove the live highlight ring immediately. Called when the
  // visitor barges in (starts speaking → onModeChange "listening") or the
  // session disconnects, so the visuals stop the instant the user takes over.
  // Idempotent + fully guarded — safe to call at any time, even with no tour
  // running. Never throws.
  function abortChoreo() {
    if (!STATE.choreoActive && (!STATE.choreoTimers || STATE.choreoTimers.length === 0) && !STATE.choreoRing) {
      return;
    }
    try {
      const timers = STATE.choreoTimers || [];
      for (let i = 0; i < timers.length; i++) {
        try { clearTimeout(timers[i]); } catch (_) {}
      }
    } catch (_) {}
    STATE.choreoTimers = [];
    // Tear down the highlight ring (showHighlightRing returns the ring node).
    try {
      const ring = STATE.choreoRing;
      if (ring && ring.parentNode) ring.parentNode.removeChild(ring);
    } catch (_) {}
    STATE.choreoRing = null;
    STATE.choreoActive = false;
    console.log("[PC] choreography aborted (barge-in / disconnect)");
  }

  // Visual enhancement: turn the sprite to face `el` and play the matching
  // directional pointing pose, then settle back. Only meaningful when the pet
  // is in spritesheet mode AND the sheet carries the 13-row layout (rows 9-12
  // are pointing-right/left/up/down). Older 8x9 pets and glyph-only mode skip
  // gracefully. Wrapped so a failure can never affect the ring or the call.
  function pointToward(el, durationMs) {
    try {
      if (!el || !UI.spriteImg || !UI.overlay) return;
      if (CONFIG.spriteSrc === "none") return;            // glyph mode — no rows
      if (!UI.spriteImg.classList.contains("pc-image")) return; // atlas didn't load
      if (SHEET_ROWS < 13) return;                        // 8x9 pet — no pointing rows
      var er = el.getBoundingClientRect();
      var sr = UI.overlay.getBoundingClientRect();
      var ecx = er.left + er.width / 2;
      var ecy = er.top + er.height / 2;
      var scx = sr.left + sr.width / 2;
      var scy = sr.top + sr.height / 2;
      var dx = ecx - scx;
      var dy = ecy - scy;
      var dir;
      if (Math.abs(dx) >= Math.abs(dy)) dir = dx >= 0 ? "pointing-right" : "pointing-left";
      else dir = dy >= 0 ? "pointing-down" : "pointing-up";
      // Capture the row we were on so we can settle back to it afterward.
      var prevRow = STATE.currentRowId;
      setSpriteRow(UI.spriteImg, dir);
      // Hold the point for the highlight's lifetime, capped at ~2.6s, then
      // settle back — but only if nothing else (a live-call speak row, a drag,
      // another gesture) took over the sprite in the meantime, so we never
      // fight the existing animation system.
      var holdMs = Math.max(500, Math.min(isFinite(durationMs) && durationMs > 0 ? durationMs : 2600, 2600));
      window.setTimeout(function () {
        try {
          if (STATE.isCallActive) return;            // call animations own the sprite
          if (STATE.currentRowId !== dir) return;    // something else already moved on
          setSpriteRow(UI.spriteImg, prevRow || "idle");
        } catch (_) {}
      }, holdMs);
    } catch (_) { /* never let a pointing failure touch the ring or the call */ }
  }

  // ── Live page outline ─────────────────────────────────────────────────────
  // A compact, always-current map of the CURRENT page: its section headings,
  // the fields Jack can fill, and the buttons/options he can click. This is the
  // piece that keeps Jack aware of NEW sections automatically — add a heading or
  // a form field and it shows up here with no agent-prompt edit. It deliberately
  // includes controls inside hidden multi-step-wizard panels (e.g. the onboard
  // email field and voice picker on later steps) so Jack knows the whole flow up
  // front. Labels are resolved the SAME way click_element / type_text resolve
  // targets, so everything listed is a valid thing to act on. Capped to stay
  // small inside the contextual update; fully guarded so it can never break a call.
  function fieldLabelFor(f) {
    try {
      var al = f.getAttribute && f.getAttribute("aria-label");
      if (al && al.trim()) return al.replace(/\s+/g, " ").trim();
      if (f.id) {
        var lbl = document.querySelector("label[for=\"" + CSS.escape(f.id) + "\"]");
        if (lbl && lbl.textContent.trim()) return lbl.textContent.replace(/\s+/g, " ").trim();
      }
      if (typeof f.closest === "function") {
        var wrap = f.closest("label");
        if (wrap && wrap.textContent.trim()) return wrap.textContent.replace(/\s+/g, " ").trim();
      }
      if (f.placeholder && f.placeholder.trim()) return f.placeholder.trim();
      if (f.name) return String(f.name).trim();
    } catch (_) {}
    return "";
  }
  function buildPageOutline() {
    try {
      var root = document.querySelector("main") ||
                 document.querySelector("[role='main']") ||
                 document.body;
      if (!root) return "";
      var parts = [];

      // Section headings (the page's visible structure).
      var heads = root.querySelectorAll("h1, h2, h3");
      var hList = [];
      for (var i = 0; i < heads.length && hList.length < 14; i++) {
        var ht = (heads[i].textContent || "").replace(/\s+/g, " ").trim();
        if (ht && ht.length <= 70 && hList.indexOf(ht) === -1) hList.push(ht);
      }
      if (hList.length) parts.push("Sections: " + hList.join(" · "));

      // Fillable fields — INCLUDING ones on hidden later steps — labelled the
      // way type_text resolves them, so Jack can fill them by name.
      var fields = root.querySelectorAll(
        "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='checkbox']):not([type='radio']), textarea, select"
      );
      var fList = [];
      for (var j = 0; j < fields.length && fList.length < 12; j++) {
        var lab = fieldLabelFor(fields[j]);
        if (!lab || lab.length > 50) continue;
        var req = (fields[j].required || fields[j].getAttribute("aria-required") === "true") ? " (required)" : "";
        var entry = "\"" + lab + "\"" + req;
        if (fList.indexOf(entry) === -1) fList.push(entry);
      }
      if (fList.length) parts.push("Fields you can fill: " + fList.join(", "));

      // Buttons and clickable options (incl. voice/pet cards).
      var btns = root.querySelectorAll(
        "button, [role='button'], a.btn, .voice-card, .pet-card, [data-voice], [data-pet]"
      );
      var bList = [];
      for (var k = 0; k < btns.length && bList.length < 18; k++) {
        var b = btns[k];
        var bt = (b.getAttribute("aria-label") || b.getAttribute("data-voice") ||
                  b.getAttribute("data-pet") || b.textContent || "").replace(/\s+/g, " ").trim();
        if (!bt || bt.length > 40) continue;
        var qb = "\"" + bt + "\"";
        if (bList.indexOf(qb) === -1) bList.push(qb);
      }
      if (bList.length) parts.push("Buttons/options you can click: " + bList.join(", "));

      return parts.join("\n");
    } catch (_) {
      return "";
    }
  }

  // ── Navigable destinations ────────────────────────────────────────────────
  // The exact set of places Jack can take a visitor: the host's
  // window.__PetConciergeNav phrase map (one canonical phrase per destination)
  // plus any sitemap/nav-discovered pages. Surfaced to the agent so it only ever
  // requests destinations that actually resolve (the old failure was the agent
  // guessing phrases like "pricing"/"install" with no map present).
  function formatNavigableDestinations() {
    try {
      const nav = window.__PetConciergeNav || {};
      const pages = [], sections = [], seen = {};
      Object.keys(nav).forEach(function (k) {
        const v = String(nav[k] || "");
        if (!v || seen[v]) return; // dedupe by destination → canonical phrase only
        seen[v] = 1;
        (v.indexOf("#") !== -1 ? sections : pages).push(k);
      });
      const discovered = (DISCOVERED_PAGES || []).map(function (p) { return p.path; });
      let out = "";
      if (pages.length) out += "Pages you can take them to (say any): " + pages.slice(0, 24).join(", ") + ".";
      if (sections.length) out += (out ? "\n" : "") + "Home-page sections you can jump to: " + sections.slice(0, 16).join(", ") + ".";
      if (!out && discovered.length) out = "Pages: " + discovered.join(", ") + ".";
      return out;
    } catch (_) { return ""; }
  }

  // ── Onboarding memory (survives full-document navigation) ─────────────────
  // Classify an input/textarea as one of the onboarding slots we want the agent
  // to remember across page loads. Matches by type + id/name/placeholder/
  // aria-label + associated <label> text, so it works on the marketing wizard
  // (#site-url / #contact-email / #business-name / #greeting-edit) AND on a
  // customer's own contact form without per-site config.
  function onboardingSlotForElement(el) {
    if (!el) return null;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;
    const type = (el.type || "").toLowerCase();
    if (type === "password" || type === "hidden" || type === "checkbox" || type === "radio" || type === "file") return null;
    let lbl = "";
    if (el.id) {
      try {
        const l = document.querySelector("label[for=\"" + CSS.escape(el.id) + "\"]");
        if (l) lbl = (l.textContent || "").toLowerCase();
      } catch (_) {}
    }
    const hay = [el.id, el.name, el.placeholder, el.getAttribute("aria-label"), lbl]
      .map(function (x) { return (x || "").toLowerCase(); }).join(" ");
    if (type === "email" || /\be-?mail\b/.test(hay)) return "email";
    if (/\b(site|website|url|domain)\b/.test(hay) || /site-?url|website-?url/.test(hay)) return "website";
    if (/\b(business|company|organi[sz]ation|brand)\b/.test(hay) || /(shop|store|business) name/.test(hay)) return "business";
    if (/greeting|first message|welcome message/.test(hay)) return "greeting";
    return null;
  }

  // Read the per-agent memory bag, guarding on token (don't replay one agent's
  // facts into another) and TTL (don't leak last week's signup into a new one).
  function readMemoryRaw() {
    const empty = { token: CONFIG.token, when: 0, slots: {} };
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_MEMORY);
      if (!raw) return empty;
      const m = JSON.parse(raw);
      if (!m || typeof m !== "object" || !m.slots || typeof m.slots !== "object") return empty;
      if (m.token && CONFIG.token && m.token !== CONFIG.token) return empty;
      if (m.when && (Date.now() - m.when) > MEMORY_TTL_MS) return empty;
      return { token: m.token || CONFIG.token, when: m.when || 0, slots: m.slots };
    } catch (_) { return empty; }
  }

  // Merge one collected detail. Empty value clears the slot. Idempotent — a
  // no-op write (same value) is skipped so we don't churn sessionStorage on
  // every keystroke.
  function saveSlot(key, value) {
    if (!key) return;
    value = String(value == null ? "" : value).trim();
    if (value.length > 240) value = value.slice(0, 240);
    try {
      const mem = readMemoryRaw();
      if (!value) {
        if (!(key in mem.slots)) return;
        delete mem.slots[key];
      } else {
        if (mem.slots[key] === value) return;
        mem.slots[key] = value;
      }
      mem.token = CONFIG.token;
      mem.when = Date.now();
      sessionStorage.setItem(STORAGE_KEY_MEMORY, JSON.stringify(mem));
      console.log("[PC] memory ← " + key + "=" + (key === "email" ? "<email>" : value));
    } catch (_) {}
  }

  // Render the collected details as a contextualUpdate block, or "" if none.
  // Appended to every (re)connect so the agent treats them as known facts and
  // stops re-asking after a navigation.
  function memoryContextString() {
    const s = readMemoryRaw().slots || {};
    const parts = [];
    if (s.website)   parts.push("their website / URL is \"" + s.website + "\"");
    if (s.business)  parts.push("their business name is \"" + s.business + "\"");
    if (s.email)     parts.push("their contact email is \"" + s.email + "\"");
    if (s.character) parts.push("they chose the \"" + s.character + "\" character");
    if (s.greeting)  parts.push("their greeting is \"" + s.greeting + "\"");
    if (!parts.length) return "";
    return "\n[ALREADY COLLECTED FROM THIS VISITOR earlier in this same session — these are KNOWN FACTS, " +
           "remembered across page changes. Do NOT ask for any of them again. Reuse them directly " +
           "(e.g. type the website/email/business straight into the onboarding form, skip questions you " +
           "already have answers to). If you genuinely must confirm, confirm in one short line — never re-collect.]\n- " +
           parts.join("\n- ");
  }

  // ── Page context (dynamicVariables + contextualUpdate) — Rule 11 ──────────
  function buildPageContext() {
    const pathname = location.pathname || "/";
    const label = labelForPath(pathname);
    const title = document.title || label;
    const availablePages = formatDiscoveredPages(DISCOVERED_PAGES);
    const outline = buildPageOutline();
    const navDest = formatNavigableDestinations();
    const contextualUpdate =
      "[LIVE PAGE CONTEXT] The user is currently viewing \"" + label + "\" " +
      "(route " + pathname + ", title \"" + title + "\") on " + location.hostname + ". " +
      "When the user says \"this page\" or \"what I'm looking at\", they mean " + label + "." +
      (navDest
        ? "\n[WHERE I CAN GO — pass one of these to navigate_to. For a section on THIS page, use scroll_to with the heading instead. Never invent a path.]\n" + navDest
        : "") +
      (outline
        ? "\n[PAGE OUTLINE — what is on this page right now. Use these EXACT labels with your click_element / type_text / scroll_to / highlight_element tools. Some items may live on a later step of a multi-step form; fill every (required) field and make every required selection before clicking a Next/advance button.]\n" + outline
        : "") +
      memoryContextString();
    return {
      summary: "Page=" + label + " (" + pathname + ")" + (outline ? " +outline" : "") + (navDest ? " +nav" : ""),
      dynamicVariables: {
        current_page:           label,
        current_route:          pathname,
        current_host:           location.hostname,
        current_title:          title,
        available_pages:        availablePages,
        current_page_outline:   outline,
        navigable_destinations: navDest,
      },
      contextualUpdate: contextualUpdate,
    };
  }

  // ── Client tools (Rule 7: tools close over STATE refs, not captured values) ─
  const TOOLS = {
    // Rule 6: 1800ms delay so spoken confirmation finishes before navigation.
    // Resolution order:
    //   1) destination already a path ("/foo")
    //   2) window.__PetConciergeNav voice-phrase map
    //   3) DISCOVERED_PAGES — exact path / path-tail / label / fuzzy on label+description
    //   4) DEFAULT_ROUTE_LABELS — last-resort generic fallback
    //   5) FAILURE: send a contextualUpdate so the agent learns mid-utterance
    //      (expects_response is false on this tool — return string is otherwise discarded)
    navigate_to: function (params) {
      console.log("[PC] navigate_to ←", JSON.stringify(params || null));
      const rawIn = String(params && params.destination || "").trim();
      const raw = rawIn.toLowerCase();
      if (!raw) {
        const hint = (DISCOVERED_PAGES || []).map(function (p) { return p.path; }).slice(0, 6).join(", ") || "home, about, pricing";
        return "I need a destination. Try one of: " + hint + ".";
      }

      const customNav = window.__PetConciergeNav || {};
      let path = null;

      // (1) explicit path
      if (raw[0] === "/") path = rawIn;

      // (2) host-published voice-phrase map (exact)
      if (!path && customNav[raw]) path = customNav[raw];

      // (2b) fuzzy match against the nav map keys — so "the pricing page",
      // "show me pricing", "go to pricing info" all resolve to the "pricing"
      // entry. Longest matching key wins (most specific).
      if (!path) {
        const navKeys = Object.keys(customNav);
        let best = "";
        for (let i = 0; i < navKeys.length; i++) {
          const k = navKeys[i];
          // require length >= 4 so short keys ("pet", "top") don't false-match
          // inside unrelated words ("carpet", "stop"); exact match (step 2) still
          // catches the short keys.
          if (k && k.length >= 4 && raw.indexOf(k) !== -1 && k.length > best.length) best = k;
        }
        if (best) path = customNav[best];
      }

      // (3) DISCOVERED_PAGES — try exact path, path-tail, label exact, fuzzy
      if (!path && DISCOVERED_PAGES && DISCOVERED_PAGES.length) {
        const slug = "/" + raw.replace(/\s+/g, "-").replace(/^\/+/, "");
        for (let i = 0; i < DISCOVERED_PAGES.length; i++) {
          const p = DISCOVERED_PAGES[i];
          const pPath = (p.path || "").toLowerCase();
          if (pPath === slug) { path = p.path; break; }
          if (pPath.replace(/^\/+/, "") === raw) { path = p.path; break; }
          if ((p.label || "").toLowerCase() === raw) { path = p.path; break; }
        }
        if (!path) {
          for (let i = 0; i < DISCOVERED_PAGES.length; i++) {
            const p = DISCOVERED_PAGES[i];
            const hay = ((p.label || "") + " " + (p.description || "")).toLowerCase();
            if (hay && hay.indexOf(raw) !== -1) { path = p.path; break; }
          }
        }
      }

      // (4) DEFAULT_ROUTE_LABELS — generic last-resort
      if (!path) {
        for (let i = 0; i < DEFAULT_ROUTE_LABELS.length; i++) {
          if (DEFAULT_ROUTE_LABELS[i].label.toLowerCase() === raw) {
            path = "/" + raw.replace(/\s+/g, "-");
            if (customNav[path]) path = customNav[path];
            break;
          }
        }
      }

      // (5) failed — narrate failure to the agent + give the visitor options.
      if (!path) {
        const dests = formatNavigableDestinations();
        const available = (DISCOVERED_PAGES || []).map(function (p) { return p.path; }).slice(0, 8).join(", ");
        const failMsg = "[NAVIGATION FAILED] \"" + rawIn + "\" did not match any destination. " +
          (dests ? "Valid destinations:\n" + dests + "\n" : ("Available pages: " + (available || "(none)") + ". ")) +
          "If the visitor wants something on the CURRENT page, use scroll_to with the heading instead of navigate_to. " +
          "Offer the closest match and ask them to confirm — do NOT say the site is broken.";
        console.warn("[PC] navigate_to FAILED:", rawIn);
        try {
          if (STATE.conversation && typeof STATE.conversation.sendContextualUpdate === "function") {
            STATE.conversation.sendContextualUpdate(failMsg);
          }
        } catch (e) {
          console.debug("[PC] sendContextualUpdate (navigate fail) error", e);
        }
        return "I'm not sure where \"" + rawIn + "\" is. " +
               (available ? "I can take you to: " + available + ". " : "") +
               "Or if it's a section on the page you're on, tell me the heading and I'll scroll right to it.";
      }

      // Split any "#anchor" off the resolved path.
      let navAnchor = null;
      let navBase = path;
      const hashIdx = path.indexOf("#");
      if (hashIdx !== -1) {
        navAnchor = path.slice(hashIdx + 1) || null;
        navBase = path.slice(0, hashIdx) || location.pathname;
      }

      // Same-page section: the destination is (a section on) the page we're
      // already on → just smooth-scroll to it. No reload, no resume sentinel,
      // no 1.8s delay. This is how Jack glides between sections (e.g. on a tour).
      if (navAnchor && navBase === location.pathname) {
        let sec = null;
        try { sec = document.getElementById(navAnchor); } catch (_) {}
        if (sec) {
          try { sec.scrollIntoView({ behavior: "smooth", block: "start" }); }
          catch (_) { try { location.hash = navAnchor; } catch (__) {} }
          console.log("[PC] navigate_to → in-page section #" + navAnchor);
          return "Scrolled to the " + navAnchor.replace(/[-_]/g, " ") + " section, right here on this page.";
        }
        // Anchor not on this page after all → fall through to a normal load so
        // the browser can resolve the #anchor on the destination page.
      }

      console.log("[PC] navigate_to →", path, "(from \"" + rawIn + "\")");
      // Visual cue: Jack "runs" toward the destination while the spoken
      // confirmation plays, then the page navigates.
      try { setSpriteRow(UI.spriteImg, "running"); } catch (_) {}
      // HARD-WON RULE 5: store the timer id so endCall() can cancel it if the
      // user hangs up between Jack's spoken confirmation and the actual
      // navigation — otherwise the resume sentinel gets written anyway and
      // the next page auto-reconnects against the user's intent.
      if (STATE.pendingNavTimer) { clearTimeout(STATE.pendingNavTimer); STATE.pendingNavTimer = null; }
      STATE.pendingNavTimer = setTimeout(function () {
        STATE.pendingNavTimer = null;
        // Persist a resume sentinel so the new page's embed.js auto-reconnects
        // and the call survives the JS-context wipe of a static-site reload.
        // (Skipped if the visitor ended the call between Jack's confirmation
        // line and the actual navigation — STATE.isCallActive is the gate.)
        // No-op when a host SPA navigator is wired, because the JS context
        // doesn't die on SPA pushState — onRouteChange handles that path.
        if (STATE.isCallActive && !window.__PetConciergeNavigate) {
          try {
            sessionStorage.setItem(STORAGE_KEY_RESUME, JSON.stringify({
              token: CONFIG.token,
              from:  location.pathname,
              to:    path,
              when:  Date.now(),
            }));
            console.log("[PC] resume sentinel written for " + path);
          } catch (e) {
            console.debug("[PC] resume sentinel write failed", e);
          }
        }
        try {
          if (window.__PetConciergeNavigate) {
            // Host can register a SPA-aware navigator (e.g. Next.js router.push).
            window.__PetConciergeNavigate(path);
          } else {
            location.href = path;
          }
        } catch (e) {
          location.href = path;
        }
      }, NAVIGATE_DELAY_MS);
      return "Opening " + path + " for you now.";
    },

    get_current_page: function () {
      return "You're on " + (location.pathname || "/") + " — \"" + (document.title || "this page") + "\".";
    },

    // Find a visible, interactable element by text, aria-label, placeholder,
    // associated <label for=""> text, or CSS selector. Returns the first match
    // or null. Used by click_element / type_text / scroll_to / highlight_element.
    findElement: function (target) {
      if (!target) return null;
      const t = String(target).trim();
      const lower = t.toLowerCase();

      // 0) data-pc landmark (choreography spec §3). A target named "pc:<name>"
      // resolves EXACTLY against [data-pc="<name>"] — the stable bot-vocabulary
      // alias the marketing site applies, decoupled from id/class. If the
      // landmark is present we return it immediately (it's the authoritative
      // target); if it's absent we fall through to the existing fuzzy chain
      // UNCHANGED so a "pc:" prefix never breaks ordinary resolution.
      if (t.slice(0, 3) === "pc:") {
        const pcName = t.slice(3).trim();
        if (pcName) {
          try {
            const pcEl = document.querySelector('[data-pc="' + pcName.replace(/"/g, '\\"') + '"]');
            if (pcEl) return pcEl;
          } catch (_) {}
        }
        // not found → continue into the fuzzy chain below with the raw string
      }

      // 1) CSS selector — ONLY trigger on explicit selector prefixes (#id,
      // .class, [attr]) or a child-combinator (" > "). The old regex also
      // matched "any two-word phrase starting with a letter" which fed every
      // voice command like "buy now" or "tell me" to querySelector, where it
      // threw and was swallowed by the try/catch. Every voice phrase paid
      // for a thrown exception.
      // HARD-WON RULE 9: text-content match is the ONLY path we want for
      // voice. Keep #id, .class, [attr], and " > " selectors for code that
      // explicitly passes a selector.
      if (/^[.#\[]/.test(t) || t.indexOf(" > ") !== -1) {
        try {
          const el = document.querySelector(t);
          if (el && isVisibleForClick(el)) return el;
        } catch (_) {}
      }
      // 2) Exact aria-label
      const byAria = document.querySelector("[aria-label=\"" + CSS.escape(t) + "\"]");
      if (byAria && isVisibleForClick(byAria)) return byAria;
      // 3) Placeholder match (inputs/textareas)
      const byPlaceholder = document.querySelector("[placeholder=\"" + CSS.escape(t) + "\"], [placeholder*=\"" + CSS.escape(t) + "\"]");
      if (byPlaceholder && isVisibleForClick(byPlaceholder)) return byPlaceholder;
      // 4) Associated <label for="id"> text — find a label whose text matches,
      //    then resolve its target input. Critical for wizard forms whose
      //    inputs have no aria-label / matching placeholder.
      const labels = document.querySelectorAll("label[for]");
      for (let i = 0; i < labels.length; i++) {
        const lbl = labels[i];
        const lblText = (lbl.textContent || "").trim().toLowerCase();
        if (!lblText) continue;
        if (lblText === lower || lblText.indexOf(lower) !== -1) {
          const targetEl = document.getElementById(lbl.getAttribute("for"));
          if (targetEl && isVisibleForClick(targetEl)) return targetEl;
        }
      }
      // 4b) Wrapping <label> (input nested inside)
      const wrappingLabels = document.querySelectorAll("label:not([for])");
      for (let i = 0; i < wrappingLabels.length; i++) {
        const lbl = wrappingLabels[i];
        const lblText = (lbl.textContent || "").trim().toLowerCase();
        if (!lblText) continue;
        if (lblText.indexOf(lower) !== -1) {
          const inner = lbl.querySelector("input, textarea, select, [contenteditable='true']");
          if (inner && isVisibleForClick(inner)) return inner;
        }
      }
      // 5) Text content match (buttons, links, spans)
      const candidates = document.querySelectorAll("button, a, [role='button'], [role='tab'], [role='menuitem'], .btn, [type='submit'], [type='button']");
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        if (!isVisibleForClick(el)) continue;
        const text = (el.textContent || "").trim().toLowerCase();
        if (text === lower || text.indexOf(lower) !== -1) return el;
      }
      // 6) Fuzzy text match on any clickable-looking element
      const all = document.querySelectorAll("button, a, [onclick], [tabindex], input[type='submit'], input[type='button']");
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (!isVisibleForClick(el)) continue;
        const text = (el.textContent || "").trim().toLowerCase();
        if (text.indexOf(lower) !== -1) return el;
      }
      // 7) Clickable NON-SEMANTIC containers — cards/options/tiles built as bare
      //    <div>s with a click listener and no role/aria/href of their own
      //    (e.g. the onboard voice picker `.voice-card[data-voice]` and the
      //    `.pet-card[data-pet]` tiles). findElement would otherwise miss them,
      //    so "select the Rachel voice" had nothing to click. Match on inner
      //    text or a data-* value; this only runs after every semantic match
      //    above has failed, so it can't shadow a more precise target.
      try {
        const cards = document.querySelectorAll(
          ".voice-card, .pet-card, [data-voice], [data-pet], [role='option'], [role='radio']"
        );
        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          if (!isVisibleForClick(card)) continue;
          const ctext = (card.textContent || "").trim().toLowerCase();
          const dvoice = (card.getAttribute("data-voice") || "").toLowerCase();
          const dpet = (card.getAttribute("data-pet") || "").toLowerCase();
          if ((ctext && ctext.indexOf(lower) !== -1) ||
              (dvoice && dvoice.indexOf(lower) !== -1) ||
              (dpet && dpet.indexOf(lower) !== -1)) {
            return card;
          }
        }
      } catch (_) {}
      // 8) Sections / headings — so "scroll to the X section" resolves. Match a
      //    container by id (e.g. id="capabilities" → "capabilities"), or a
      //    heading (h1-h4) whose text matches. Last resort, after every clickable
      //    match, so it never shadows a real control. Lets scroll_to /
      //    highlight_element reach in-page sections by name.
      try {
        const slug = lower.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const byId = (slug && document.getElementById(slug)) ||
                     document.getElementById(lower.replace(/\s+/g, ""));
        if (byId && isVisibleForClick(byId)) return byId;
        const heads = document.querySelectorAll("h1, h2, h3, h4");
        for (let i = 0; i < heads.length; i++) {
          const h = heads[i];
          if (!isVisibleForClick(h)) continue;
          const ht = (h.textContent || "").trim().toLowerCase();
          if (ht && (ht === lower || ht.indexOf(lower) !== -1)) return h;
        }
      } catch (_) {}
      return null;
    },

    click_element: function (params) {
      const target = String(params && params.target || "").trim();
      console.log("[PC] click_element ←", target || "(empty)");
      if (!target) return "I need to know what to click. Tell me the button text or label.";
      const el = TOOLS.findElement(target);
      if (!el) {
        console.warn("[PC] click_element FAILED:", target);
        return "I couldn't find a clickable element matching \"" + target + "\" on this page.";
      }
      // Don't pretend a disabled control was clicked — a disabled "Next" on a
      // wizard means a required field upstream is still empty. Tell the agent
      // the truth so it goes back and fills it instead of falsely advancing.
      if (el.disabled || el.getAttribute("aria-disabled") === "true") {
        const lbl0 = (el.textContent || target).trim().replace(/\s+/g, " ").slice(0, 60);
        console.warn("[PC] click_element blocked — disabled:", lbl0);
        return "\"" + lbl0 + "\" is disabled right now — something still needs to be filled in or selected before it works. " +
               "Check for an empty required field (like an email) or an unselected option, complete it, then try again.";
      }
      try {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(function () {
          try { el.click(); } catch (_) {}
        }, 200);
        const label = (el.textContent || "").trim().slice(0, 60) || el.tagName.toLowerCase();
        console.log("[PC] click_element →", "<" + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + ">", "\"" + label + "\"");
        return "Clicked \"" + label + "\".";
      } catch (err) {
        console.error("[PC] click_element error", err);
        return "Failed to click \"" + target + "\": " + (err && err.message || String(err));
      }
    },

    type_text: function (params) {
      const target = String(params && params.target || "").trim();
      const text = String(params && params.text || "");
      console.log("[PC] type_text ←", target || "(empty)", "(" + text.length + " chars)");
      if (!target) return "I need to know which input field to type into.";
      if (!text) return "I need to know what text to type.";
      // Find input/textarea by placeholder, aria-label, associated <label for=""> text,
      // or nearby wrapping label.
      let el = TOOLS.findElement(target);
      if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) {
        // Direct input/textarea search with placeholder/aria-label/label traversal
        const inputs = document.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='button']), textarea, [contenteditable='true']");
        const lower = target.toLowerCase();
        for (let i = 0; i < inputs.length; i++) {
          const inp = inputs[i];
          if (!isVisibleForClick(inp)) continue;
          const ph = (inp.placeholder || "").toLowerCase();
          const al = (inp.getAttribute("aria-label") || "").toLowerCase();
          // Walk associated <label for="<inp.id>">
          let labelText = "";
          if (inp.id) {
            try {
              const lbl = document.querySelector("label[for=\"" + CSS.escape(inp.id) + "\"]");
              if (lbl) labelText = (lbl.textContent || "").toLowerCase();
            } catch (_) {}
          }
          // Walk wrapping <label>
          if (!labelText && typeof inp.closest === "function") {
            const wrap = inp.closest("label");
            if (wrap) labelText = (wrap.textContent || "").toLowerCase();
          }
          if (
            (ph && ph.indexOf(lower) !== -1) ||
            (al && al.indexOf(lower) !== -1) ||
            (labelText && labelText.indexOf(lower) !== -1)
          ) {
            el = inp;
            break;
          }
        }
        if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) {
          console.warn("[PC] type_text FAILED to resolve input:", target);
          return "I couldn't find an input field matching \"" + target + "\" on this page.";
        }
      }
      console.log("[PC] type_text →", "<" + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + ">");
      try {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          // React 16+ patches the prototype's value setter to track changes via
          // _valueTracker. Assigning el.value = text goes through that patched
          // setter, so when the input event fires React compares its tracked
          // value to the new value, sees them equal, and skips onChange. The
          // submit button (which depends on the controlled `value` state)
          // stays disabled. The fix: call the ORIGINAL native setter directly,
          // then dispatch a real InputEvent — React's tracker still has the
          // old value, sees a delta, and fires onChange.
          const proto = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value").set;
          if (el.value !== "") {
            nativeSetter.call(el, "");
            el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
          }
          nativeSetter.call(el, text);
          el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertFromPaste" }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (el.isContentEditable) {
          // contentEditable: execCommand("insertText") synthesizes a real
          // InputEvent that React/Slate/Lexical/ProseMirror all accept.
          if (el.textContent) {
            document.execCommand("selectAll", false, null);
            document.execCommand("delete", false, null);
          }
          let inserted = false;
          try { inserted = document.execCommand("insertText", false, text); } catch (_) {}
          if (!inserted) {
            // execCommand is deprecated in some browsers; fall back to direct
            // mutation + InputEvent (less reliable for React but better than
            // silently failing).
            el.textContent = text;
            el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
          }
        }
        return "Typed \"" + (text.length > 80 ? text.slice(0, 80) + "…" : text) + "\" into the field.";
      } catch (err) {
        return "Failed to type into \"" + target + "\": " + (err && err.message || String(err));
      }
    },

    // Rule 5: visual-row TreeWalker + anti-hallucination wrapper.
    read_page: function () {
      if (typeof document === "undefined") return "Page contents unavailable.";
      const root = document.querySelector("main") ||
                   document.querySelector("[role='main']") ||
                   document.body;
      if (!root) return "The page hasn't rendered any content yet.";
      let body = "";
      try { body = extractStructuredPageText(root); }
      catch (err) {
        console.warn("[PC] read_page walker failed, falling back to innerText", err);
        body = (root.innerText || root.textContent || "")
          .split("\n").map(function (l) { return l.replace(/[ \t]+/g, " ").trim(); })
          .filter(Boolean).join("\n");
      }
      if (!body) return "This page rendered but has no readable text right now.";
      const fullLen = body.length;
      const truncated = fullLen > READ_PAGE_MAX_CHARS
        ? body.slice(0, READ_PAGE_MAX_CHARS) + "\n\n…[truncated — full page is " + fullLen + " chars]"
        : body;
      console.log("[PC] read_page → " + truncated.length + "/" + fullLen + " chars, route=" + location.pathname);
      return (
        "LIVE PAGE CONTENTS for " + (location.pathname || "/") + ".\n\n" +
        "RULES FOR READING THIS:\n" +
        "- Each line below is ONE visual row from the page.\n" +
        "- Lines starting with # are headings (more #s = deeper level).\n" +
        "- Use values EXACTLY as shown. Do NOT guess names, numbers, or statuses.\n" +
        "- If the user asks for something not on this page, say \"I don't see that on this page\" — do NOT invent it.\n\n" +
        "=== PAGE BEGIN ===\n" + truncated + "\n=== PAGE END ==="
      );
    },

    // 6th tool: smooth scroll the visitor's view of the current page.
    // Direction: "up" | "down" | "top" | "bottom".
    // Amount (optional): "small" (~300px) | "medium" (~600px) | "large" (~viewport) | a pixel count.
    scroll_page: function (params) {
      if (typeof window === "undefined" || typeof document === "undefined") {
        return "Scrolling unavailable.";
      }
      var direction = String((params && params.direction) || "").toLowerCase().trim();
      var amountInput = String((params && params.amount != null) ? params.amount : "").toLowerCase().trim();

      // Resolve scroll distance. Distances are VIEWPORT-RELATIVE so the move
      // feels the same on a phone and on a 4K monitor. A normal "scroll down"
      // advances ~82% of the viewport, which KEEPS the last ~1/6 of the prior
      // view on screen for continuity (the visitor doesn't lose their place,
      // then sees a fresh section below). The old behavior was a fixed 600px —
      // a tiny "3cm" nudge on tall desktops, with zero overlap. Pixel amounts
      // are still honored when the caller passes an explicit number.
      var vh = Math.max(200, window.innerHeight || 900);
      var amount;
      if (amountInput === "small") amount = Math.round(vh * 0.50);
      else if (amountInput === "large") amount = Math.round(vh * 0.92);
      else if (amountInput === "medium" || amountInput === "") amount = Math.round(vh * 0.82);
      else if (/^\d+$/.test(amountInput)) amount = Math.max(50, Math.min(8000, parseInt(amountInput, 10)));
      else amount = Math.round(vh * 0.82);

      try {
        if (direction === "top") {
          window.scrollTo({ top: 0, behavior: "smooth" });
          console.log("[PC] scroll_page → top");
          return "Scrolled to the top of the page.";
        }
        if (direction === "bottom") {
          var bottom = Math.max(
            document.body ? document.body.scrollHeight : 0,
            document.documentElement ? document.documentElement.scrollHeight : 0
          );
          window.scrollTo({ top: bottom, behavior: "smooth" });
          console.log("[PC] scroll_page → bottom");
          return "Scrolled to the bottom of the page.";
        }
        if (direction !== "up" && direction !== "down") {
          return "I need a direction: 'up', 'down', 'top', or 'bottom'.";
        }
        var delta = direction === "down" ? amount : -amount;
        window.scrollBy({ top: delta, behavior: "smooth" });
        console.log("[PC] scroll_page → " + direction + " " + amount + "px (vh=" + vh + ")");
        var frac = amount >= vh * 0.85 ? "almost a full screen" :
                   amount >= vh * 0.60 ? "most of a screen" :
                   amount >= vh * 0.40 ? "about half a screen" : "a little";
        return "Scrolled " + direction + " by " + frac + ".";
      } catch (err) {
        return "Failed to scroll: " + ((err && err.message) || String(err));
      }
    },

    // 7th tool: smooth-scroll a specific element into view by visible text or selector.
    // Pair with highlight_element to point at the thing afterwards.
    scroll_to: function (params) {
      const target = String((params && params.target) || "").trim();
      if (!target) return "I need something to scroll to. Tell me a heading, section name, or visible label.";
      const el = TOOLS.findElement(target);
      if (!el) return "I can't find \"" + target + "\" on this page.";
      try {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const label = (el.textContent || target).trim().replace(/\s+/g, " ").slice(0, 60);
        console.log("[PC] scroll_to →", label);
        return "Scrolled to \"" + label + "\".";
      } catch (err) {
        return "Failed to scroll to \"" + target + "\": " + ((err && err.message) || String(err));
      }
    },

    // 8th tool: visually highlight (pulsing indigo ring) an element for a few seconds.
    // Reposition timer keeps the ring locked on if the page or element moves.
    highlight_element: function (params) {
      const target = String((params && params.target) || "").trim();
      if (!target) return "I need something to highlight. Tell me what you want me to point at.";
      const dRaw = params && Number(params.duration_ms);
      const duration = Math.max(500, Math.min(15000, isFinite(dRaw) && dRaw > 0 ? dRaw : 3000));
      const el = TOOLS.findElement(target);
      if (!el) return "I can't find \"" + target + "\" to highlight.";
      try {
        ensureHighlightStyles();
        // Describe WHERE it sits on the page (so Jack can say it aloud), then
        // bring it into view — otherwise the ring pulses below the fold and the
        // visitor never sees what we're pointing at.
        var locPhrase = "";
        try {
          var rect0 = el.getBoundingClientRect();
          var absTop = rect0.top + window.scrollY;
          var docH = Math.max(
            document.body ? document.body.scrollHeight : 0,
            document.documentElement ? document.documentElement.scrollHeight : 1
          );
          var vRatio = absTop / docH;
          var vWord = vRatio < 0.18 ? "near the top" :
                      vRatio < 0.45 ? "in the upper part" :
                      vRatio < 0.70 ? "around the middle" :
                      vRatio < 0.90 ? "in the lower part" : "near the bottom";
          var cx = rect0.left + rect0.width / 2;
          var iw = window.innerWidth || 1024;
          var hWord = cx < iw / 3 ? "on the left" :
                      cx > (iw * 2) / 3 ? "on the right" : "in the center";
          locPhrase = " It's " + vWord + " of the page, " + hWord + ".";
        } catch (_) {}
        try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
        // Shared ring drawer — same pulsing indigo ring find_on_page reuses.
        showHighlightRing(el, duration);
        // Visual enhancement: turn the sprite to face the highlighted element
        // and play the matching directional pointing pose (13-row pets only).
        pointToward(el, Math.min(duration, 2600));
        const label = (el.textContent || target).trim().replace(/\s+/g, " ").slice(0, 60);
        console.log("[PC] highlight_element →", label, "(" + duration + "ms)");
        return "Highlighted \"" + label + "\" for " + (duration / 1000) + " seconds." + locPhrase;
      } catch (err) {
        return "Failed to highlight \"" + target + "\": " + ((err && err.message) || String(err));
      }
    },

    // run_choreography — play a named visual routine published by the host site
    // on window.__PetConciergeChoreo (see knowledge/data-pc-spec.md §2/§3).
    //   mode:"tour" → autoplay the beats on a timeline (scrollTo/highlight/pause
    //     against pc:<landmark> targets), holding hold_ms between beats, and
    //     return ALL the beat .say lines joined into ONE narration string so the
    //     agent speaks continuously WHILE the visuals play. One round-trip; the
    //     timeline runs async and we return promptly with the narration.
    //   mode:"flow" → position the page (scroll to the first step / pc:build-
    //     section + highlight it) and return the deterministic step plan so the
    //     agent executes ONE step at a time and never re-asks.
    // Barge-in: a "tour" registers its timers + ring in STATE so abortChoreo()
    // (wired to onModeChange "listening" + onDisconnect) cancels it the instant
    // the visitor speaks. Always returns a clean string — never throws.
    run_choreography: function (params) {
      const name = String((params && params.name) || "").trim();
      console.log("[PC] run_choreography ←", name || "(empty)");
      if (!name) return "I need the name of a choreography to run.";

      const lib = window.__PetConciergeChoreo;
      const routine = lib && typeof lib === "object" ? lib[name] : null;
      if (!routine || typeof routine !== "object") {
        console.warn("[PC] run_choreography — no choreography named", name);
        return "No choreography named " + name + ".";
      }

      const mode = String(routine.mode || "").toLowerCase();

      // ── TOUR ──────────────────────────────────────────────────────────────
      if (mode === "tour") {
        const beats = Array.isArray(routine.beats) ? routine.beats : [];
        if (beats.length === 0) {
          return "The choreography " + name + " has no beats to play.";
        }
        // Abort any tour already in flight, then claim the slot.
        abortChoreo();
        STATE.choreoActive = true;
        STATE.choreoTimers = [];

        // Join every beat's spoken line into ONE natural narration paragraph so
        // the agent speaks continuously while the visuals play. Hoisted here so
        // BOTH the body-led path and the legacy timeline return the same string.
        const narrate = beats
          .map(function (b) { return String(b.say || "").trim(); })
          .filter(Boolean)
          .join(" ");

        // ── BODY-LED path (Space Mario physically flies the tour) ─────────────
        // If the routine opts in (body:true) AND a page-aware body is mounted,
        // delegate the WHOLE visual sequence to its tested tour() sequencer: it
        // scrolls each target into view, flies the body there, points +
        // spotlights, and holds — ONE awaited loop, so beats can't collide. We
        // still return the joined narration immediately so the agent speaks
        // (paced one-call) while the body plays. Falls through to the legacy
        // fixed-timer timeline below if no page-aware body is available.
        if (routine.body === true) {
          try {
            const inst = window.__SM_INST;
            const beh = inst && inst.behavior;
            if (beh && typeof beh.tour === "function") {
              const stops = [];
              for (let bi = 0; bi < beats.length; bi++) {
                const bt = beats[bi];
                const tg = String(bt.target || "").trim();
                if (!tg) continue;
                stops.push({
                  target: tg.slice(0, 3) === "pc:" ? tg.slice(3) : tg, // tour() resolves data-pc
                  say: String(bt.say || ""),
                  hold: (isFinite(bt.hold_ms) && bt.hold_ms > 0) ? bt.hold_ms : 2800,
                });
              }
              beh.tour(stops, {
                scroll: true,
                bow: routine.bow !== false,
                finale: routine.finale !== false,
                // Per-stop callback. Production no-op unless a host opts in via
                // window.__PC_CHOREO_ONSTEP (used by the section test harness to
                // show captions); never allowed to break the tour.
                onStep: function (s) {
                  try { if (typeof window.__PC_CHOREO_ONSTEP === "function") window.__PC_CHOREO_ONSTEP(s); } catch (_) {}
                },
              });
              STATE.choreoActive = true; // body tour self-completes; barge-in flips this
              console.log("[PC] run_choreography → BODY tour \"" + name + "\" (" + stops.length + " stops)");
              return JSON.stringify({ ok: true, narrate: narrate });
            }
            console.log("[PC] run_choreography — body:true but no page-aware body; using legacy timeline for", name);
          } catch (e) {
            console.warn("[PC] body tour failed; falling back to legacy timeline", e);
          }
        }

        // Resolve a beat target ("pc:how" or a bare name) through findElement so
        // the data-pc first branch (and the existing fuzzy chain) both apply.
        const resolveBeat = function (rawTarget) {
          const tg = String(rawTarget || "").trim();
          if (!tg) return null;
          const full = tg.slice(0, 3) === "pc:" ? tg : ("pc:" + tg);
          try { return TOOLS.findElement(full); } catch (_) { return null; }
        };

        // Kick the timeline off ASYNCHRONOUSLY: schedule each beat at its
        // cumulative offset. We return the narration immediately (below) so the
        // agent speaks while these fire. Every timer id is tracked so a barge-in
        // cancels the whole sequence.
        let offset = 0;
        for (let i = 0; i < beats.length; i++) {
          (function (beat) {
            const t = window.setTimeout(function () {
              if (!STATE.choreoActive) return; // aborted before this beat ran
              try {
                const act = String(beat.do || "").toLowerCase();
                const el = resolveBeat(beat.target);
                const holdMs = (isFinite(beat.hold_ms) && beat.hold_ms > 0) ? beat.hold_ms : 2800;
                if (act === "pause" || !el) {
                  // pause = just hold; missing element = skip the visual but keep time
                  return;
                }
                if (act === "scrollto") {
                  try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
                } else if (act === "highlight") {
                  // Reuse the SHARED ring drawer + the directional point pose —
                  // do NOT reimplement. Bring it into view first, then ring it
                  // for the hold, and stash the ring so abortChoreo() clears it.
                  try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
                  try { STATE.choreoRing = showHighlightRing(el, holdMs); } catch (_) {}
                  try { pointToward(el, Math.min(holdMs, 2600)); } catch (_) {}
                }
              } catch (_) { /* one bad beat must not break the tour */ }
            }, offset);
            STATE.choreoTimers.push(t);
            offset += (isFinite(beat.hold_ms) && beat.hold_ms > 0) ? beat.hold_ms : 2800;
          })(beats[i]);
        }
        // After the last beat's hold, the tour is "done" — clear the active flag
        // (the ring removes itself via its own timeout) so a fresh tour can run.
        const doneTimer = window.setTimeout(function () {
          STATE.choreoActive = false;
          STATE.choreoTimers = [];
          STATE.choreoRing = null;
        }, offset + 200);
        STATE.choreoTimers.push(doneTimer);

        console.log("[PC] run_choreography → tour \"" + name + "\" (" + beats.length + " beats, ~" + offset + "ms)");
        return JSON.stringify({ ok: true, narrate: narrate });
      }

      // ── FLOW ──────────────────────────────────────────────────────────────
      if (mode === "flow") {
        const steps = Array.isArray(routine.steps) ? routine.steps : [];
        // Position the page: scroll to the first step's target (or
        // pc:build-section) and highlight it, so the visitor's eye is parked
        // where the guided build begins. No autoplay — the agent drives.
        let firstTarget = (steps[0] && steps[0].target) || "pc:build-section";
        let firstEl = null;
        try {
          const ft = String(firstTarget).trim();
          firstEl = TOOLS.findElement(ft.slice(0, 3) === "pc:" ? ft : ("pc:" + ft));
        } catch (_) {}
        if (firstEl) {
          try { firstEl.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
          try { showHighlightRing(firstEl, 3000); } catch (_) {}
          try { pointToward(firstEl, 2600); } catch (_) {}
        }
        const plan = steps.map(function (s) {
          return {
            key:       s.key,
            target:    s.target,
            ask:       s.ask,
            expecting: s.expecting,
            action:    s.action,
            pitfalls:  Array.isArray(s.pitfalls) ? s.pitfalls : (s.pitfalls ? [s.pitfalls] : []),
          };
        });
        console.log("[PC] run_choreography → flow \"" + name + "\" (" + plan.length + " steps)");
        return JSON.stringify({
          ok: true,
          plan: plan,
          note: "execute one step at a time; never re-ask what the visitor already gave",
        });
      }

      console.warn("[PC] run_choreography — unknown mode \"" + mode + "\" for", name);
      return "The choreography " + name + " has an unsupported mode \"" + (routine.mode || "") + "\".";
    },

    // 9th tool: list EVERY pet the visitor can choose in the onboarding wizard —
    // the built-in characters PLUS every community / 60-second-generated pet,
    // fetched live so newly created pets always show up. The agent calls this
    // during the pet-picker step so it offers the FULL roster by name instead of
    // a hard-coded subset. Async — returns a Promise the ConvAI runtime awaits.
    // The click target for each pet is its display name (matches the wizard's
    // pet-card aria-labels), so the agent chains click_element(target="<name>").
    list_available_pets: function () {
      // Built-in roster — always available. Names MUST match the wizard's
      // pet-card aria-labels so click_element resolves them exactly.
      const builtins = [
        { name: "Jack",      blurb: "the briefcase concierge (that's me)" },
        { name: "Donald",    blurb: "bold, all-business closer" },
        { name: "Juan",      blurb: "friendly bilingual guide" },
        { name: "Gary",      blurb: "easygoing helper in glasses" },
        { name: "Choco",     blurb: "playful puppy" },
        { name: "Happy Fox", blurb: "cheerful fox" },
      ];
      const builtinSlugs = { jack: 1, donald: 1, juan: 1, gary: 1, choco: 1, happy: 1 };
      const render = function (all, communityCount) {
        const lines = all.map(function (x) {
          return "- " + x.name + " — " + x.blurb + " (click target: \"" + x.name + "\")";
        });
        return (
          "AVAILABLE PETS the visitor can choose right now (" + all.length + " total" +
          (communityCount != null ? " — " + (all.length - communityCount) + " built-in + " + communityCount + " community" : "") + "). " +
          "Offer ALL of them by name in a natural sentence (don't say any are 'coming soon' — every pet listed here is live and selectable). " +
          "When the visitor picks one, call click_element with the exact name shown as the click target:\n" +
          lines.join("\n")
        );
      };
      let url;
      try { url = new URL("/api/community-pets", CONFIG.endpoint).toString(); }
      catch (_) { url = SCRIPT_ORIGIN + "/api/community-pets"; }
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 8000);
      return fetch(url, { signal: ctrl.signal, credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : { pets: [] }; })
        .then(function (payload) {
          clearTimeout(timer);
          const community = ((payload && payload.pets) || [])
            .filter(function (p) { return p && p.slug && p.spritesheet_url && !builtinSlugs[String(p.slug).toLowerCase()]; })
            .map(function (p) {
              return { name: p.display_name || p.slug, blurb: (p.description || "community-built pet").replace(/\s+/g, " ").trim().slice(0, 80) };
            });
          const all = builtins.concat(community);
          console.log("[PC] list_available_pets →", all.length, "pets (" + community.length + " community):", all.map(function (x) { return x.name; }).join(", "));
          return render(all, community.length);
        })
        .catch(function (err) {
          clearTimeout(timer);
          console.warn("[PC] list_available_pets — community fetch failed, returning built-ins only", err);
          return render(builtins, null);
        });
    },

    // 10th tool: prompt-polish gate for AI app builders (lovable-clone, HS-APP-BUILDER).
    // The agent MUST call this BEFORE typing a "build me X" request into the builder's
    // textarea. We POST the raw user prompt to /api/improve-prompt, which scores it and
    // returns an improved version when weak. The agent then offers BOTH versions to the
    // user verbally — "use yours, use mine, or want to tweak?" — and only AFTER the
    // user picks does the agent call type_text + click_element("Build").
    submit_app_builder_prompt: function (params) {
      const raw = String((params && params.text) || "").trim();
      console.log("[PC] submit_app_builder_prompt ←", raw.length + " chars");
      if (!raw) return "I need the user's app-builder prompt text to evaluate.";

      // Derive the improve-prompt endpoint from the configured voice-session
      // endpoint origin (they live in the same Vercel project).
      let improveEndpoint;
      try {
        improveEndpoint = new URL("/api/improve-prompt", CONFIG.endpoint).toString();
      } catch (_) {
        improveEndpoint = SCRIPT_ORIGIN + "/api/improve-prompt";
      }

      // Async tool — return a Promise so the ConvAI runtime awaits the result.
      // HARD-WON RULE 3: 10s AbortController timeout. A hung /api/improve-prompt
      // leaves the agent silently waiting forever — abort and tell the agent.
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 10000);
      return fetch(improveEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw, context: "app_builder" }),
        signal: ctrl.signal,
      }).then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      }).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) {
          const msg = (r.body && r.body.error) || ("HTTP " + (r.body && r.body.status));
          console.warn("[PC] submit_app_builder_prompt failed:", msg);
          return "Prompt scoring failed (" + msg + "). Type the user's original prompt as-is.";
        }
        const b = r.body || {};
        console.log("[PC] submit_app_builder_prompt → score=" + b.score, "weak=" + b.weak);
        if (b.weak) {
          return (
            "PROMPT EVALUATION: weak (score " + b.score + "/100). " +
            "Reason: " + (b.rationale || "(none)") + ". " +
            "ORIGINAL: \"" + b.original + "\". " +
            "IMPROVED: \"" + b.improved + "\". " +
            "INSTRUCTIONS FOR YOU: Speak BOTH versions to the user, then ask which they want to use " +
            "(original, improved, or revise more). Do NOT call type_text yet. " +
            "After the user picks, call type_text with the chosen text into the builder's prompt textarea, " +
            "then call click_element with target \"Build\"."
          );
        }
        return (
          "PROMPT EVALUATION: strong (score " + b.score + "/100). " +
          "INSTRUCTIONS FOR YOU: The user's prompt is good as-is. " +
          "Immediately call type_text with the original text into the builder's prompt textarea, " +
          "then call click_element with target \"Build\". Do not bother the user with a confirmation."
        );
      }).catch(function (err) {
        clearTimeout(timer);
        const msg = (err && err.message) || String(err);
        const isAbort = err && err.name === "AbortError";
        console.error("[PC] submit_app_builder_prompt error", err);
        if (isAbort) {
          setBubbleLine("prompt scoring timed out — try again");
          return "Prompt scoring timed out after 10s. Fall back to typing the original prompt as-is.";
        }
        return "Prompt scoring errored (" + msg + "). Fall back to typing the original prompt as-is.";
      });
    },

    // ── BUILDER PET (Gary) — 4 builder-only tools ───────────────────────────
    // Visible only when the host site embeds Gary's agent. Other pets simply
    // never invoke them. All four bail out gracefully on non-builder sites.

    // 10th tool — read source files from the AI app builder's Code view.
    // Defaults: returns the file LIST + the entry file. Pass {list_only:true}
    // for just the names, or {paths:[...]} to read specific files (4KB each).
    // Auth: reads token from window.__pcAuthToken() shim the host page sets.
    // Worker URL: from data-worker attr on the embed script.
    read_code_view: function (params) {
      const opts = params || {};
      const workerUrl = String(CONFIG.workerUrl || "").replace(/\/$/, "");
      if (!workerUrl) {
        return "Code reading isn't enabled on this host — no worker URL configured. Tell the user this builder hasn't wired up file access yet.";
      }
      const m = location.pathname.match(/\/editor\/([^\/\?#]+)/);
      const projectId = m ? m[1] : null;
      if (!projectId) {
        return "No project in scope — the visitor isn't inside an editor page. Path is " + location.pathname + ". Tell them to open a project first.";
      }
      const tokenFn = window.__pcAuthToken;
      if (typeof tokenFn !== "function") {
        return "Code reading is configured but the host page hasn't published an auth-token getter (window.__pcAuthToken). Tell the user code access isn't ready yet.";
      }
      // HARD-WON RULE 3: 10s AbortController timeout on the worker fetch.
      // A hung builder worker shouldn't leave the agent silently waiting.
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 10000);
      return Promise.resolve(tokenFn()).then(function (token) {
        if (!token) { clearTimeout(timer); return "No auth token available. The user may need to sign in."; }
        return fetch(workerUrl + "/api/versions/" + encodeURIComponent(projectId) + "/latest", {
          headers: { Authorization: "Bearer " + token },
          signal: ctrl.signal,
        }).then(function (res) {
          if (!res.ok) {
            clearTimeout(timer);
            return "Code fetch failed (HTTP " + res.status + "). Tell the user the builder isn't serving the project's files right now.";
          }
          return res.json();
        }).then(function (data) {
          clearTimeout(timer);
          const files = (data && data.version && data.version.files) || {};
          const paths = Object.keys(files).sort();
          if (paths.length === 0) {
            return "No files in this project yet — looks like nothing has been generated. Suggest they describe what to build.";
          }
          if (opts.list_only) {
            return "FILES (" + paths.length + "): " + paths.join(", ");
          }
          const requested = Array.isArray(opts.paths) && opts.paths.length
            ? opts.paths
            : pickEntryFile(paths);
          const out = ["FILES (" + paths.length + "): " + paths.join(", "), ""];
          for (let i = 0; i < requested.length; i++) {
            const p = requested[i];
            const content = files[p];
            if (typeof content !== "string") {
              out.push("--- " + p + " ---");
              out.push("(file not found in project)");
            } else {
              out.push("--- " + p + " ---");
              out.push(content.length > 4000 ? content.slice(0, 4000) + "\n…[truncated " + (content.length - 4000) + " more chars]" : content);
            }
            out.push("");
          }
          return out.join("\n");
        });
      }).catch(function (err) {
        clearTimeout(timer);
        const msg = (err && err.message) || String(err);
        const isAbort = err && err.name === "AbortError";
        console.error("[PC] read_code_view error", err);
        if (isAbort) {
          setBubbleLine("code fetch timed out — try again");
          return "Code read timed out after 10s. Tell the user the builder isn't responding right now.";
        }
        return "Code read errored (" + msg + "). Tell the user code access hit a snag.";
      });
    },

    // 11th tool — open the intake notepad and prep for the 5-question script.
    start_intake_questionnaire: function () {
      if (!UI.tablet) return "Intake UI isn't ready yet — tell the user to retry in a moment.";
      // Reset accumulator + clear any prior rows from a previous run.
      STATE.intake = { open: true, answers: {} };
      UI.tabletBody.innerHTML = "";
      UI.tablet.classList.remove("fading");
      UI.tablet.setAttribute("data-pc-open", "true");
      ensureHandwritingFont();
      setSpriteRow(UI.spriteImg, "review");  // "review" row = heads-down note-taking (no "writing" row exists)
      console.log("[PC] intake started");
      return "TABLET OPEN. Now ask the FIRST question verbally: \"What kind of app are we building today?\" Wait for the user's answer, then call record_intake_answer with field=\"app_type\" and value=<their answer>. Do NOT batch questions — one at a time.";
    },

    // 12th tool — scribble one answer onto the notepad with a Rough Notation underline.
    record_intake_answer: function (params) {
      if (!STATE.intake.open) return "Intake hasn't started yet. Call start_intake_questionnaire first.";
      const field = String((params && params.field) || "").trim();
      const value = String((params && params.value) || "").trim();
      if (!INTAKE_FIELDS[field]) {
        return "Invalid field: \"" + field + "\". Must be one of: " + Object.keys(INTAKE_FIELDS).join(", ");
      }
      if (!value) return "Empty value — capture what the visitor said.";
      STATE.intake.answers[field] = value;

      // Render the row + animate the rough-notation underline once the lib loads.
      const row = document.createElement("div");
      row.className = "pc-tablet-row";
      const label = document.createElement("span");
      label.className = "pc-tablet-label";
      label.textContent = INTAKE_FIELDS[field];
      const val = document.createElement("span");
      val.className = "pc-tablet-value";
      val.textContent = value;
      row.appendChild(label);
      row.appendChild(val);
      UI.tabletBody.appendChild(row);

      loadRoughNotation().then(function (rn) {
        try {
          const ann = rn.annotate(val, {
            type: "underline",
            color: "#1e40af",
            strokeWidth: 2,
            padding: 1,
            animationDuration: 700,
          });
          // delay so the row's slide-in finishes before the scribble
          setTimeout(function () { ann.show(); }, 250);
        } catch (e) {
          console.debug("[PC] rough-notation skipped", e);
        }
      }).catch(function () { /* font/lib failure is non-fatal */ });

      const remaining = Object.keys(INTAKE_FIELDS).filter(function (k) {
        return !STATE.intake.answers[k];
      });
      console.log("[PC] intake answer:", field, "→", value, "| remaining:", remaining);
      if (remaining.length === 0) {
        return "All 5 answers captured. Now call finish_intake to submit the brief to the builder.";
      }
      const nextField = remaining[0];
      const nextQ = {
        app_type:     "What kind of app are we building today?",
        target_user:  "Who's the main person who'll use it?",
        must_haves:   "What are the top three things it has to do?",
        visual_style: "Any visual style or vibe — modern, playful, corporate, something specific?",
        integrations: "Any data sources or services we need to plug in — auth, payments, an API?",
      }[nextField];
      return "ANSWER RECORDED. Next question to ask: \"" + nextQ + "\" (field = " + nextField + "). Don't batch — wait for their reply, then call record_intake_answer again.";
    },

    // 13th tool — compile the 5 answers into a single builder brief, fade
    // the tablet, return the synthesized brief + instructions for the agent
    // to drive type_text + click_element("Build").
    finish_intake: function () {
      if (!STATE.intake.open) return "Intake hasn't started — nothing to finish.";
      const a = STATE.intake.answers;
      const captured = Object.keys(INTAKE_FIELDS).filter(function (k) { return a[k]; });
      if (captured.length === 0) {
        return "No answers captured yet — call record_intake_answer for each of the 5 fields first.";
      }
      const brief = synthesizeBrief(a);

      // Fade the tablet, reset sprite, clear state.
      UI.tablet.classList.add("fading");
      setTimeout(function () {
        UI.tablet.removeAttribute("data-pc-open");
        UI.tablet.classList.remove("fading");
        UI.tabletBody.innerHTML = "";
      }, 380);
      setSpriteRow(UI.spriteImg, "idle");
      STATE.intake = { open: false, answers: {} };

      console.log("[PC] intake finished — brief:", brief);
      return (
        "INTAKE COMPLETE. Synthesized brief: \"" + brief + "\". " +
        "INSTRUCTIONS FOR YOU: read the brief aloud to the user in ONE sentence (\"Here's what I've got: ...\"), " +
        "then call type_text with target \"describe what to build\" and text = the brief above, " +
        "then call click_element with target \"Build\". Don't ask for confirmation — just ship it."
      );
    },

    // ── UNIVERSAL ACTION TOOLS (work on any host site) ───────────────────────
    // 8 site-agnostic helpers the agent can call to act on behalf of the
    // visitor: place a call, get directions, copy text, open a link, find text
    // on the page, go back, share, and resize text. All defensive — a handler
    // must NEVER throw or break the live call; each returns a short spoken
    // string. ConvAI calls these AFTER the agent speaks, so the browser may not
    // see a user gesture: window.open / clipboard / share can be blocked, and
    // every such path falls back gracefully instead of failing.

    // Place a phone call. Uses params.number if given, else detects the first
    // business phone on the page (a[href^="tel:"] preferred, then a conservative
    // regex over visible text). Opens tel:<digits> — harmless to the live call
    // because the OS handles the scheme without navigating the page.
    call_business: function (params) {
      var explicit = String((params && params.number) || "").trim();
      console.log("[PC] call_business ←", explicit || "(detect)");
      try {
        var display = "";
        var digits = "";
        if (explicit) {
          display = explicit;
          digits = explicit.replace(/[^\d+]/g, "");
        } else {
          // 1) Prefer an explicit tel: link.
          var telLink = document.querySelector("a[href^=\"tel:\"]");
          if (telLink) {
            var href = telLink.getAttribute("href") || "";
            digits = href.replace(/^tel:/i, "").replace(/[^\d+]/g, "");
            display = (telLink.textContent || "").trim() || href.replace(/^tel:/i, "");
          }
          // 2) Else scan visible text for a conservative US phone pattern.
          if (!digits) {
            var text = "";
            try { text = extractStructuredPageText(document.body); } catch (_) {}
            var m = text.match(/(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/);
            if (m) {
              display = m[0].trim();
              digits = display.replace(/[^\d+]/g, "");
            }
          }
        }
        if (!digits) {
          return "I couldn't find a phone number on this page. If you have one, tell it to me and I'll dial it.";
        }
        try {
          window.location.href = "tel:" + digits;
        } catch (_) {
          // Synthesized-anchor fallback (some embedded webviews block location.href schemes).
          try {
            var a = document.createElement("a");
            a.href = "tel:" + digits;
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            if (a.parentNode) a.parentNode.removeChild(a);
          } catch (__) {}
        }
        console.log("[PC] call_business →", digits);
        return "I'm dialing " + (display || digits) + " for you — if your computer can't place calls, here's the number: " + (display || digits) + ".";
      } catch (err) {
        return "I ran into a problem trying to dial that. The number, if you want to copy it, is what's shown on the page.";
      }
    },

    // Open Google Maps directions. Uses params.address if given, else detects
    // a schema.org PostalAddress / <address> / maps link / "street, city, ST"
    // pattern. Opens in a new tab; if the popup is blocked, navigates a new
    // tab is impossible so we report the address for the agent to read.
    get_directions: function (params) {
      var explicit = String((params && params.address) || "").trim();
      console.log("[PC] get_directions ←", explicit || "(detect)");
      try {
        var address = explicit;
        if (!address) {
          // 1) schema.org PostalAddress.
          var pa = document.querySelector("[itemtype*=\"PostalAddress\"]");
          if (pa) address = (pa.textContent || "").replace(/\s+/g, " ").trim();
          // 2) <address> element.
          if (!address) {
            var ae = document.querySelector("address");
            if (ae) address = (ae.textContent || "").replace(/\s+/g, " ").trim();
          }
          // 3) A Google Maps link — pull its query if present, else use the URL.
          if (!address) {
            var ml = document.querySelector("a[href*=\"maps.google\"], a[href*=\"google.com/maps\"]");
            if (ml) {
              try {
                var u = new URL(ml.href);
                address = u.searchParams.get("q") || u.searchParams.get("query") ||
                          (ml.textContent || "").replace(/\s+/g, " ").trim();
              } catch (_) {
                address = (ml.textContent || "").replace(/\s+/g, " ").trim();
              }
            }
          }
          // 4) Conservative "street, city, ST 99999" regex over visible text.
          if (!address) {
            var pageText = "";
            try { pageText = extractStructuredPageText(document.body); } catch (_) {}
            var am = pageText.match(/\d{1,6}\s+[\w.\- ]+,\s*[\w.\- ]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?/);
            if (am) address = am[0].replace(/\s+/g, " ").trim();
          }
        }
        if (!address) {
          return "I couldn't find an address on this page. Tell me the address and I'll pull up directions.";
        }
        var url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
        var win = null;
        try { win = window.open(url, "_blank", "noopener"); } catch (_) { win = null; }
        if (!win) {
          // Popup blocked (no user gesture). Don't reload THIS tab — that would
          // kill the call. Report the address for the agent to speak.
          console.warn("[PC] get_directions — popup blocked");
          return "I have the address — " + address + " — but your browser blocked the map pop-up. You can search that in Google Maps.";
        }
        console.log("[PC] get_directions →", address);
        return "Opening directions to " + address + " in a new tab.";
      } catch (err) {
        return "I had trouble pulling up directions. The address on the page is what you'd search in Maps.";
      }
    },

    // Copy text or an element's value to the clipboard. params.text wins; else
    // resolve params.target via findElement and copy its .value (inputs) or
    // visible textContent. Async clipboard first, then textarea+execCommand,
    // then return the value so the agent can read it aloud.
    copy_to_clipboard: function (params) {
      var text = (params && params.text != null) ? String(params.text) : "";
      var target = String((params && params.target) || "").trim();
      console.log("[PC] copy_to_clipboard ←", text ? "(text " + text.length + " chars)" : ("target=" + (target || "(none)")));
      try {
        var value = text;
        if (!value && target) {
          var el = TOOLS.findElement(target);
          if (!el) {
            return "I couldn't find \"" + target + "\" on this page to copy.";
          }
          if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && typeof el.value === "string") {
            value = el.value;
          } else {
            value = (el.textContent || "").replace(/\s+/g, " ").trim();
          }
        }
        if (!value) {
          return "I need either some text or something on the page to copy.";
        }
        var shortVal = value.length > 80 ? value.slice(0, 80) + "…" : value;
        // Synchronous fallback used if the async clipboard write fails/rejects.
        var execCopy = function () {
          try {
            var ta = document.createElement("textarea");
            ta.value = value;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.top = "-9999px";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, value.length);
            var ok = false;
            try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
            if (ta.parentNode) ta.parentNode.removeChild(ta);
            return ok;
          } catch (_) { return false; }
        };
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          return navigator.clipboard.writeText(value).then(function () {
            console.log("[PC] copy_to_clipboard → (async ok)");
            return "Copied \"" + shortVal + "\" to your clipboard.";
          }).catch(function () {
            if (execCopy()) {
              console.log("[PC] copy_to_clipboard → (execCommand ok)");
              return "Copied \"" + shortVal + "\" to your clipboard.";
            }
            console.warn("[PC] copy_to_clipboard — all copy paths failed");
            return "I couldn't reach your clipboard, but here's the text so you can copy it: " + value;
          });
        }
        if (execCopy()) {
          console.log("[PC] copy_to_clipboard → (execCommand ok, no async API)");
          return "Copied \"" + shortVal + "\" to your clipboard.";
        }
        return "I couldn't reach your clipboard, but here's the text so you can copy it: " + value;
      } catch (err) {
        return "I couldn't copy that. " + ((params && params.text) ? "The text was: " + String(params.text) : "");
      }
    },

    // Open a URL, scheme, or a link resolved by visible text. http/https open
    // in a NEW tab (a same-tab https load would reload the page and kill the
    // call); mailto/tel/sms use location.href (the OS handles them, no reload).
    open_link: function (params) {
      var target = String((params && params.target) || "").trim();
      console.log("[PC] open_link ←", target || "(empty)");
      if (!target) return "I need to know what to open — a link name, a website, or an email/phone.";
      try {
        var lower = target.toLowerCase();
        var url = "";
        // Phrase shortcuts: "email them" / "text them" → detect a scheme link.
        if (/^(email|e-mail|mail)\b/.test(lower) && lower.indexOf("@") === -1 && !/^mailto:/.test(lower)) {
          var mailA = document.querySelector("a[href^=\"mailto:\"]");
          if (mailA) url = mailA.getAttribute("href");
        } else if (/^(text|sms|message)\b/.test(lower) && !/^sms:/.test(lower)) {
          var smsA = document.querySelector("a[href^=\"sms:\"]");
          if (smsA) url = smsA.getAttribute("href");
        }
        // Direct URL / scheme.
        if (!url) {
          if (/^(https?:|mailto:|tel:|sms:)/i.test(target)) {
            url = target;
          } else if (/^www\.[^\s]+\.[^\s]+/i.test(target)) {
            url = "https://" + target; // bare domain typed without scheme
          }
        }
        // Else resolve a link by its visible text and use its href.
        if (!url) {
          var el = TOOLS.findElement(target);
          if (el) {
            var href = el.getAttribute && el.getAttribute("href");
            if (!href && el.closest) {
              var a = el.closest("a");
              if (a) href = a.getAttribute("href");
            }
            if (href) url = href;
          }
        }
        if (!url) {
          return "I couldn't find a link matching \"" + target + "\" on this page.";
        }
        // mailto/tel/sms: OS handles the scheme, no page reload, safe in-tab.
        if (/^(mailto:|tel:|sms:)/i.test(url)) {
          try { window.location.href = url; } catch (_) {}
          console.log("[PC] open_link → scheme", url);
          return "Opening " + url.replace(/^(mailto:|tel:|sms:)/i, "").split("?")[0] + " for you.";
        }
        // http/https: NEW tab so we never reload (and kill) the live call.
        // Resolve relative hrefs against the page so the spoken phrase is clean.
        var absUrl = url;
        try { absUrl = new URL(url, location.href).toString(); } catch (_) {}
        var win = null;
        try { win = window.open(absUrl, "_blank", "noopener"); } catch (_) { win = null; }
        if (!win) {
          // Popup blocked (async tool call, no gesture). Do NOT reload this tab
          // — that would end the call. Report the URL for the agent to read.
          console.warn("[PC] open_link — popup blocked", absUrl);
          return "Your browser blocked the pop-up, but here's the link: " + absUrl;
        }
        console.log("[PC] open_link →", absUrl);
        return "Opened " + absUrl + " in a new tab.";
      } catch (err) {
        return "I couldn't open \"" + target + "\": " + ((err && err.message) || String(err));
      }
    },

    // Case-insensitively find query in the page's VISIBLE text, scroll the
    // closest containing element into view, ring it (shared showHighlightRing),
    // and return a ~160-char snippet centered on the match for the agent to read.
    find_on_page: function (params) {
      var query = String((params && params.query) || "").trim();
      console.log("[PC] find_on_page ←", query || "(empty)");
      if (!query) return "I need something to look for. Tell me a word or phrase.";
      try {
        var needle = query.toLowerCase();
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        var node = walker.nextNode();
        var foundNode = null;
        var foundIdx = -1;
        while (node) {
          var raw = node.textContent || "";
          var idx = raw.toLowerCase().indexOf(needle);
          if (idx !== -1) {
            // Skip matches inside our own overlay or invisible/structural nodes.
            var parent = node.parentElement;
            var skip = false;
            var anc = parent;
            while (anc) {
              if (anc.classList && anc.classList.contains("pc-overlay")) { skip = true; break; }
              if (!isReadable(anc)) { skip = true; break; }
              anc = anc.parentElement;
            }
            if (!skip && parent && isVisibleForClick(parent)) {
              foundNode = node;
              foundIdx = idx;
              break;
            }
          }
          node = walker.nextNode();
        }
        if (!foundNode) {
          console.warn("[PC] find_on_page — not found:", query);
          return "I couldn't find \"" + query + "\" on this page.";
        }
        var container = foundNode.parentElement;
        try { container.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
        showHighlightRing(container, 4000);
        // Build a ~160-char snippet centered on the match.
        var full = (foundNode.textContent || "").replace(/\s+/g, " ").trim();
        var matchIn = full.toLowerCase().indexOf(needle);
        if (matchIn === -1) matchIn = 0;
        var start = Math.max(0, matchIn - 70);
        var end = Math.min(full.length, matchIn + query.length + 70);
        var snippet = (start > 0 ? "…" : "") + full.slice(start, end) + (end < full.length ? "…" : "");
        console.log("[PC] find_on_page →", snippet);
        return "Found it — here's what it says: " + snippet;
      } catch (err) {
        return "I had trouble searching the page for \"" + query + "\".";
      }
    },

    // Go to the previous page. If there's history, write the resume sentinel
    // (same mechanism navigate_to uses) so the call survives a static-site full
    // reload, then history.back(). immediate / expects_response false on the
    // agent side, so a short return is fine.
    go_back: function () {
      console.log("[PC] go_back ←");
      try {
        if (!window.history || window.history.length <= 1) {
          return "There's no previous page to go back to.";
        }
        // Mirror navigate_to: only write the sentinel for static-site full
        // reloads (an SPA host with __PetConciergeNavigate keeps the JS context
        // alive, so onRouteChange handles continuity and no sentinel is needed).
        if (STATE.isCallActive && !window.__PetConciergeNavigate) {
          try {
            sessionStorage.setItem(STORAGE_KEY_RESUME, JSON.stringify({
              token: CONFIG.token,
              from:  location.pathname,
              to:    null,
              when:  Date.now(),
            }));
            console.log("[PC] resume sentinel written for go_back");
          } catch (e) {
            console.debug("[PC] go_back resume sentinel write failed", e);
          }
        }
        try { setSpriteRow(UI.spriteImg, "running"); } catch (_) {}
        window.history.back();
        return "Going back to the previous page.";
      } catch (err) {
        return "I couldn't go back: " + ((err && err.message) || String(err));
      }
    },

    // Share the current page via the native share sheet (navigator.share), or
    // fall back to copying the URL to the clipboard when the API is absent.
    share_page: function (params) {
      var title = String((params && params.title) || document.title || "");
      var text = (params && params.text != null) ? String(params.text) : "";
      var url = String((params && params.url) || location.href || "");
      console.log("[PC] share_page ←", url);
      try {
        if (navigator.share && typeof navigator.share === "function") {
          var data = { url: url };
          if (title) data.title = title;
          if (text) data.text = text;
          return navigator.share(data).then(function () {
            console.log("[PC] share_page → shared");
            return "Opened the share menu for this page.";
          }).catch(function (err) {
            if (err && err.name === "AbortError") {
              return "No problem — I closed the share menu.";
            }
            console.warn("[PC] share_page — share failed, falling back to copy", err);
            return TOOLS.copy_to_clipboard({ text: url });
          });
        }
        // No native share — copy the URL instead and tell the user.
        var copyResult = TOOLS.copy_to_clipboard({ text: url });
        return Promise.resolve(copyResult).then(function () {
          return "Your device doesn't have a share menu, so I copied the link instead — you can paste it anywhere.";
        });
      } catch (err) {
        return "I couldn't open the share menu. The link is: " + url;
      }
    },

    // Resize ALL page text. params.scale: 'bigger' | 'smaller' | 'reset' | a
    // numeric multiplier string ('1.25'). Persisted + re-applied on boot.
    set_text_size: function (params) {
      var scale = String((params && params.scale) || "").trim().toLowerCase();
      console.log("[PC] set_text_size ←", scale || "(empty)");
      if (!scale) return "Tell me whether you'd like the text bigger, smaller, or back to normal.";
      try {
        var next;
        if (scale === "bigger" || scale === "larger" || scale === "big") {
          next = clampTextScale(textScale + 0.1);
        } else if (scale === "smaller" || scale === "small") {
          next = clampTextScale(textScale - 0.1);
        } else if (scale === "reset" || scale === "normal" || scale === "default") {
          next = 1.0;
        } else {
          var n = parseFloat(scale);
          if (!isFinite(n)) {
            return "I can make the text bigger, smaller, or reset it to normal — which would you like?";
          }
          next = clampTextScale(n);
        }
        var applied = applyTextScale(next);
        var pct = Math.round(applied * 100);
        console.log("[PC] set_text_size →", applied);
        if (applied >= TEXT_SCALE_MAX - 0.001 && (scale === "bigger" || scale === "larger" || scale === "big")) {
          return "The text is now as big as it goes — " + pct + " percent.";
        }
        if (applied <= TEXT_SCALE_MIN + 0.001 && (scale === "smaller" || scale === "small")) {
          return "The text is now as small as it goes — " + pct + " percent.";
        }
        if (next === 1.0 && (scale === "reset" || scale === "normal" || scale === "default")) {
          return "Text size is back to normal.";
        }
        return "Text size is now " + pct + " percent.";
      } catch (err) {
        return "I couldn't change the text size right now.";
      }
    },
  };

  // ── Helpers for the builder-pet tools ────────────────────────────────────

  // Pick a reasonable "entry" file to surface when no specific paths requested.
  function pickEntryFile(paths) {
    const priority = ["/App.tsx", "/src/App.tsx", "/App.jsx", "/index.html", "/pages/index.tsx", "/app/page.tsx"];
    for (let i = 0; i < priority.length; i++) {
      if (paths.indexOf(priority[i]) !== -1) return [priority[i]];
    }
    // Else: first non-config/manifest path
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      if (!/package\.json|tsconfig|vite\.config|README/i.test(p)) return [p];
    }
    return [paths[0]];
  }

  // Compile the 5 intake answers into a single conversational builder prompt.
  function synthesizeBrief(a) {
    const parts = [];
    if (a.app_type)     parts.push("Build " + a.app_type + ".");
    if (a.target_user)  parts.push("Main user: " + a.target_user + ".");
    if (a.must_haves)   parts.push("Must include: " + a.must_haves + ".");
    if (a.visual_style) parts.push("Style: " + a.visual_style + ".");
    if (a.integrations) parts.push("Integrations: " + a.integrations + ".");
    return parts.join(" ");
  }

  // Lazy-load Rough Notation (3.8 KB gzipped) the first time the tablet opens.
  let _rnPromise = null;
  function loadRoughNotation() {
    if (!_rnPromise) {
      _rnPromise = import("https://esm.sh/rough-notation@0.5.1");
    }
    return _rnPromise;
  }

  // One-shot Google Fonts injection for the handwritten tablet text. If it
  // fails to load (CSP, offline), the font stack falls back through Kalam →
  // Comic Sans → cursive. Non-fatal.
  let _fontInjected = false;
  function ensureHandwritingFont() {
    if (_fontInjected) return;
    _fontInjected = true;
    try {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&display=swap";
      document.head.appendChild(link);
    } catch (_) { /* ignore */ }
  }

  // ── SDK loader (ESM-cached) ───────────────────────────────────────────────
  let sdkPromise = null;
  function loadSdk() {
    if (sdkPromise) return sdkPromise;
    // esm.sh transpiles npm packages → browser-ready ESM modules. The bundle
    // includes audio worklets + WASM the SDK needs.
    sdkPromise = import("https://esm.sh/@elevenlabs/client@0.1.5").catch(function (e) {
      sdkPromise = null;
      throw new Error("Failed to load ElevenLabs SDK: " + e.message);
    });
    return sdkPromise;
  }

  // ── Signed URL fetch ──────────────────────────────────────────────────────
  // Rule 3: ALWAYS via server endpoint. Public agentId silently strips mic.
  // HARD-WON RULE 3: 10s AbortController timeout. Without it a hung backend
  // (cold function, DNS blip, network stall) leaves the sprite stuck on
  // "Connecting…" forever — Mario's demo is dead in the water.
  async function fetchSignedUrl() {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 10000);
    try {
      const res = await fetch(CONFIG.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // backend:"elevenlabs" forces the broker to return an EL signed URL —
        // fetchSignedUrl is only ever the EL path (primary or selfhosted→EL
        // fallback). Without it, a force-selfhosted agent would get another
        // selfhosted token (no signedUrl) and the fallback would fail.
        body: JSON.stringify({ token: CONFIG.token, backend: "elevenlabs" }),
        signal: ctrl.signal,
      });
      let body = {};
      try { body = await res.json(); } catch (_) {}
      if (!res.ok || !body.signedUrl) {
        const reason = body.error || ("Session endpoint returned HTTP " + res.status);
        throw new Error(reason);
      }
      return body.signedUrl;
    } catch (err) {
      if (err && err.name === "AbortError") {
        setBubbleLine("session endpoint timed out — try again");
        throw new Error("Session endpoint timed out after 10s");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Session resolver (backend-agnostic) ───────────────────────────────────
  // Returns {backend:"elevenlabs", signedUrl} OR {backend:"selfhosted",
  // connectUrl, sessionToken}. The ElevenLabs branch is exactly fetchSignedUrl()
  // as before. The self-hosted branch prefers a broker-minted sessionToken (B6)
  // and falls back to the box's /api/dev-token for staging.
  async function fetchSession() {
    if (CONFIG.backend === "selfhosted") {
      let base = (CONFIG.connectUrl || SCRIPT_ORIGIN).replace(/\/+$/, "");
      let token = "";
      try {
        const r = await fetch(CONFIG.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: CONFIG.token }),
        });
        if (r.ok) {
          const b = await r.json();
          if (b.connectUrl) base = String(b.connectUrl).replace(/\/+$/, "");
          if (b.sessionToken) token = b.sessionToken;
        }
      } catch (_) { /* no broker in staging — fall through to dev-token */ }
      if (!token) {
        try {
          const d = await fetch(base + "/api/dev-token");
          if (d.ok) token = (await d.json()).token || "";
        } catch (_) {}
      }
      return { backend: "selfhosted", connectUrl: base + "/api/offer", sessionToken: token };
    }
    const signedUrl = await fetchSignedUrl();
    return { backend: "elevenlabs", signedUrl: signedUrl };
  }

  // ── Self-hosted transport (Pipecat/Chatterbox over WebRTC + RTVI) ─────────
  // Returns an object that mirrors the slice of the ElevenLabs Conversation
  // interface the rest of embed.js depends on — endSession(),
  // sendContextualUpdate(text), getInputByteFrequencyData() — and fires the
  // SAME startOpts callbacks (onConnect/onDisconnect/onModeChange). Tool calls
  // arrive over the RTVI data channel and are dispatched to the SAME
  // startOpts.clientTools bodies, so page-driving behavior is identical.
  async function startPipecatSession(opts, session, inputDeviceId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    const dc = pc.createDataChannel("pipecat");

    const audio = inputDeviceId ? { deviceId: { exact: inputDeviceId } } : true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audio });
    stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
    pc.addTransceiver("audio", { direction: "recvonly" });

    // Mic-level source so the existing 10Hz meter (getInputByteFrequencyData)
    // works unchanged against this backend.
    let analyser = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      ac.createMediaStreamSource(stream).connect(analyser = ac.createAnalyser());
      analyser.fftSize = 256;
    } catch (_) {}

    const remote = new Audio();
    remote.autoplay = true;
    pc.ontrack = function (e) { remote.srcObject = e.streams[0]; };

    let connected = false, ended = false;
    pc.onconnectionstatechange = function () {
      const s = pc.connectionState;
      console.log("[PC] selfhosted pc:", s);
      if (s === "connected" && !connected) {
        connected = true;
        // Defer so startCall has already assigned STATE.conversation before
        // onConnect (which reads STATE.conversation.sendContextualUpdate) runs.
        setTimeout(function () { opts.onConnect && opts.onConnect(); }, 0);
      } else if ((s === "failed" || s === "closed" || s === "disconnected") && !ended) {
        ended = true;
        opts.onDisconnect && opts.onDisconnect({ code: 1000, reason: s });
      }
    };

    function send(o) { if (dc.readyState === "open") dc.send(JSON.stringify(o)); }
    function clientMsg(t, d) {
      send({ label: "rtvi-ai", type: "client-message",
             id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())),
             data: { t: t, d: d } });
    }

    dc.onmessage = async function (ev) {
      let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === "server-message" && msg.data && msg.data.t === "tool_call") {
        const call = msg.data;
        const fn = opts.clientTools && opts.clientTools[call.name];
        let result;
        try { result = fn ? await fn(call.args || {}) : { error: "unknown tool " + call.name }; }
        catch (e) { result = { error: String((e && e.message) || e) }; }
        clientMsg("tool_result", { id: call.id, result: (result === undefined ? { ok: true } : result) });
      } else if (msg.type === "bot-tts-started") {
        opts.onModeChange && opts.onModeChange({ mode: "speaking" });
      } else if (msg.type === "bot-tts-stopped") {
        opts.onModeChange && opts.onModeChange({ mode: "listening" });
      }
    };

    await pc.setLocalDescription(await pc.createOffer({ offerToReceiveAudio: true }));
    await new Promise(function (res) {
      if (pc.iceGatheringState === "complete") return res();
      const c = function () {
        if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", c); res(); }
      };
      pc.addEventListener("icegatheringstatechange", c);
      setTimeout(res, 3000);
    });

    let resp;
    try {
      resp = await fetch(session.connectUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Session-Token": session.sessionToken || "" },
        body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type }),
      });
    } catch (e) {
      // Box unreachable — tear down mic + peer connection so the ElevenLabs
      // fallback (in startCall) starts clean, then rethrow to trigger it.
      try { pc.close(); } catch (_) {}
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
      throw e;
    }
    if (!resp.ok) {
      try { pc.close(); } catch (_) {}
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
      throw new Error("self-hosted offer failed: HTTP " + resp.status);
    }
    await pc.setRemoteDescription(await resp.json());

    return {
      _backend: "selfhosted",
      endSession: async function () {
        ended = true;
        try { send({ label: "rtvi-ai", type: "disconnect-bot", id: "end", data: null }); } catch (_) {}
        try { pc.close(); } catch (_) {}
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
      },
      sendContextualUpdate: function (text) { clientMsg("context_update", { text: text }); },
      getInputByteFrequencyData: function () {
        if (!analyser) return new Uint8Array(0);
        const a = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(a);
        return a;
      },
    };
  }

  // ── ElevenLabs transport (primary path, and the AUTO-FALLBACK) ────────────
  // Loads the ConvAI SDK and starts the session. Resolves a signed URL unless
  // one is supplied (the normal EL path passes the already-resolved one from
  // fetchSession; the self-hosted fallback passes none so we resolve fresh).
  // Uses the SAME startOpts (clientTools + callbacks) as the box, so behaviour
  // after connect is identical regardless of which backend answered.
  async function startElevenLabs(startOpts, resume, signedUrlOverride) {
    const sdk = await loadSdk();
    const ConversationCtor = sdk.Conversation || (sdk.default && sdk.default.Conversation);
    if (!ConversationCtor || typeof ConversationCtor.startSession !== "function") {
      throw new Error("ElevenLabs SDK missing Conversation.startSession");
    }
    startOpts.signedUrl = signedUrlOverride || (await fetchSignedUrl());
    // EXCEPTION to the "no overrides" rule: on resume after a full-document
    // navigation, suppress first_message so the pet continues mid-conversation
    // instead of re-greeting. Requires the agent's first_message override flag.
    if (resume) {
      startOpts.overrides = { agent: { firstMessage: "" } };
      console.log("[PC] resume mode — suppressing agent first_message");
    }
    return await ConversationCtor.startSession(startOpts);
  }

  // ── start() / end() ───────────────────────────────────────────────────────

  // HARD-WON RULE 2: single canonical toggle so the drag-end + Talk-button +
  // SDK-double-fire paths can't race into opening two WebSocket sessions.
  // STATE.starting closes the 200ms async window inside startCall before
  // STATE.isCallActive flips true.
  function toggleCall() {
    if (STATE.isCallActive || STATE.starting) return endCall();
    return startCall();
  }

  // `resume` is set by tryResumeCall() after a full-document navigation —
  // suppresses the agent's first_message so Jack doesn't re-greet ("Hey I'm
  // Jack…") on a mid-conversation reconnect. Requires `agent.first_message`
  // overrides to be enabled on the platform agent; otherwise the WS gets
  // killed with close code 1008 ("Override for field 'first_message' is not
  // allowed by config").
  async function startCall(resume) {
    if (STATE.isCallActive || STATE.starting) return;
    // HARD-WON RULE 2: claim the slot BEFORE any await — the very first
    // network call (mic permission, signed URL fetch) is long enough for a
    // double-tap to slip a second startCall in.
    STATE.starting = true;
    setError(null);
    STATE.reconnectAttempts = 0;
    STATE._resumeMode = !!resume;
    showBubble(true);
    setBubbleLine(resume ? "Reconnecting…" : "Connecting…");
    try {
      // (1) Pre-flight mic permission. Throwaway stream so we can enumerate
      // labels AND capture the OS-default device the user just granted.
      console.log("[PC] requesting mic permission…");
      const permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const permTrack = permStream.getAudioTracks()[0];
      const permLabel = permTrack ? permTrack.label : "(unlabeled)";
      const permDeviceId = permTrack ? permTrack.getSettings().deviceId : undefined;
      permStream.getTracks().forEach(function (t) { t.stop(); });
      console.log("[PC] mic permission granted, default device =", permLabel,
                  permDeviceId ? "[" + permDeviceId.slice(0, 8) + "…]" : "");

      // (2) Resolve which device to actually open (Rule 4).
      const inputDeviceId = await resolveMicDeviceId(permDeviceId);
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(function (d) { return d.kind === "audioinput"; });
        console.log("[PC] audio inputs:", inputs.map(function (d) {
          return (d.label || "(no label)") + " [" + d.deviceId.slice(0, 8) + "…]";
        }));
        const chosen = inputs.find(function (d) { return d.deviceId === inputDeviceId; });
        console.log("[PC] SDK will use device =", chosen ? chosen.label : "(browser default)");
      } catch (_) {}

      // (3) Resolve the session (backend + credentials).
      console.log("[PC] resolving session (backend=" + CONFIG.backend + ")…");
      const session = await fetchSession();

      // (4) Page context. Make sure sitemap+nav discovery has finished so the
      // {{available_pages}} dynamic variable is populated on the FIRST reply.
      await startDiscovery();
      const ctx = buildPageContext();
      console.log("[PC] page context →", ctx.summary,
                  "(" + (DISCOVERED_PAGES ? DISCOVERED_PAGES.length : 0) + " pages known)");

      // (5) Build the shared start options (clientTools + callbacks). Both
      // backends use the SAME clientTools bodies and the SAME callbacks; only
      // the transport differs (EL SDK vs Pipecat/WebRTC).
      console.log("[PC] starting session, backend=" + session.backend + ", inputDeviceId =", inputDeviceId || "(unset)");
      const startOpts = {
        clientTools: (function () {
          var builtin = {
            navigate_to:                TOOLS.navigate_to,
            get_current_page:           TOOLS.get_current_page,
            read_page:                  TOOLS.read_page,
            click_element:              TOOLS.click_element,
            type_text:                  TOOLS.type_text,
            scroll_page:                TOOLS.scroll_page,
            scroll_to:                  TOOLS.scroll_to,
            highlight_element:          TOOLS.highlight_element,
            run_choreography:           TOOLS.run_choreography,
            list_available_pets:        TOOLS.list_available_pets,
            submit_app_builder_prompt:  TOOLS.submit_app_builder_prompt,
            read_code_view:             TOOLS.read_code_view,
            start_intake_questionnaire: TOOLS.start_intake_questionnaire,
            record_intake_answer:       TOOLS.record_intake_answer,
            finish_intake:              TOOLS.finish_intake,
            call_business:              TOOLS.call_business,
            get_directions:             TOOLS.get_directions,
            copy_to_clipboard:          TOOLS.copy_to_clipboard,
            open_link:                  TOOLS.open_link,
            find_on_page:               TOOLS.find_on_page,
            go_back:                    TOOLS.go_back,
            share_page:                 TOOLS.share_page,
            set_text_size:              TOOLS.set_text_size,
          };
          // Host-app DO tools: a host page may register extra client-tool
          // handlers via window.__PetConciergeTools (a { toolName: fn } map),
          // letting an app give its buddy app-specific actions without
          // baking them into this shared loader. Built-ins win on a name
          // collision so a host can never clobber core nav/perception, and
          // when the global is unset behaviour is byte-identical to before.
          var host = (window.__PetConciergeTools && typeof window.__PetConciergeTools === "object")
            ? window.__PetConciergeTools : {};
          var merged = Object.assign({}, host, builtin);
          try {
            var added = Object.keys(host).filter(function (k) { return !(k in builtin); });
            if (added.length) console.log("[PC] host tools registered:", added.join(", "));
          } catch (e) {}
          return merged;
        })(),
        // Rules 1, 2: NO `overrides` key on a FRESH call — use dynamicVariables
        // + contextualUpdate. EXCEPTION on resume below.
        dynamicVariables: ctx.dynamicVariables,
        onConnect: function () {
          console.log("[PC] connected");
          STATE.reconnectAttempts = 0;
          setError(null);
          setLive(true);
          setBubbleLine(CONFIG.name + " is listening.");
          emit("start");
          // Rule 11: also send a contextual update so the FIRST reply already
          // knows the page. dynamicVariables alone covers {{current_page}}
          // template; this covers "the user just navigated to X."
          try {
            STATE.conversation && STATE.conversation.sendContextualUpdate &&
              STATE.conversation.sendContextualUpdate(ctx.contextualUpdate);
            console.log("[PC] contextualUpdate →", ctx.contextualUpdate);
          } catch (e) {
            console.debug("[PC] sendContextualUpdate failed at connect", e);
          }
          startMicMeterPolling();
        },
        // Rule 10: surface non-1000/1005 close codes so silent drops become debuggable.
        onDisconnect: function (reason) {
          const closeCode = (reason && (reason.code != null ? reason.code : reason.closeCode));
          const closeReason = (reason && (reason.reason || (typeof reason === "string" ? reason : undefined)));
          console.log("[PC] disconnected", { closeCode: closeCode, closeReason: closeReason, raw: reason });
          try { abortChoreo(); } catch (_) {}  // kill any in-flight tour on session end
          stopMicMeterPolling();
          setLive(false);
          setBubbleLine(CONFIG.greeting);
          STATE.conversation = null;
          emit("end");
          if (closeCode != null && closeCode !== 1000 && closeCode !== 1005) {
            setError(CONFIG.name + " dropped (close " + closeCode +
                     (closeReason ? ": " + closeReason : "") + "). Click " +
                     CONFIG.name + " to reconnect.");
          }
        },
        // Rule 8: cap reconnect attempts at 2.
        onError: function (msg, context) {
          console.error("[PC] ElevenLabs error:", msg, context);
          const text = typeof msg === "string" ? msg :
                       (msg && msg.message) || "Unknown ElevenLabs error";
          STATE.reconnectAttempts += 1;
          if (STATE.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            setError(CONFIG.name + " couldn't connect after " +
                     MAX_RECONNECT_ATTEMPTS + " attempts. " + text +
                     " Check the agent ID or your network and click " +
                     CONFIG.name + " to try again.");
          } else {
            setError(text);
          }
        },
        onMessage: function (m) { console.debug("[PC] message", m); try { emit("message", { source: (m && m.source) || "ai", text: (m && m.message) || "" }); } catch (e) {} },
        onModeChange: function (mode) {
          // SDK shape: { mode: "speaking" | "listening" }
          const speaking = (mode && (mode.mode === "speaking" || mode === "speaking"));
          STATE.isSpeaking = !!speaking;
          // Choreography barge-in: the SDK flips mode → "listening" the moment
          // the agent stops talking and the user takes the turn (this is also
          // the signal the SDK exposes on user interruption). Cancel any tour
          // in flight so the visuals stop dead when the visitor speaks.
          // TODO(refine): the @elevenlabs/client SDK does not surface a discrete
          // "user_interruption"/"vad_score" callback through this startSession
          // options shape (0.1.5); if a dedicated interruption event is added,
          // hook abortChoreo() to THAT instead for tighter barge-in latency.
          if (!speaking) {
            try { abortChoreo(); } catch (_) {}
          }
          if (speaking) setSpriteRow(UI.spriteImg, "waving");
          else setSpriteRow(UI.spriteImg, "idle");
          // Broadcast mode so host UIs (e.g. the marketing-site Jack figure)
          // can sync their own sprite to speaking vs listening.
          emit("mode", { speaking: !!speaking });
        },
      };
      if (inputDeviceId) startOpts.inputDeviceId = inputDeviceId;

      // (6) Start the session on the resolved backend.
      // ── AUTO-FALLBACK TO ELEVENLABS ──────────────────────────────────────
      // The self-hosted box is primary. If it is unreachable (down, cold,
      // network) the offer POST throws — we catch it and silently start the
      // SAME pet on ElevenLabs instead, so the visitor never sees a dead pet.
      // ElevenLabs stays dormant (zero cost / zero traffic) unless this fires.
      // The next call automatically prefers the box again once it's healthy —
      // there is no sticky "degraded" state to reset.
      if (session.backend === "selfhosted") {
        try {
          // Persona/dynamicVariables are set server-side from the session token;
          // page context flows via sendContextualUpdate (onConnect, same as EL).
          STATE.conversation = await startPipecatSession(startOpts, session, inputDeviceId);
          STATE.activeBackend = "selfhosted";
        } catch (e) {
          console.warn("[PC] self-hosted box unavailable — falling back to ElevenLabs", e);
          emit("fallback", { from: "selfhosted", to: "elevenlabs",
                             reason: String((e && e.message) || e) });
          setBubbleLine("Reconnecting…");
          STATE.conversation = await startElevenLabs(startOpts, resume);
          STATE.activeBackend = "elevenlabs-fallback";
        }
      } else {
        // ── ElevenLabs path (primary when data-backend=elevenlabs) ──
        STATE.conversation = await startElevenLabs(startOpts, resume, session.signedUrl);
        STATE.activeBackend = "elevenlabs";
      }
      console.log("[PC] session started");
      // Un-suspend the SDK's freshly-created OUTPUT AudioContext. On a fast
      // (warm) load this resolves inside the click's activation and the
      // greeting plays immediately; on a cold load the context was born
      // suspended, so resume it now (sticky activation from the start click
      // permits it) and again shortly after in case the context appears late.
      resumeAudio();
      setTimeout(resumeAudio, 250);
      setTimeout(resumeAudio, 1000);
      // HARD-WON RULE 2: release the start-guard now that the session is
      // established (onConnect may have already fired and flipped
      // isCallActive=true, which makes toggleCall route to endCall anyway —
      // but clearing `starting` keeps the two flags in sync).
      STATE.starting = false;
    } catch (err) {
      const text = (err && err.message) || String(err) || "Failed to start session";
      console.error("[PC] start failed", err);
      setError(text);
      setLive(false);
      // HARD-WON RULE 2: ALWAYS clear the start-guard on failure or the
      // sprite locks into "Connecting…" forever and no further clicks work.
      STATE.starting = false;
    }
  }

  async function endCall() {
    // HARD-WON RULE 4: reset reconnectAttempts up front so the next startCall
    // begins with a clean budget. Otherwise after one bad call the budget is
    // already exhausted on the next attempt.
    STATE.reconnectAttempts = 0;
    // HARD-WON RULE 2: clear the start-guard if endCall fires while a
    // startCall is still mid-await — keeps the two flags in sync.
    STATE.starting = false;
    // HARD-WON RULE 5: cancel a pending navigate_to setTimeout AND wipe the
    // resume sentinel so the next page doesn't auto-reconnect against the
    // user's intent.
    if (STATE.pendingNavTimer) {
      clearTimeout(STATE.pendingNavTimer);
      STATE.pendingNavTimer = null;
    }
    try { sessionStorage.removeItem(STORAGE_KEY_RESUME); } catch (_) {}
    try {
      if (STATE.conversation && typeof STATE.conversation.endSession === "function") {
        await STATE.conversation.endSession();
      }
    } catch (_) { /* swallow already-closing */ }
    stopMicMeterPolling();
    setLive(false);
    STATE.conversation = null;
    // HARD-WON RULE 4: emit "end" directly here — if endSession() throws or
    // the SDK's onDisconnect callback doesn't fire synchronously, host
    // listeners get desynced from STATE.isCallActive=false. Emitting again
    // from onDisconnect is harmless (idempotent listeners).
    emit("end");
  }

  // ── Mic-meter polling (10Hz while call active) ────────────────────────────
  function startMicMeterPolling() {
    stopMicMeterPolling();
    let peak = 0, sum = 0, samples = 0, lastLog = Date.now();
    STATE.micMeterTimer = setInterval(function () {
      try {
        const conv = STATE.conversation;
        if (!conv || !conv.getInputByteFrequencyData) return;
        const data = conv.getInputByteFrequencyData();
        if (!data || data.length === 0) { setMicLevel(0); return; }
        let s = 0;
        for (let i = 0; i < data.length; i++) s += data[i];
        const avg = s / data.length / 255;
        const level = Math.min(1, Math.pow(avg, 0.7) * 1.4);
        setMicLevel(level);
        peak = Math.max(peak, level); sum += level; samples += 1;
        const now = Date.now();
        if (now - lastLog >= 1000) {
          const a = samples > 0 ? sum / samples : 0;
          console.log("[PC] mic level — peak=" + peak.toFixed(2) +
                      " avg=" + a.toFixed(2) +
                      (peak < 0.01 ? "  ⚠️ SDK is hearing SILENCE — wrong device?" : ""));
          peak = 0; sum = 0; samples = 0; lastLog = now;
        }
      } catch (e) {
        console.debug("[PC] mic meter read failed", e);
      }
    }, 100);
  }
  function stopMicMeterPolling() {
    if (STATE.micMeterTimer) clearInterval(STATE.micMeterTimer);
    STATE.micMeterTimer = null;
    setMicLevel(0);
  }

  // ── Route-change listener (Rule 11) ───────────────────────────────────────
  // Patch history.pushState + listen popstate so SPA navigations fire a
  // contextual update. Full-page nav reloads embed.js anyway so /connect
  // re-sends the new page.
  (function patchHistory() {
    // HARD-WON RULE 6: SPA routers (Next.js App Router, React Router v6) use
    // BOTH pushState AND replaceState for navigation/query updates. Patching
    // only pushState means half the SPA route changes don't fire a
    // contextualUpdate and the agent gets confused about which page the user
    // is on. Wrap both with the same wrapper.
    const origPush = history.pushState;
    history.pushState = function () {
      const ret = origPush.apply(this, arguments);
      onRouteChange();
      return ret;
    };
    const origReplace = history.replaceState;
    history.replaceState = function () {
      const ret = origReplace.apply(this, arguments);
      onRouteChange();
      return ret;
    };
    window.addEventListener("popstate", onRouteChange);
  })();
  let lastSentCtx = null;
  function onRouteChange() {
    if (!STATE.isCallActive) return;
    const ctx = buildPageContext();
    if (lastSentCtx === ctx.summary) return;
    lastSentCtx = ctx.summary;
    try {
      STATE.conversation && STATE.conversation.sendContextualUpdate &&
        STATE.conversation.sendContextualUpdate(ctx.contextualUpdate);
      console.log("[PC] contextualUpdate (route change) →", ctx.contextualUpdate);
    } catch (e) {
      console.debug("[PC] route-change contextualUpdate failed", e);
    }
  }

  // ── Event emitter ─────────────────────────────────────────────────────────
  function emit(name, payload) {
    const list = STATE.listeners[name] || [];
    for (let i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (_) {}
    }
  }
  function on(name, cb) {
    if (!STATE.listeners[name]) STATE.listeners[name] = [];
    STATE.listeners[name].push(cb);
    return function off() {
      STATE.listeners[name] = STATE.listeners[name].filter(function (x) { return x !== cb; });
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────
  // Play one of the four directional body-pointing poses, then settle back to
  // idle. Host sites call window.PetConcierge.point("left"|"right"|"up"|"down")
  // to have the pet gesture toward something on the page.
  function pointDirection(direction) {
    var dir = String(direction || "").toLowerCase().trim();
    var ALLOWED = { left: 1, right: 1, up: 1, down: 1 };
    if (!ALLOWED[dir]) {
      console.warn('[PC] point(): direction must be "left", "right", "up" or "down"');
      return;
    }
    var rowId = "pointing-" + dir;
    try {
      setSpriteRow(UI.spriteImg, rowId);
      // Hold the gesture ~2.2s, then return to idle — but only if nothing else
      // (a live call, a drag, another row) took over in the meantime.
      window.setTimeout(function () {
        if (!STATE.isCallActive && STATE.currentRowId === rowId) {
          setSpriteRow(UI.spriteImg, "idle");
        }
      }, 2200);
    } catch (e) { console.debug("[PC] point() error", e); }
  }

  window.PetConcierge = {
    version: VERSION,
    config: CONFIG,
    start: startCall,
    end: endCall,
    point: pointDirection,
    on: on,
    off: function (name, cb) {
      STATE.listeners[name] = (STATE.listeners[name] || []).filter(function (x) { return x !== cb; });
    },
    get isActive() { return STATE.isCallActive; },
    get inputLevel() { return STATE.inputLevel; },
    get error() { return STATE.error; },
    // ADDITIVE (Builder rail): let a host UI send a TEXT turn (type-to-chat).
    // ElevenLabs path uses the Conversation's user_message frames. On the
    // self-hosted backend STATE.conversation has no sendUserMessage yet, so this
    // no-ops there until the RTVI text-turn bridge lands (layer 2).
    sendText: function (t) {
      var text = String(t == null ? "" : t).trim();
      if (!text) return false;
      var c = STATE.conversation;
      if (!c || typeof c.sendUserMessage !== "function") return false;
      try { c.sendUserActivity && c.sendUserActivity(); } catch (e) {}
      try { c.sendUserMessage(text); return true; }
      catch (e) { console.error("[PC] sendText failed", e); return false; }
    },
    // Notify the agent the user is typing (suppresses agent interruption).
    sendActivity: function () {
      var c = STATE.conversation;
      try { c && c.sendUserActivity && c.sendUserActivity(); } catch (e) {}
    },
    // True once a live session exists (host UIs gate the composer on this).
    isReady: function () { return !!STATE.conversation; },
    // Fire a named choreography directly — the SAME entry point the agent's
    // run_choreography client tool uses. Handy for manual/console testing and
    // section-by-section tour work without a live voice session, e.g.
    //   PetConcierge.runChoreography("tour:hero")
    runChoreography: function (name) {
      try { return TOOLS.run_choreography({ name: String(name || "") }); }
      catch (e) { console.error("[PC] runChoreography failed", e); return String(e); }
    },
  };

  // ── Resume-after-navigation ───────────────────────────────────────────────
  // Static-HTML sites do a full document reload on every navigate_to, which
  // destroys the WebSocket + audio context + mic stream. We bridge that gap
  // via sessionStorage: navigate_to writes a sentinel, the new page reads it
  // here on boot, re-starts the call, then tells the agent the page changed
  // so it picks up the conversation instead of greeting from scratch.
  function tryResumeCall() {
    let data;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_RESUME);
      if (!raw) return;
      sessionStorage.removeItem(STORAGE_KEY_RESUME);
      data = JSON.parse(raw);
    } catch (_) { return; }
    if (!data || typeof data !== "object") return;
    const age = Date.now() - (data.when || 0);
    if (age > RESUME_TTL_MS) {
      console.log("[PC] stale resume sentinel (" + age + "ms old) — ignoring");
      return;
    }
    if (data.token && data.token !== CONFIG.token) {
      console.log("[PC] resume sentinel from a different agent — ignoring");
      return;
    }
    console.log("[PC] resume sentinel found — reconnecting after navigation from " +
                data.from + " to " + location.pathname);
    // Tiny delay so buildDom() + the host-site's own sprite UI are wired
    // before we flip into the live-call state. Pass resume=true so the
    // agent's first_message is suppressed (no "Hey I'm Jack…" re-greet).
    setTimeout(function () {
      const resumed = startCall(true);
      Promise.resolve(resumed).then(function () {
        // Once reconnected, tell the agent EXACTLY what happened. The
        // first_message override killed the cold-start greeting; this
        // contextual update tells the agent to briefly acknowledge the
        // new page and stay in the conversation thread.
        try {
          if (STATE.conversation && typeof STATE.conversation.sendContextualUpdate === "function") {
            const label = labelForPath(location.pathname);
            // HARD-WON RULE 8: `data.to` is undefined on legacy sentinels —
            // guard so the agent doesn't read "undefined" aloud.
            const destPhrase = data.to
              ? "You previously told the user you'd take them to " + data.to + " and they are now viewing"
              : "The user is now viewing";
            const msg = "[NAVIGATION RESUME] The page just finished loading. " +
                       destPhrase + " \"" + label + "\" " +
                       "(route " + location.pathname + ", title \"" + (document.title || label) + "\") " +
                       "on " + location.hostname + ". " +
                       "You are MID-CONVERSATION with this same user — DO NOT introduce yourself, " +
                       "DO NOT say \"Hey I'm Jack\", DO NOT ask if they want a tour. " +
                       "Just briefly acknowledge in ONE short sentence that you've arrived on " + label + " " +
                       "and continue helping them. Example tone: \"Alright, here we are on " + label + " — " +
                       "want me to walk you through it?\" Keep it natural and short." +
                       memoryContextString();
            STATE.conversation.sendContextualUpdate(msg);
            console.log("[PC] contextualUpdate (resume) →", msg);
          }
        } catch (e) {
          console.debug("[PC] resume contextualUpdate failed", e);
        }
      }).catch(function (err) {
        console.warn("[PC] auto-resume failed", err);
      });
    }, 350);
  }

  // ── Self-test hook (?choreotest=1) ────────────────────────────────────────
  // Smoke-test run_choreography WITHOUT the agent. Gated behind a query flag so
  // it never runs on production page loads. Seeds a tiny 2-beat dummy tour that
  // points at the first [data-pc] landmark on the page (or, if none, a visible
  // <h1>/<body> fallback), runs the tour, and logs PASS/FAIL plus the narration
  // string the agent would have spoken. Visit  <page>?choreotest=1  and watch
  // the console. Mirrors the file's other opt-in flags (driven off the URL).
  function hasQueryFlag(name) {
    try {
      const q = location.search || "";
      // matches ?name=1 or &name=1 (and bare ?name / &name)
      return new RegExp("[?&]" + name + "(=1|=true)?(?:&|$)").test(q);
    } catch (_) { return false; }
  }
  function runChoreoSelfTest() {
    try {
      // Pick a target: prefer a real data-pc landmark, else any visible element.
      let probe = document.querySelector("[data-pc]");
      let probeTarget;
      if (probe) {
        probeTarget = "pc:" + probe.getAttribute("data-pc");
      } else {
        probe = document.querySelector("h1, h2, main, body");
        // No data-pc landmark on this page — fall back to a heading's text so
        // findElement's fuzzy chain resolves it (the test still exercises the
        // tour timeline + narration join + abort plumbing).
        probeTarget = probe && probe.textContent
          ? "pc:" + probe.textContent.trim().slice(0, 24)
          : "pc:body";
      }
      console.log("[PC][choreotest] using probe target:", probeTarget, probe || "(none)");

      // Seed a dummy 2-beat tour (does not clobber a real map if one exists —
      // we only add our test key).
      window.__PetConciergeChoreo = window.__PetConciergeChoreo || {};
      window.__PetConciergeChoreo["tour:__selftest"] = {
        mode: "tour",
        title: "Self-test",
        barge_in: "abort",
        beats: [
          { say: "First, here's the top of the page.", do: "scrollTo",  target: probeTarget, hold_ms: 1200 },
          { say: "And here's the same spot highlighted.", do: "highlight", target: probeTarget, hold_ms: 1500 },
        ],
      };

      const result = TOOLS.run_choreography({ name: "tour:__selftest" });
      let parsed = null;
      try { parsed = JSON.parse(result); } catch (_) {}
      const pass = !!(parsed && parsed.ok === true && typeof parsed.narrate === "string" && parsed.narrate.length > 0);
      console.log("[PC][choreotest] " + (pass ? "PASS ✅" : "FAIL ❌") + " — result:", result);
      console.log("[PC][choreotest] narration the agent would speak:", parsed && parsed.narrate);
      console.log("[PC][choreotest] choreoActive=" + STATE.choreoActive + " timers=" + (STATE.choreoTimers ? STATE.choreoTimers.length : 0));

      // Also prove the missing-name path returns a clean string (no throw).
      const missing = TOOLS.run_choreography({ name: "tour:does-not-exist" });
      const missingOk = typeof missing === "string" && missing.indexOf("No choreography named") === 0;
      console.log("[PC][choreotest] missing-name " + (missingOk ? "PASS ✅" : "FAIL ❌") + " — \"" + missing + "\"");

      // Prove barge-in: aborting clears the timeline.
      setTimeout(function () {
        abortChoreo();
        const cleared = !STATE.choreoActive && (!STATE.choreoTimers || STATE.choreoTimers.length === 0) && !STATE.choreoRing;
        console.log("[PC][choreotest] barge-in abort " + (cleared ? "PASS ✅" : "FAIL ❌"));
      }, 300);
    } catch (e) {
      console.error("[PC][choreotest] FAIL ❌ — threw:", e);
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
      return;
    }
    injectStyles();
    // Re-apply a previously-chosen text size BEFORE building the UI so the
    // visitor's accessibility preference survives navigation seamlessly.
    var savedScale = loadTextScale();
    if (savedScale !== 1.0) { try { applyTextScale(savedScale); } catch (_) {} }
    else { textScale = 1.0; }
    buildDom();
    startDiscovery(); // warm the sitemap+nav cache so available_pages is ready by first click
    console.log("[PC] embed.js " + VERSION + " loaded — endpoint=" + CONFIG.endpoint +
                ", autostart=" + CONFIG.autostart);
    if (!CONFIG.autostart) {
      console.log("[PC] autostart disabled — call window.PetConcierge.start() to begin.");
    }
    // Resume an in-progress call IF navigate_to wrote a sentinel on the
    // previous page. Static sites need this; SPA hosts that wire
    // window.__PetConciergeNavigate skip writing the sentinel because their
    // pushState navigation never tears down the JS context in the first place.
    tryResumeCall();
    // Onboarding memory capture. A single delegated listener records every
    // onboarding detail the moment it lands in a field — whether the visitor
    // typed it OR the agent filled it via type_text (which dispatches real
    // input/change events). Persisted to sessionStorage so it survives the
    // full-document reload a static site forces on navigate_to, then replayed
    // into the next connect's contextualUpdate (see memoryContextString).
    var captureSlot = function (e) {
      try {
        var slot = onboardingSlotForElement(e && e.target);
        if (slot) saveSlot(slot, e.target.value);
      } catch (_) {}
    };
    document.addEventListener("input", captureSlot, true);
    document.addEventListener("change", captureSlot, true);
    // Character choice — capture when a picker card carrying data-pet is
    // clicked (covers both a human click and the agent's click_element, which
    // dispatches a real click). Harmless on pages with no such cards.
    document.addEventListener("click", function (e) {
      try {
        var t = e && e.target;
        var card = t && t.closest ? t.closest("[data-pet]") : null;
        var pet = card && card.getAttribute("data-pet");
        if (pet) saveSlot("character", pet);
      } catch (_) {}
    }, true);
    // Opt-in choreography smoke test — runs only with ?choreotest=1 in the URL.
    if (hasQueryFlag("choreotest")) {
      console.log("[PC] ?choreotest=1 detected — running run_choreography self-test");
      setTimeout(runChoreoSelfTest, 400); // let the DOM settle first
    }
  }
  boot();
})();
