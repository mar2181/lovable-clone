// HermesBehavior — engagement-aware state machine + idle play + reactions + movement.
// States: ENTER -> ENGAGED (docked, quiet) <-> IDLE-PLAY (does his thing) -> SLEEP. Any input -> back to dock.
// `speed` (0.3..1.5) scales BOTH frame playback AND movement durations, so lower = genuinely slower everywhere.
(function () {
  const ANTICS = ["float", "hover", "moonwalk", "dance", "backflip", "stretch", "lookaround", "celebrate"];
  const FLOATS = ["float", "float2", "float4"]; // distinct zero-g drifts: orig drift, one-knee tumble, slow 360 spin
  const rand = (a) => a[Math.floor(Math.random() * a.length)];
  const ease = (k) => k * k * (3 - 2 * k); // smoothstep: eases out (decelerates) into the landing
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  class HermesBehavior {
    constructor(player, el, opts) {
      this.p = player; this.el = el; opts = opts || {};
      this.onState = opts.onState || function () {};
      this.onClick = opts.onClick || null;
      this.entranceStyle = opts.entrance || "random";
      this.corner = opts.corner || "br"; // br|bl|tr|tl
      this.fast = opts.fast !== false; this._setTimings();
      if (opts.idleCalmMs) this.tCalm = opts.idleCalmMs;
      if (opts.idlePlayMs) this.tPlay = opts.idlePlayMs;
      this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
      if (this.p.setSpeed) this.p.setSpeed(this.speed);
      this.state = "enter"; this.last = performance.now(); this.busy = false;
      this.lastAntic = ""; this.nextAnticAt = 0;
      this.x = this._dockX(); this.y = this._dockY(); this._place();
      this.p.preload(["idle", "wave", "run", "walk", "jet", "hover", "flyforward"]);
      this._bind();
      this._enter();
      this._loop = setInterval(this._update.bind(this), 350);
      window.addEventListener("resize", () => { if (this.state === "engaged") { this.x = this._dockX(); this.y = this._dockY(); this._place(); } });
    }
    _setTimings() { if (this.fast) { this.tCalm = 4000; this.tPlay = 22000; } else { this.tCalm = 60000; this.tPlay = 300000; } }
    setFast(f) { this.fast = f; this._setTimings(); }
    setSpeed(s) { this.speed = s > 0 ? s : 1; if (this.p.setSpeed) this.p.setSpeed(this.speed); }
    _dur(ms) { return ms / this.speed; } // lower speed => longer (slower) movement
    _dockX() { const m = 28, w = this.el.offsetWidth; return this.corner[1] === "l" ? m : Math.max(12, window.innerWidth - w - m); }
    _dockY() { const h = this.el.offsetHeight; return this.corner[0] === "t" ? 28 : Math.max(12, window.innerHeight - h - 6); } // bottom inset 6px: rest LOW, near the floor
    _place() { this.el.style.left = Math.round(this.x) + "px"; this.el.style.top = Math.round(this.y) + "px"; }
    _bind() {
      const bump = () => this._interact();
      // mousemove intentionally NOT bound: a stray cursor twitch must never yank him out of a
      // zero-g drift mid-move. Real intent (key/scroll/touch/click) still docks him.
      window.addEventListener("keydown", bump);
      window.addEventListener("scroll", bump, { passive: true });
      window.addEventListener("touchstart", bump, { passive: true });
      this.el.addEventListener("click", (e) => { e.stopPropagation(); if (this.onClick) this.onClick(this); else this.react("wave"); });
    }
    _interact() {
      this.last = performance.now();
      if (this.state === "idlePlay" || this.state === "sleep") { this.state = "engaged"; this._returnToDock(); }
    }
    // glide to (tx,ty) over durMs with easing; caller plays the move. mid(k) runs each frame.
    _glide(tx, ty, durMs, mid) {
      return new Promise((res) => {
        const sx = this.x, sy = this.y, t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / durMs), e = ease(k);
          this.x = sx + (tx - sx) * e; this.y = sy + (ty - sy) * e; this._place();
          if (mid) mid(k);
          if (k < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
    }
    // ---- one-shot reaction (wave, celebrate, thumbsup, facepalm, point, etc.) ----
    react(name, opts) {
      if (!this.p.has(name)) return; opts = opts || {};
      this.busy = true; this.p.play(name, { restart: true });
      const dur = Math.min(this._dur(3200), this.p.durationMs(name));
      clearTimeout(this._rt); this._rt = setTimeout(() => { this.busy = false; this._settle(); if (opts.then) opts.then(); }, dur);
    }
    _settle() { const idle = performance.now() - this.last; this.p.play(idle < this.tPlay ? "idle" : "sleep"); }
    // ---- ENTER: cinematic SLOW arrival, then park in the dock + wave ----
    _enter() { this.replayEntrance(this.entranceStyle); }
    // ONE deterministic, premium entrance — always sharp, helmet NEVER clipped:
    //   1. rise straight UP from below the fold at center, rockets firing (jet) — pure vertical,
    //      so the helmet enters last and is fully visible the moment he's on screen;
    //   2. hover-reveal, center stage;
    //   3. travel to the dock the L-shaped way (rocket straight down, then walk to the corner);
    //   4. settle to idle + a wave. No head-first top descent, no diagonal flight.
    async replayEntrance(style) {
      this.busy = true; if (this.spotlight) this.spotlight(null, false);
      const dx = this._dockX(), dy = this._dockY(), bw = this.el.offsetWidth, bh = this.el.offsetHeight;
      const cx = Math.round(window.innerWidth * 0.5 - bw / 2);
      const revealY = Math.max(70, Math.round(window.innerHeight * 0.34)); // well clear of the top edge — helmet never cut
      const faceDir = dx > (window.innerWidth / 2) ? -1 : 1;
      // 1. rise up from below — rockets firing the whole way up.
      this.x = cx; this.y = window.innerHeight + bh; this._place();
      this.p.play("jet", { facing: 1, restart: true });
      await this._glide(cx, revealY, this._dur(2600));
      // 2. hover-reveal.
      this.p.play("hover", { facing: 1 }); await wait(640);
      // 3. to the dock — L-shaped (rocket straight down, then walk along the floor). Never diagonal.
      if (typeof this._goL === "function") await this._goL(dx, dy, faceDir);
      else await this._glide(dx, dy, this._dur(1600));
      // 4. park + greet.
      this.busy = false; this.state = "engaged"; this.last = performance.now();
      this.p.play("idle", { facing: faceDir }); this.react("wave");
    }
    // walk/run from the touch point over to the dock corner ("then he just moves to his place")
    async _toPlace(dx, dy) {
      const dist = Math.abs(dx - this.x);
      if (dist <= 24) return;
      this.p.play(dist > 320 ? "run" : "walk", { facing: dx < this.x ? -1 : 1 });
      await this._glide(dx, dy, this._dur(Math.max(900, dist * 2.0)));
    }
    // ---- travel: move the buddy to (tx,ty), always L-shaped (never diagonal) when the
    // spatial mixin is present; falls back to a straight glide if it isn't. ----
    _travel(tx, ty, move, after) {
      this.busy = true;
      if (typeof this._goL === "function") {
        this._goL(tx, ty).then(() => { this.busy = false; after && after(); });
      } else {
        const far = Math.abs(tx - this.x) > 320;
        this.p.play(move, { facing: tx < this.x ? -1 : 1 });
        this._glide(tx, ty, this._dur(far ? 1800 : 1300)).then(() => { this.busy = false; after && after(); });
      }
    }
    _returnToDock() {
      const tx = this._dockX(), ty = this._dockY();
      const faceDir = tx > (window.innerWidth / 2) ? -1 : 1;
      // L-shaped: rocket straight DOWN, then walk along the floor to the corner. Never the
      // old diagonal flyforward that slid the rockets sideways across the screen.
      if (typeof this._goL === "function") {
        this.busy = true;
        this._goL(tx, ty, faceDir).then(() => { this.busy = false; this.p.play("idle", { facing: faceDir }); });
      } else {
        const mv = Math.abs(tx - this.x) > 300 ? "flyforward" : "walk";
        this._travel(tx, ty, mv, () => this.p.play("idle"));
      }
    }
    // ---- main tick ----
    _update() {
      if (this.busy) return;
      const idle = performance.now() - this.last;
      let st = idle < this.tCalm ? "engaged" : idle < this.tPlay ? "idlePlay" : "sleep";
      if (st !== this.state) { this.state = st; this.onState(st); if (st === "idlePlay") this.nextAnticAt = 0; }
      if (st === "engaged") {
        if (Math.abs(this.x - this._dockX()) > 4 || Math.abs(this.y - this._dockY()) > 4) { this.x = this._dockX(); this.y = this._dockY(); this._place(); }
        if (this.p.cur !== "idle" && this.p.cur !== "lookaround") this.p.play("idle");
        else if (Math.random() < 0.04) this.p.play("lookaround", { restart: true });
      } else if (st === "idlePlay") {
        this._doAntic();
      } else if (st === "sleep") {
        if (this.p.cur !== "sleep") this.p.play("sleep");
      }
    }
    _doAntic() {
      const now = performance.now(); if (now < this.nextAnticAt) return;
      // float/hover are seamless continuous loops now — let them actually PLAY (a real ~15s drift)
      // instead of getting swapped out after one clip length.
      const dwell = (mv) => (FLOATS.includes(mv) || mv === "hover")
        ? this._dur(15000)
        : Math.max(this._dur(3000), this.p.durationMs(mv));
      if (Math.random() < 0.42) {
        const tx = 40 + Math.random() * (window.innerWidth - 320);
        const ty = 80 + Math.random() * (window.innerHeight - 360);
        const mv = Math.abs(tx - this.x) > 340 ? "flyforward" : rand(["walk", "run"]);
        const settle = rand([...FLOATS, "hover"]); // drift on arrival — varies across the 3 distinct zero-g drifts (+ hover)
        this._travel(tx, ty, mv, () => this.p.play(settle));
        this.nextAnticAt = now + this._dur(1800) + dwell(settle);
      } else {
        let mv = rand(ANTICS); if (mv === this.lastAntic) mv = rand(ANTICS);
        if (mv === "float") mv = rand(FLOATS); // in-place drift also varies across the variants
        this.lastAntic = mv;
        this.p.play(mv, { restart: true });
        this.nextAnticAt = now + dwell(mv);
      }
    }
  }
  window.HermesBehavior = HermesBehavior;
})();
