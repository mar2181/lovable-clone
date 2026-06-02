"use client";

// Map Mode controller — see docs/SOP_MAP_MODE.md.
// Numbers EVERY clickable/typeable element: the builder chrome (this parent
// document, numbered here) AND the live preview (inside the Sandpack iframe,
// numbered by the in-iframe script in preview-panel.tsx). One continuous number
// series: chrome takes 1..C, the iframe is told to start at C+1 (previewOffset).
// While map mode is ON it NEVER calls chat/LLM and never speaks — it only
// executes. Exit with "map mode off", the toolbar toggle, Alt+` or Esc.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMapModeStore } from "@/lib/mapmode-store";

/* ───────────────────────── command grammar (pure helpers) ───────────────── */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function wordsToNumber(str: string): number | null {
  const t = str.trim().split(/[\s-]+/);
  if (t.length === 1) {
    if (/^\d+$/.test(t[0])) return parseInt(t[0], 10);
    if (t[0] in UNITS) return UNITS[t[0]];
    if (t[0] in TENS) return TENS[t[0]];
    return null;
  }
  if (t.length === 2 && t[0] in TENS && t[1] in UNITS) return TENS[t[0]] + UNITS[t[1]];
  return null;
}

type Norm =
  | { kind: "enter-map" }
  | { kind: "exit-map" }
  | { kind: "command"; value: string }
  | { kind: "text"; value: string };

function normalize(transcript: string): Norm {
  const raw = transcript.trim().toLowerCase().replace(/[.?!,;:]+$/, "").trim();
  if (/^(map mode|show numbers|show marks|map on|numbers on)$/.test(raw)) return { kind: "enter-map" };
  if (/^(map mode off|map off|stop map mode|exit map mode|hide numbers|numbers off|done map)$/.test(raw))
    return { kind: "exit-map" };

  const n = wordsToNumber(raw);
  if (n !== null) return { kind: "command", value: String(n) };

  const verbs: Record<string, string> = {
    send: "enter", submit: "enter", enter: "enter", return: "enter", go: "enter",
    clear: "clear", delete: "clear", erase: "clear",
    back: "back", tab: "tab", next: "tab", previous: "shift tab",
    top: "top", bottom: "bottom", "scroll down": "scroll down", "scroll up": "scroll up",
    down: "scroll down", up: "scroll up",
  };
  if (raw in verbs) return { kind: "command", value: verbs[raw] };

  const m = raw.match(/^(?:click|press|tap|focus|go to|goto|number)\s+(.+)$/);
  if (m) {
    const k = wordsToNumber(m[1]);
    if (k !== null) return { kind: "command", value: "click " + k };
  }
  return { kind: "text", value: transcript.trim() };
}

/* ──────────────── chrome (parent-document) DOM helpers ───────────────────── */

// Semantic interactive elements (catches inputs/selects/links that may NOT have
// a pointer cursor). Clickable <div>/custom components are caught separately by
// the cursor:pointer scan in collectChrome — React uses synthetic events, so
// styled buttons have no `onclick` attribute, tag, or role to match on.
const SEMANTIC_SEL =
  "a[href],button,summary,input:not([type=hidden]),select,textarea,[contenteditable],[contenteditable=true]," +
  "[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]," +
  "[role=option],[role=checkbox],[role=switch],[role=radio],[tabindex]";

