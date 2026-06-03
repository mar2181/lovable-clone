// SpaceMario — one-call mount for any site. Builds the DOM, loads the manifest, wires the player +
// engagement behavior (+ spatial tools if hermes-spatial.js is present), and applies a config.
//   SpaceMario.mount({ base:"https://.../", corner:"br", size:200, entrance:"random",
//                      personality:"normal", speed:1 })
(function () {
  const PERSONALITY = {
    calm: { idleCalmMs: 120000, idlePlayMs: 600000 },   // rarely performs
    normal: { idleCalmMs: 60000, idlePlayMs: 300000 },  // plays after 1m, sleeps after 5m
    hyper: { idleCalmMs: 15000, idlePlayMs: 90000 },    // performs often
    demo: { idleCalmMs: 4000, idlePlayMs: 22000 },      // for testing
  };

  function ensureManifest(base, cb) {
    if (window.HERMES_MANIFEST) return cb();
    const s = document.createElement("script");
    s.src = base + "manifest.js"; s.onload = cb;
    s.onerror = () => console.error("SpaceMario: failed to load manifest.js from " + base);
    document.head.appendChild(s);
  }

  const SpaceMario = {
    mount(cfg) {
      cfg = cfg || {};
      const base = cfg.base || "";
      const size = cfg.size || 200;
      const host = cfg.mountTo || document.body;
      const el = document.createElement("div");
      el.className = "space-mario-host";
      el.style.cssText = `position:fixed;z-index:${cfg.z || 2147483000};width:${size}px;height:${size}px;left:0;top:0;cursor:pointer;will-change:left,top`;
      const cv = document.createElement("canvas");
      cv.width = size; cv.height = size; cv.style.cssText = "width:100%;height:100%;display:block";
      el.appendChild(cv); host.appendChild(el);
      const inst = { el, config: cfg };
      ensureManifest(base, () => {
        const P = new window.HermesPlayer(cv, window.HERMES_MANIFEST, base);
        P.setSpeed(cfg.speed || 1);
        const pers = PERSONALITY[cfg.personality || "normal"] || PERSONALITY.normal;
        const B = new window.HermesBehavior(P, el, {
          corner: cfg.corner || "br",
          entrance: cfg.entrance || "random",
          idleCalmMs: cfg.idleCalmMs || pers.idleCalmMs,
          idlePlayMs: cfg.idlePlayMs || pers.idlePlayMs,
          speed: cfg.speed,
          onState: cfg.onState,
          onClick: cfg.onClick,
        });
        inst.player = P; inst.behavior = B;
        if (cfg.onReady) cfg.onReady(inst);
      });
      return inst;
    },
    unmount(inst) {
      if (!inst) return;
      if (inst.behavior && inst.behavior._loop) clearInterval(inst.behavior._loop);
      if (inst.behavior && inst.behavior._ring && inst.behavior._ring.parentNode) inst.behavior._ring.parentNode.removeChild(inst.behavior._ring);
      if (inst.el && inst.el.parentNode) inst.el.parentNode.removeChild(inst.el);
    },
  };
  window.SpaceMario = SpaceMario;
})();
