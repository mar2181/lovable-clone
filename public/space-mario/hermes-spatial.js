// HermesSpatial — page-aware navigation + tour tools (extends HermesBehavior).
// Reads real geometry from data-pc landmarks (or any selector) and chooses how to reach a target:
// walk/run across, JET UP if it's high, LEAP/hop onto things — then land + point + spotlight.
// Tools: goPointAt, goTo, jumpTo, lookAt, tour.  All two-phase friendly (fire-and-forget).
(function () {
  const B = window.HermesBehavior.prototype;
  const ease = (k) => k * k * (3 - 2 * k);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  B.resolveTarget = function (q) {
    if (q && q.nodeType) return q;
    return document.querySelector('[data-pc="' + q + '"]') || (function () { try { return document.querySelector(q); } catch (e) { return null; } })();
  };

  // where to STAND to point at an element: beside it, torso aligned, facing it
  B._anchorFor = function (rect) {
    const bw = this.el.offsetWidth, bh = this.el.offsetHeight, gap = 6;
    const onLeftHalf = rect.left + rect.width / 2 < window.innerWidth / 2;
    const tx = onLeftHalf ? rect.right + gap : rect.left - bw - gap;
    const ty = rect.top + rect.height / 2 - bh * 0.55;
    return { tx: clamp(tx, 6, window.innerWidth - bw - 6), ty: clamp(ty, 6, window.innerHeight - bh - 6), faceDir: onLeftHalf ? -1 : 1 };
  };

  B._animateTo = function (tx, ty, move, facing, dur) {
    return new Promise((res) => {
      const sx = this.x, sy = this.y, t0 = performance.now();
      this.p.play(move, { facing });
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        this.x = sx + (tx - sx) * ease(k); this.y = sy + (ty - sy) * ease(k); this._place();
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  };

  // parabolic hop to a point (used by jumpTo / leaping between landmarks)
  B._arcTo = function (tx, ty, move, dur, lift) {
    return new Promise((res) => {
      const sx = this.x, sy = this.y, t0 = performance.now(), L = lift || 150;
      this.p.play(move, { facing: tx < sx ? -1 : 1 });
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        this.x = sx + (tx - sx) * k;
        this.y = sy + (ty - sy) * k - 4 * L * k * (1 - k); // parabola
        this._place();
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  };

  // ---- THE canonical L-shaped move: NEVER diagonal. ------------------------------------------
  // Horizontal legs stay perfectly level; vertical legs fire the ROCKETS (jet) straight up or
  // straight down — rockets ALWAYS come out when he changes altitude, both directions.
  //   ASCENDING : move across at the start altitude, THEN rise straight up.
  //   DESCENDING: drop straight down IN PLACE first, THEN move across at the lower altitude
  //               (so the walk happens on/near the floor, never mid-air).
  // On/near the floor a horizontal leg WALKS (or runs if far); high up it CRUISES (flyforward,
  // head-first) — but always dead level, so it never reads as an "angular" diagonal rocket.
  B._goL = async function (tx, ty, faceDir) {
    const fromX = this.x, fromY = this.y;
    const dx = tx - fromX, dy = ty - fromY;
    const horiz = Math.abs(dx), vert = Math.abs(dy);
    const floorY = this._dockY();
    faceDir = faceDir || (dx < 0 ? -1 : 1);
    const hMoveAt = (y) => (y < floorY - 36 ? "flyforward" : (horiz > 360 ? "run" : "walk"));
    const hDur = this._dur(clamp(horiz * 1.8, 700, 2400));
    const vDur = this._dur(clamp(vert * 3.0, 760, 2000));
    const moveH = (gx, gy) => this._animateTo(gx, gy, hMoveAt(gy), gx < this.x ? -1 : 1, hDur);
    const moveV = (gx, gy) => this._animateTo(gx, gy, "jet", faceDir, vDur);
    if (dy < 0) {
      // ASCENDING — cross over level, then ROCKET straight up at the target column.
      if (horiz > 16) await moveH(tx, fromY);
      if (vert > 14) { await moveV(tx, ty); this.p.play("hover", { facing: faceDir }); await wait(160); }
    } else {
      // DESCENDING / level — ROCKET straight down in place, then cross over level at the bottom.
      if (vert > 14) { await moveV(fromX, ty); this.p.play("hover", { facing: faceDir }); await wait(140); }
      if (horiz > 16) await moveH(tx, ty);
    }
  };

  // core traversal: route from current spot to beside the target — always L-shaped, never diagonal.
  B._routeTo = async function (a, fromX, fromY) {
    await this._goL(a.tx, a.ty, a.faceDir);
  };

  // visit + point + spotlight, WITHOUT returning to dock (tour-friendly)
  B._visit = async function (q, hold, moved) {
    const el = this.resolveTarget(q); if (!el) return false;
    const a = this._anchorFor(el.getBoundingClientRect());
    await this._routeTo(a, this.x, this.y);
    this.p.setFacing(a.faceDir);
    this.p.play(moved ? "point" : "turnpoint", { restart: true, facing: a.faceDir });
    this.spotlight(el, true);
    await wait(hold || 2400);
    this.spotlight(el, false);
    return true;
  };

  // ---- public tools ----
  B.goPointAt = async function (q, opts) {
    opts = opts || {}; clearTimeout(this._rt); this.busy = true; this.last = performance.now();
    const moved = !!this.resolveTarget(q);
    await this._visit(q, opts.hold || 2600, true);
    this.busy = false;
    if (!opts.stay) this._returnToDock();
    return moved;
  };

  B.goTo = async function (q) {
    const el = this.resolveTarget(q); if (!el) return false;
    this.busy = true; this.last = performance.now();
    const a = this._anchorFor(el.getBoundingClientRect());
    await this._routeTo(a, this.x, this.y); this.p.play("idle"); this.busy = false; return true;
  };

  // hop ONTO an element (land on its top edge) — leaps, chaining hops if far
  B.jumpTo = async function (q, opts) {
    opts = opts || {}; const el = this.resolveTarget(q); if (!el) return false;
    clearTimeout(this._rt); this.busy = true; this.last = performance.now();
    const bw = this.el.offsetWidth, bh = this.el.offsetHeight, r = el.getBoundingClientRect();
    const tx = clamp(r.left + r.width / 2 - bw / 2, 6, window.innerWidth - bw - 6);
    const ty = clamp(r.top - bh * 0.74, 6, window.innerHeight - bh - 6); // perch on top edge
    const dist = Math.hypot(tx - this.x, ty - this.y), hops = dist > 460 ? 2 : 1;
    for (let i = 1; i <= hops; i++) {
      const hx = this.x + (tx - this.x) / (hops - i + 1), hy = this.y + (ty - this.y) / (hops - i + 1);
      await this._arcTo(hx, hy, "leap", this._dur(1100), 160);
    }
    this.p.play("idle"); this.busy = false;
    if (opts.point) { this.spotlight(el, true); await wait(1800); this.spotlight(el, false); }
    if (!opts.stay) { await wait(opts.hold || 1400); this._returnToDock(); }
    return true;
  };

  // turn toward a target without traveling
  B.lookAt = async function (q, opts) {
    opts = opts || {}; const el = this.resolveTarget(q); if (!el) return false;
    this.last = performance.now(); const r = el.getBoundingClientRect();
    const dir = (r.left + r.width / 2) < (this.x + this.el.offsetWidth / 2) ? -1 : 1;
    this.p.play("turnpoint", { restart: true, facing: dir }); this.spotlight(el, true);
    clearTimeout(this._rt); this._rt = setTimeout(() => { this.spotlight(el, false); if (!opts.stay) this.p.play("idle"); }, opts.hold || 2200);
    return true;
  };

  // ---- THE FLAGSHIP: guided tour (replaces Jack). Visits each stop, points, narrates via onStep. ----
  // steps = [{target, say?, hold?, jump?}]
  B.tour = async function (steps, opts) {
    opts = opts || {}; clearTimeout(this._rt); this.busy = true; this.last = performance.now();
    if (opts.bow !== false) { this.p.play("bow", { restart: true }); await wait(1600); }
    for (const s of steps) {
      this.last = performance.now();
      if (opts.onStep) opts.onStep(s);
      // Full-page tours: scroll the stop into view FIRST, let the smooth scroll
      // settle, THEN fly there + point (so _anchorFor measures the final rect
      // and the body lands next to the thing it's pointing at, on-screen).
      if (opts.scroll) { const _se = this.resolveTarget(s.target); if (_se) { try { _se.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {} await wait(560); } }
      if (s.jump) { await this.jumpTo(s.target, { stay: true }); this.spotlight(this.resolveTarget(s.target), true); await wait(s.hold || 2400); this.spotlight(this.resolveTarget(s.target), false); }
      else await this._visit(s.target, s.hold || 2400, true);
    }
    if (opts.onStep) opts.onStep(null);
    if (opts.finale !== false) { await this._returnToDockP(); this.p.play("wave", { restart: true }); await wait(1400); }
    this.busy = false; this.p.play("idle");
    return true;
  };

  // promise version of return-to-dock (for chaining at tour end) — L-shaped: rocket straight
  // down, then walk along the floor to the corner. Never the old diagonal flyforward.
  B._returnToDockP = async function () {
    const tx = this._dockX(), ty = this._dockY();
    const faceDir = tx > (window.innerWidth / 2) ? -1 : 1;
    await this._goL(tx, ty, faceDir);
    this.p.play("idle", { facing: faceDir });
  };

  // tracking spotlight ring
  B.spotlight = function (el, on) {
    if (!this._ring) {
      const r = document.createElement("div");
      r.style.cssText = "position:fixed;z-index:3;pointer-events:none;border:2px solid #ffb86c;border-radius:14px;box-shadow:0 0 0 3px #ffb86c33,0 0 26px 6px #ffb86c55;transition:opacity .25s;opacity:0;will-change:left,top,width,height";
      document.body.appendChild(r); this._ring = r;
    }
    const ring = this._ring;
    if (!on || !el) { ring.style.opacity = "0"; this._ringEl = null; return; }
    this._ringEl = el; ring.style.opacity = "1";
    const track = () => { if (this._ringEl !== el) return; const b = el.getBoundingClientRect(); ring.style.left = (b.left - 6) + "px"; ring.style.top = (b.top - 6) + "px"; ring.style.width = (b.width + 12) + "px"; ring.style.height = (b.height + 12) + "px"; requestAnimationFrame(track); };
    track();
  };
})();