const CLICKABLE_TAGS = new Set(["BUTTON", "A", "SUMMARY"]);
const CLICKABLE_ROLES = new Set([
  "button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "switch", "checkbox", "radio",
]);
function isClickableEl(el: HTMLElement): boolean {
  if (CLICKABLE_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute("role");
  if (role && CLICKABLE_ROLES.has(role)) return true;
  return getComputedStyle(el).cursor === "pointer";
}

function chromeVisible(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 1 || r.height <= 1) return false;
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
  const s = getComputedStyle(el);
  if (s.visibility === "hidden" || s.display === "none" || parseFloat(s.opacity) === 0) return false;
  return true;
}
function chromeTypeable(el: HTMLElement): boolean {
  const t = el.tagName;
  if (t === "TEXTAREA") return true;
  if (t === "SELECT") return false;
  if (t === "INPUT") {
    const ty = ((el as HTMLInputElement).type || "text").toLowerCase();
    return ["text", "search", "email", "url", "tel", "password", "number", "date", "time", ""].includes(ty);
  }
  return el.isContentEditable;
}
function chromeName(el: HTMLElement): string {
  const role = el.getAttribute("role") || el.tagName.toLowerCase();
  const n =
    el.getAttribute("aria-label") ||
    el.getAttribute("placeholder") ||
    (el as HTMLInputElement).value?.slice(0, 20) ||
    (el.textContent || "").trim().slice(0, 24) ||
    "";
  return (role + (n ? ` ${n.trim()}` : "")).slice(0, 60);
}

// Find every clickable thing in the builder chrome: semantic controls PLUS any
// element whose computed cursor is "pointer" (styled <div> buttons). For pointer
// elements we keep only the OUTERMOST of each pointer subtree (cursor inherits),
// which collapses an icon+label button to a single target. Then we drop anything
// nested inside a clickable ancestor so we never double-number one control.
function collectChrome(): HTMLElement[] {
  const set = new Set<HTMLElement>();
  document.querySelectorAll<HTMLElement>(SEMANTIC_SEL).forEach((el) => set.add(el));
  document.body.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (getComputedStyle(el).cursor !== "pointer") return;
    const p = el.parentElement;
    if (p && getComputedStyle(p).cursor === "pointer") return; // not the outermost pointer
    set.add(el);
  });

  let list = Array.from(set).filter(
    (el) =>
      el.tagName !== "IFRAME" &&
      !el.closest("[data-mapmode-ui]") &&
      !el.closest("[data-mapmode-overlay]") &&
      chromeVisible(el),
  );

  const clickable = new Map<HTMLElement, boolean>();
  list.forEach((el) => clickable.set(el, isClickableEl(el)));
  list = list.filter((e) => !list.some((o) => o !== e && clickable.get(o) && o.contains(e)));

  list.sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x = Math.round(ra.top / 24), y = Math.round(rb.top / 24);
    return x !== y ? x - y : ra.left - rb.left;
  });
  return list;
}

// Priority for the most-used controls so they get the LOW numbers regardless of
// where they sit on screen. Mario's rule: Build = #1, Ask = #2, then Cinematic,
// Research, Attach. Everything else keeps reading order after these.
function chromePriority(el: HTMLElement): number {
  const n = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim().toLowerCase();
  if (/^build$/.test(n)) return 0;
  if (/^ask$/.test(n)) return 1;
  if (/^cinematic$/.test(n)) return 2;
  if (/^research$/.test(n)) return 3;
  if (n.includes("attach")) return 4; // the paperclip ("Attach images")
  return 100;
}

function setNativeValueP(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function typeIntoP(el: HTMLElement | null, text: string, append: boolean): boolean {
  if (!el) return false;
  if (el.isContentEditable) {
    el.textContent = append ? `${el.textContent || ""}${el.textContent ? " " : ""}${text}` : text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  if (!chromeTypeable(el)) return false;
  const input = el as HTMLInputElement;
  setNativeValueP(input, append && input.value ? `${input.value} ${text}` : text);
  return true;
}
function pressEnterP(el: HTMLElement | null) {
  const target = el || (document.activeElement as HTMLElement | null);
  if (!target) return;
  const o = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent("keydown", o));
  target.dispatchEvent(new KeyboardEvent("keyup", o));
  const form = (target as HTMLInputElement).form;
  if (form && target.tagName === "INPUT") { try { form.requestSubmit(); } catch { /* no submit */ } }
}

/* minimal SpeechRecognition typing (DOM lib often lacks the webkit prefix) */
type SpeechResults = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
type SpeechLike = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: SpeechResults }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/* ───────────────────────────────── component ────────────────────────────── */

