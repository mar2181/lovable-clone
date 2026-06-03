// HermesPlayer — frame-sequence sprite player. Vanilla JS, no deps.
// Draws a move's WebP sprite-sheet frame-by-frame onto a <canvas>. Lazy-loads sheets.
(function () {
  class HermesPlayer {
    constructor(canvas, manifest, base) {
      this.c = canvas; this.ctx = canvas.getContext("2d");
      this.m = manifest; this.base = base || "";
      this.cell = manifest.cell; this.cache = {};
      this.cur = null; this.i = 0; this.dir = 1; this.acc = 0;
      this.facing = 1; this.done = false; this.onEnd = null; this._last = 0;
      this.speedMult = 1;
      requestAnimationFrame(this._tick.bind(this));
    }
    has(move) { return !!this.m.moves[move]; }
    ensure(move) {
      const md = this.m.moves[move]; if (!md) return null;
      let e = this.cache[move];
      if (!e) { e = { img: new Image(), loaded: false, md }; e.img.onload = () => (e.loaded = true); e.img.src = this.base + md.file; this.cache[move] = e; }
      return e;
    }
    preload(list) { (list || []).forEach((mv) => this.ensure(mv)); }
    play(move, opts) {
      opts = opts || {}; if (!this.m.moves[move]) return;
      this.ensure(move);
      if (this.cur !== move || opts.restart) { this.cur = move; this.i = 0; this.dir = 1; this.acc = 0; this.done = false; }
      if (opts.facing !== undefined) this.facing = opts.facing < 0 ? -1 : 1;
      this.onEnd = opts.onEnd || null;
    }
    setFacing(f) { this.facing = f < 0 ? -1 : 1; }
    setSpeed(m) { this.speedMult = m && m > 0 ? m : 1; }
    durationMs(move) { const md = this.m.moves[move]; if (!md) return 1200; let base = (md.frames / md.fps) * 1000; if (md.loop === "boom") base *= 2; return base / this.speedMult; }
    _tick(t) {
      const dt = this._last ? (t - this._last) / 1000 : 0; this._last = t;
      const e = this.cur && this.cache[this.cur];
      if (e && e.loaded) {
        const md = e.md;
        if (!this.done) { this.acc += dt; const spf = 1 / (md.fps * this.speedMult); let guard = 0; while (this.acc >= spf && guard++ < 8) { this.acc -= spf; this._adv(md); } }
        this._draw(e, md);
        // Weightless bob: gentle vertical drift while floating/hovering so zero-g actually reads as zero-g.
        const sp = (this.cur === "float" || this.cur === "hover");
        if (sp) this.c.style.transform = "translateY(" + (Math.sin(t / 1100) * 6).toFixed(2) + "px)";
        else if (this._bobbing) this.c.style.transform = "";
        this._bobbing = sp;
      }
      requestAnimationFrame(this._tick.bind(this));
    }
    _adv(md) {
      const n = md.frames;
      if (md.loop === "loop") this.i = (this.i + 1) % n;
      else if (md.loop === "once") { if (this.i < n - 1) this.i++; else if (!this.done) { this.done = true; this.onEnd && this.onEnd(); } }
      else { this.i += this.dir; if (this.i >= n - 1) { this.i = n - 1; this.dir = -1; } else if (this.i <= 0) { this.i = 0; this.dir = 1; } }
    }
    _blit(img, idx, md, alpha) {
      const ctx = this.ctx, W = this.c.width, H = this.c.height, s = this.cell;
      const col = idx % md.cols, row = Math.floor(idx / md.cols);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (this.facing < 0) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, col * s, row * s, s, s, 0, 0, W, H);
      ctx.restore();
    }
    _draw(e, md) {
      const ctx = this.ctx, W = this.c.width, H = this.c.height;
      ctx.clearRect(0, 0, W, H);
      const n = md.frames, b = md.blend | 0;
      // For a forward loop whose last frame doesn't perfectly meet frame 0 (e.g. the 360 float
      // tumble), crossfade the tail into frame 0 over the last `b` frames so it loops with no pop.
      if (md.loop === "loop" && b > 0 && this.i >= n - b) {
        const a = (this.i - (n - b) + 1) / b; // 0..1 across the last b frames
        this._blit(e.img, this.i, md, 1);
        this._blit(e.img, 0, md, a);
      } else {
        this._blit(e.img, this.i, md, 1);
      }
    }
  }
  window.HermesPlayer = HermesPlayer;
})();