export function MapModeController() {
  const isMapMode = useMapModeStore((s) => s.isMapMode);
  const setMapMode = useMapModeStore((s) => s.setMapMode);
  const marks = useMapModeStore((s) => s.marks);
  const previewOffset = useMapModeStore((s) => s.previewOffset);
  const act = useMapModeStore((s) => s.act);
  const setFocus = useMapModeStore((s) => s.setFocus);
  const dictating = useMapModeStore((s) => s.dictating);
  const focusedNum = useMapModeStore((s) => s.focusedNum);

  const [log, setLog] = useState<string[]>([]);
  const [cmd, setCmd] = useState("");
  const [listening, setListening] = useState(false);
  const [ptt, setPtt] = useState(false);
  const [taskRunning, setTaskRunning] = useState(false);
  const [taskStartAt, setTaskStartAt] = useState<number | null>(null);
  const [taskCount, setTaskCount] = useState(0);
  const [tick, setTick] = useState(0);

  const recRef = useRef<SpeechLike | null>(null);
  const listeningRef = useRef(false);
  const pttRef = useRef(false);
  const speechStartRef = useRef(0);
  const speechEndRef = useRef(0);
  const pendingMetaRef = useRef<{ speakMs?: number; recogMs?: number }>({});
  const taskRef = useRef({ running: false, count: 0, exec: 0, recog: 0, recogN: 0, speak: 0, speakN: 0 });

  // chrome (parent-document) numbering engine — managed via direct DOM, not React
  const chromeOverlayRef = useRef<HTMLDivElement | null>(null);
  const chromeRegRef = useRef<Map<number, HTMLElement>>(new Map());
  const chromeRafRef = useRef(0);
  const chromeRecollectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chromeObserverRef = useRef<MutationObserver | null>(null);
  const focusedElRef = useRef<HTMLElement | null>(null);
  const focusScopeRef = useRef<"chrome" | "preview" | null>(null);

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [line, ...prev].slice(0, 60));
  }, []);

  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const hasSR = mounted &&
    !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  const countAction = useCallback((meta?: { speakMs?: number; recogMs?: number }) => {
    if (!taskRef.current.running) return;
    taskRef.current.count++;
    setTaskCount((c) => c + 1);
    if (meta?.speakMs) { taskRef.current.speak += meta.speakMs; taskRef.current.speakN++; }
    if (meta?.recogMs) { taskRef.current.recog += meta.recogMs; taskRef.current.recogN++; }
  }, []);

  /* ── chrome numbering ──────────────────────────────────────────────────── */
  const renderChrome = useCallback(() => {
    const ov = chromeOverlayRef.current;
    if (!ov) return;
    ov.innerHTML = "";
    chromeRegRef.current.forEach((el, num) => {
      const r = el.getBoundingClientRect();
      const foc = el === focusedElRef.current;
      const chip = document.createElement("div");
      chip.textContent = String(num);
      chip.style.cssText =
        "position:absolute;left:" + Math.max(0, r.left) + "px;top:" + Math.max(0, r.top) +
        "px;transform:translate(-2px,-10px);font:700 11px/1.4 ui-monospace,monospace;padding:1px 5px;" +
        "border-radius:5px;white-space:nowrap;color:#06121f;background:" + (foc ? "#34d399" : "#38bdf8") +
        ";box-shadow:0 1px 3px rgba(0,0,0,.5);border:1px solid rgba(0,0,0,.3);";
      ov.appendChild(chip);
    });
  }, []);

  const numberChrome = useCallback((): number => {
    const list = collectChrome();
    // Stable sort: priority controls (Build=1, Ask=2, …) first, the rest keep
    // collectChrome's reading order.
    list.sort((a, b) => chromePriority(a) - chromePriority(b));
    const reg = chromeRegRef.current;
    reg.clear();
    list.forEach((el, i) => reg.set(i + 1, el));
    return list.length;
  }, []);

  const refreshChrome = useCallback((): number => {
    const c = numberChrome();
    renderChrome();
    useMapModeStore.getState().setPreviewOffset(c);
    return c;
  }, [numberChrome, renderChrome]);

  // Re-collect (catches menus/dropdowns/newly revealed controls), debounced, then
  // tell the preview iframe its new starting offset so numbers stay continuous.
  const scheduleRecollect = useCallback(() => {
    if (chromeRecollectTimerRef.current) clearTimeout(chromeRecollectTimerRef.current);
    chromeRecollectTimerRef.current = setTimeout(() => {
      const c = refreshChrome();
      const send = useMapModeStore.getState()._send;
      if (send) send("mapmode-refresh", { offset: c });
    }, 180);
  }, [refreshChrome]);

  // Cheap chip reposition on scroll/resize (registry unchanged).
  const scheduleReposition = useCallback(() => {
    if (chromeRafRef.current) return;
    chromeRafRef.current = requestAnimationFrame(() => { chromeRafRef.current = 0; renderChrome(); });
  }, [renderChrome]);

  const onScrollResize = useCallback(() => { scheduleReposition(); scheduleRecollect(); }, [scheduleReposition, scheduleRecollect]);

  const chromeEnable = useCallback(() => {
    if (!chromeOverlayRef.current) {
      const ov = document.createElement("div");
      ov.setAttribute("data-mapmode-overlay", "1");
      ov.style.cssText = "position:fixed;inset:0;z-index:2147483550;pointer-events:none;";
      document.body.appendChild(ov);
      chromeOverlayRef.current = ov;
    }
    const c = refreshChrome();
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    if (!chromeObserverRef.current) {
      const obs = new MutationObserver((muts) => {
        const ov = chromeOverlayRef.current;
        if (ov && muts.every((m) => ov.contains(m.target as Node))) return; // ignore our own chip churn
        scheduleRecollect();
      });
      obs.observe(document.body, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ["style", "class", "hidden", "aria-expanded", "data-state", "open"],
      });
      chromeObserverRef.current = obs;
    }
    const send = useMapModeStore.getState()._send;
    if (send) send("mapmode-enable", { offset: c }); // preview numbers start after chrome
  }, [refreshChrome, onScrollResize, scheduleRecollect]);

  const chromeDisable = useCallback(() => {
    window.removeEventListener("scroll", onScrollResize, true);
    window.removeEventListener("resize", onScrollResize);
    if (chromeObserverRef.current) { chromeObserverRef.current.disconnect(); chromeObserverRef.current = null; }
    if (chromeRecollectTimerRef.current) { clearTimeout(chromeRecollectTimerRef.current); chromeRecollectTimerRef.current = null; }
    if (chromeOverlayRef.current) { chromeOverlayRef.current.remove(); chromeOverlayRef.current = null; }
    chromeRegRef.current.clear();
    focusedElRef.current = null;
    focusScopeRef.current = null;
    const store = useMapModeStore.getState();
    store.setMarks([]);
    if (store._send) store._send("mapmode-disable");
  }, [onScrollResize]);

  const actChrome = useCallback(
    (kind: string, num?: number, text?: string) => {
      const t0 = now();
      const reg = chromeRegRef.current;
      const el = num != null ? reg.get(num) : focusedElRef.current;
      let label = "";
      if (kind === "focus") {
        if (!el) label = `no #${num}`;
        else { focusedElRef.current = el; el.focus({ preventScroll: true }); renderChrome(); label = `focus #${num}`; }
      } else if (kind === "click") {
        if (!el) label = `no #${num}`;
        else { focusedElRef.current = el; try { el.focus({ preventScroll: true }); } catch { /* */ } el.click(); renderChrome(); label = `click #${num}`; setTimeout(() => refreshChrome(), 80); }
      } else if (kind === "type") {
        label = typeIntoP(focusedElRef.current, text || "", false) ? "type" : "no field";
      } else if (kind === "clear") {
        const f = focusedElRef.current;
        if (f && chromeTypeable(f)) { setNativeValueP(f as HTMLInputElement, ""); label = "clear"; } else label = "no field";
      } else if (kind === "enter") {
        pressEnterP(focusedElRef.current); label = "enter"; setTimeout(() => refreshChrome(), 80);
      }
      useMapModeStore.getState().pushActed({ num: num ?? null, label, execMs: Math.round(now() - t0) });
    },
    [renderChrome, refreshChrome],
  );

  /* ── execute one normalized command ───────────────────────────────────── */
  const execCommand = useCallback(
    (value: string, meta?: { speakMs?: number; recogMs?: number }) => {
      pendingMetaRef.current = meta || {};
      countAction(meta);

      const tokens = value.split(/\s+/);
      const head = tokens[0];

      if (/^\d+$/.test(head)) {
        const num = parseInt(head, 10);
        const rest = tokens.slice(1).join(" ");
        const chromeEl = chromeRegRef.current.get(num);

        if (chromeEl) {
          const typeable = chromeTypeable(chromeEl);
          if (rest) {
            actChrome("focus", num); actChrome("type", undefined, rest);
            focusScopeRef.current = "chrome"; setFocus(num, typeable);
            pushLog(`→ #${num} ⌨ "${rest}"`);
          } else if (typeable) {
            actChrome("focus", num); focusScopeRef.current = "chrome"; setFocus(num, true);
            pushLog(`→ focus #${num} (${chromeName(chromeEl)}) — dictation on`);
          } else {
            actChrome("click", num); focusScopeRef.current = null; setFocus(num, false);
            pushLog(`→ click #${num} (${chromeName(chromeEl)})`);
          }
          return;
        }

        const mark = useMapModeStore.getState().marks.find((m) => m.num === num);
        if (!mark) { pushLog(`✗ no #${num}`); return; }
        if (rest) {
          act({ kind: "focus", num }); act({ kind: "type", text: rest });
          focusScopeRef.current = "preview"; setFocus(num, mark.typeable);
          pushLog(`→ #${num} ⌨ "${rest}"`);
        } else if (mark.typeable) {
          act({ kind: "focus", num }); focusScopeRef.current = "preview"; setFocus(num, true);
          pushLog(`→ focus #${num} (${mark.name}) — dictation on`);
        } else {
          act({ kind: "click", num }); focusScopeRef.current = null; setFocus(num, false);
          pushLog(`→ click #${num} (${mark.name})`);
        }
        return;
      }

      if (head === "click" || head === "focus") {
        const num = parseInt(tokens[1], 10);
        const chromeEl = chromeRegRef.current.get(num);
        if (chromeEl) {
          const typeable = head === "focus" && chromeTypeable(chromeEl);
          actChrome(head, num);
          focusScopeRef.current = typeable ? "chrome" : null;
          setFocus(num, typeable);
          pushLog(`→ ${head} #${num} (${chromeName(chromeEl)})`);
          return;
        }
        const mark = useMapModeStore.getState().marks.find((m) => m.num === num);
        if (!mark) { pushLog(`✗ no #${tokens[1]}`); return; }
        const typeable = head === "focus" && mark.typeable;
        act({ kind: head, num });
        focusScopeRef.current = typeable ? "preview" : null;
        setFocus(num, typeable);
        pushLog(`→ ${head} #${num} (${mark.name})`);
        return;
      }

      const onChrome = focusScopeRef.current === "chrome";
      switch (value) {
        case "enter": if (onChrome) actChrome("enter"); else act({ kind: "enter" }); pushLog("⏎ enter"); break;
        case "clear": if (onChrome) actChrome("clear"); else act({ kind: "clear" }); pushLog("· clear"); break;
        case "back": act({ kind: "back" }); pushLog("· back"); break;
        case "tab": act({ kind: "tab" }); pushLog("· tab"); break;
        case "shift tab": act({ kind: "shift tab" }); pushLog("· shift tab"); break;
        case "scroll down": act({ kind: "scroll", text: "down" }); pushLog("· scroll down"); break;
        case "scroll up": act({ kind: "scroll", text: "up" }); pushLog("· scroll up"); break;
        case "top": act({ kind: "top" }); pushLog("· top"); break;
        case "bottom": act({ kind: "bottom" }); pushLog("· bottom"); break;
        default: pushLog(`? "${value}"`);
      }
    },
    [act, setFocus, pushLog, countAction, actChrome],
  );

  /* ── route a raw utterance / typed line ───────────────────────────────── */
  const dispatch = useCallback(
    (raw: string, meta?: { speakMs?: number; recogMs?: number }) => {
      const line = raw.trim();
      if (!line) return;

      const periodSplit = line.split(/\bperiod\b/i);
      if (periodSplit.length === 2) {
        const tail = normalize(periodSplit[1]);
        if (tail.kind === "command") {
          const head = periodSplit[0].trim();
          if (head && useMapModeStore.getState().dictating) {
            if (focusScopeRef.current === "chrome") actChrome("type", undefined, head);
            else act({ kind: "type", text: head });
            pushLog(`⌨ "${head}"`);
          }
          execCommand(tail.value, meta);
          return;
        }
      }

      const norm = normalize(line);
      if (norm.kind === "enter-map") { setMapMode(true); pushLog("● map mode ON"); return; }
      if (norm.kind === "exit-map") { setMapMode(false); pushLog("○ map mode OFF"); return; }
      if (!useMapModeStore.getState().isMapMode) return;

      if (norm.kind === "command") { execCommand(norm.value, meta); return; }

      if (useMapModeStore.getState().dictating) {
        if (focusScopeRef.current === "chrome") actChrome("type", undefined, norm.value);
        else act({ kind: "type", text: norm.value });
        countAction(meta);
        pushLog(`⌨ "${norm.value}"`);
      } else {
        pushLog(`🎤 "${norm.value}" — focus a field by number first`);
      }
    },
    [act, execCommand, pushLog, setMapMode, countAction, actChrome],
  );

  /* ── enable/disable chrome numbering when map mode toggles ────────────── *
   * DOM + store + postMessage only (no React setState) so the effect stays   *
   * lint-clean and doesn't cascade renders.                                  */
  useEffect(() => {
    if (isMapMode) chromeEnable();
    else chromeDisable();
  }, [isMapMode, chromeEnable, chromeDisable]);

  // Teardown on unmount.
  useEffect(
    () => () => {
      if (chromeObserverRef.current) { chromeObserverRef.current.disconnect(); chromeObserverRef.current = null; }
      if (chromeRecollectTimerRef.current) { clearTimeout(chromeRecollectTimerRef.current); chromeRecollectTimerRef.current = null; }
      if (chromeOverlayRef.current) { chromeOverlayRef.current.remove(); chromeOverlayRef.current = null; }
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    },
    [onScrollResize],
  );

  /* ── fold execute time (chrome + preview) into the log + task totals ──── *
   * Subscribe to the store (external system) so we never setState in an      *
   * effect body.                                                             */
  useEffect(() => {
    const unsub = useMapModeStore.subscribe((state, prev) => {
      const la = state.lastActed;
      if (!la || la === prev.lastActed) return;
      if (taskRef.current.running) taskRef.current.exec += la.execMs;
      const m = pendingMetaRef.current;
      const bits = [
        m.speakMs ? `speak ${Math.round(m.speakMs)}ms` : null,
        m.recogMs ? `recognize ${Math.round(m.recogMs)}ms` : null,
        `execute ${la.execMs}ms`,
      ].filter(Boolean);
      pushLog(`⏱ ${la.label} — ${bits.join(" · ")}`);
      pendingMetaRef.current = {};
    });
    return unsub;
  }, [pushLog]);

  /* ── speech recognition (PTT + continuous Listen) ─────────────────────── */
  const handleResult = useCallback(
    (e: { resultIndex: number; results: SpeechResults }) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        const transcript = r[0]?.transcript || "";
        const recogMs = speechEndRef.current ? now() - speechEndRef.current : undefined;
        const speakMs = speechEndRef.current && speechStartRef.current ? speechEndRef.current - speechStartRef.current : undefined;
        speechEndRef.current = 0; speechStartRef.current = 0;
        dispatch(transcript, { recogMs, speakMs });
      }
    },
    [dispatch],
  );

  const ensureRec = useCallback((): SpeechLike | null => {
    if (recRef.current) return recRef.current;
    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => SpeechLike }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechLike }).webkitSpeechRecognition;
    if (!Ctor) return null;
    const r = new Ctor();
    r.lang = "en-US"; r.interimResults = false; r.maxAlternatives = 1; r.continuous = true;
    r.onresult = handleResult;
    r.onerror = (ev) => { if (ev.error !== "no-speech" && ev.error !== "aborted") pushLog(`🎤 ${ev.error}`); };
    r.onend = () => { if (listeningRef.current) { try { r.start(); } catch { /* running */ } } };
    recRef.current = r;
    return r;
  }, [handleResult, pushLog]);

  const startListen = useCallback(() => {
    const r = ensureRec(); if (!r) { pushLog("🎤 no SpeechRecognition (use Chrome/Edge)"); return; }
    listeningRef.current = true; setListening(true);
    try { r.start(); } catch { /* running */ }
    pushLog("🎤 Listening — say 'map mode'");
  }, [ensureRec, pushLog]);

  const stopListen = useCallback(() => {
    listeningRef.current = false; setListening(false);
    try { recRef.current?.stop(); } catch { /* */ }
    pushLog("🎤 stopped listening");
  }, [pushLog]);

  const pttStart = useCallback(() => {
    if (listeningRef.current) return;
    const r = ensureRec(); if (!r) return;
    pttRef.current = true; setPtt(true);
    speechStartRef.current = now();
    try { r.start(); } catch { /* */ }
  }, [ensureRec]);

  const pttStop = useCallback(() => {
    if (!pttRef.current) return;
    pttRef.current = false; setPtt(false);
    speechEndRef.current = now();
    try { recRef.current?.stop(); } catch { /* */ }
  }, []);

  /* ── global keys: Alt+` toggle, Esc exit, Space PTT ───────────────────── */
  useEffect(() => {
    const inBox = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.code === "Backquote" || e.key === "`")) {
        e.preventDefault();
        setMapMode(!useMapModeStore.getState().isMapMode);
        return;
      }
      if (!useMapModeStore.getState().isMapMode) return;
      if (e.key === "Escape") { setMapMode(false); return; }
      if (e.code === "Space" && !inBox(document.activeElement) && !e.repeat) { e.preventDefault(); pttStart(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && !inBox(document.activeElement)) { e.preventDefault(); pttStop(); }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [setMapMode, pttStart, pttStop]);

  useEffect(() => {
    if (!taskRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, [taskRunning]);

  const startTask = () => {
    const t0 = now();
    taskRef.current = { running: true, count: 0, exec: 0, recog: 0, recogN: 0, speak: 0, speakN: 0 };
    setTaskStartAt(t0); setTaskCount(0); setTaskRunning(true);
    pushLog("▶ TASK TIMER started");
  };
  const stopTask = () => {
    const t = taskRef.current; t.running = false;
    setTaskRunning(false); setTaskStartAt(null);
    const wall = taskStartAt != null ? (now() - taskStartAt) / 1000 : 0;
    pushLog("━━━━━━━━━━━━━━━━━━");
    pushLog(`■ TASK — ${t.count} actions in ${wall.toFixed(1)}s (avg ${t.count ? (wall / t.count).toFixed(2) : "0"}s)`);
    if (t.speakN) pushLog(`   speaking ${(t.speak / 1000).toFixed(1)}s`);
    if (t.recogN) pushLog(`   recognition ${(t.recog / 1000).toFixed(1)}s (avg ${Math.round(t.recog / t.recogN)}ms)`);
    pushLog(`   execution ${t.exec}ms total`);
    pushLog("━━━━━━━━━━━━━━━━━━");
  };

  const onSubmitCmd = (e: React.FormEvent) => {
    e.preventDefault();
    const v = cmd; setCmd("");
    if (/^(map mode off|off|exit|stop)$/i.test(v.trim())) { setMapMode(false); return; }
    dispatch(v, {});
  };

  /* ── render ───────────────────────────────────────────────────────────── */
  void tick;
  const wall = taskRunning && taskStartAt != null ? ((now() - taskStartAt) / 1000).toFixed(1) : null;
  const totalMarks = previewOffset + marks.length;

  if (!isMapMode) {
    if (!hasSR) return null;
    return (
      <div data-mapmode-ui="1" className="fixed bottom-4 right-4 z-[2147483600]">
        <button
          onClick={() => (listening ? stopListen() : startListen())}
          className={`rounded-full px-3 py-2 text-xs font-semibold shadow-lg border ${
            listening ? "bg-emerald-600 text-white border-emerald-400" : "bg-zinc-900 text-zinc-200 border-white/10 hover:bg-zinc-800"
          }`}
          title="Arm voice — then say 'map mode'"
        >
          {listening ? "🎤 Listening — say 'map mode'" : "🎤 Map mode (voice)"}
        </button>
      </div>
    );
  }

  return (
    <div
      data-mapmode-ui="1"
      className="fixed left-1/2 bottom-4 -translate-x-1/2 z-[2147483600] w-[min(720px,95vw)] rounded-xl border border-emerald-500/30 bg-zinc-950/95 text-zinc-100 shadow-2xl backdrop-blur"
    >
      <div className="flex items-center gap-2 p-2">
        <span className="shrink-0 rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-bold tracking-wide text-emerald-950">
          {dictating ? `DICTATION #${focusedNum ?? ""}` : "MAP MODE"}
        </span>
        <form onSubmit={onSubmitCmd} className="flex-1">
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            autoFocus
            spellCheck={false}
            placeholder='number · "click 5" · "type hello" · "send" · "map mode off"'
            className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 font-mono text-[13px] text-zinc-50 outline-none"
          />
        </form>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-500">
          {wall ? `▶ ${taskCount}/${wall}s` : `${totalMarks} marks`}
        </span>
      </div>

      <div className="flex items-center gap-2 px-2 pb-2">
        {hasSR && (
          <>
            <button
              onClick={() => (listening ? stopListen() : startListen())}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                listening ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              }`}
            >
              {listening ? "🎤 Listening" : "🎤 Listen"}
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); pttStart(); }}
              onMouseUp={() => pttStop()}
              onMouseLeave={() => { if (ptt) pttStop(); }}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                ptt ? "bg-red-600 text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              }`}
              title="Hold to talk (or hold Space)"
            >
              {ptt ? "🔴 talking" : "🎤 hold to talk"}
            </button>
          </>
        )}
        <button
          onClick={() => (taskRunning ? stopTask() : startTask())}
          className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
            taskRunning ? "bg-red-600 text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
          }`}
        >
          {taskRunning ? "⏹ Stop task" : "⏱ Start task"}
        </button>
        <button
          onClick={() => setMapMode(false)}
          className="ml-auto rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
        >
          map mode off
        </button>
      </div>

      <div className="max-h-28 overflow-auto border-t border-white/5 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-zinc-400">
        {log.length === 0 ? (
          <div className="text-zinc-600">
            Blue numbers = builder buttons, yellow = your preview. Say/type a number to act, “send” commits, “map mode off” exits.
          </div>
        ) : (
          log.map((l, i) => <div key={i}>{l}</div>)
        )}
      </div>
    </div>
  );
}
