"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Rocket, Send, Mic, MicOff, ChevronRight, X } from "lucide-react";

/**
 * BuddyPanel — the Builder's Dia/Arc-style docked assistant rail.
 *
 * A persistent right-hand column: the Space Mario astronaut rests at the top
 * (the engine in space-mario-buddy.js positions its fixed body over #buddy-dock
 * and flies out onto the page for tours/point-at, then returns), a scrollable
 * transcript shows the running conversation, and a composer lets you type OR
 * talk. It is a pure UI shell over the headless embed's public API
 * (window.PetConcierge): voice via start()/end(), transcript via on("message"),
 * text via sendText(). No agent/tool logic lives here.
 */

const PANEL_WIDTH = 380; // px
const ACCENT = "#a855f7";

type Source = "user" | "ai";
interface Msg {
  id: number;
  source: Source;
  text: string;
}
type Status = "idle" | "connecting" | "listening" | "speaking";

interface PC {
  start: () => void;
  end: () => void;
  on: (name: string, cb: (p?: unknown) => void) => void;
  off?: (name: string, cb: (p?: unknown) => void) => void;
  sendText?: (t: string) => boolean;
  sendActivity?: () => void;
  isReady?: () => boolean;
  isActive?: boolean;
}
function getPC(): PC | null {
  return (typeof window !== "undefined" && (window as unknown as { PetConcierge?: PC }).PetConcierge) || null;
}

export function BuddyPanel() {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [live, setLive] = useState(false);
  const [input, setInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastActivityRef = useRef(0);

  const push = useCallback((source: Source, text: string) => {
    const t = (text || "").trim();
    if (!t) return;
    setMessages((prev) => {
      // De-dupe: a typed message is added optimistically; if the server later
      // echoes the same user turn, skip it.
      const last = prev[prev.length - 1];
      if (last && last.source === source && last.text.trim() === t) return prev;
      return [...prev, { id: ++idRef.current, source, text: t }];
    });
  }, []);

  // Restore collapsed/open preference.
  useEffect(() => {
    try {
      if (localStorage.getItem("buddy.open") === "0") setOpen(false);
    } catch {}
  }, []);

  // Reflow the page: body gets padding-right === rail width while open.
  useEffect(() => {
    const id = "buddy-reflow-style";
    if (!document.getElementById(id)) {
      const s = document.createElement("style");
      s.id = id;
      s.textContent =
        "body{padding-right:var(--buddy-w,0px);transition:padding-right .28s cubic-bezier(.4,0,.2,1);}";
      document.head.appendChild(s);
    }
    document.documentElement.style.setProperty("--buddy-w", open ? PANEL_WIDTH + "px" : "0px");
    try {
      localStorage.setItem("buddy.open", open ? "1" : "0");
    } catch {}
    // Tell the body glue the dock geometry changed so it can re-home.
    window.dispatchEvent(new CustomEvent("buddy:layout", { detail: { open } }));
  }, [open]);

  // Wire the headless embed's public API → panel state.
  useEffect(() => {
    let cancelled = false;
    const onStart = () => {
      if (cancelled) return;
      setLive(true);
      setStatus("listening");
      setErrorMsg(null);
    };
    const onEnd = () => {
      if (cancelled) return;
      setLive(false);
      setStatus("idle");
    };
    const onMode = (p?: unknown) => {
      if (cancelled) return;
      const speaking = !!(p as { speaking?: boolean })?.speaking;
      setStatus(speaking ? "speaking" : "listening");
    };
    const onErr = (p?: unknown) => {
      if (cancelled) return;
      const m = typeof p === "string" ? p : (p as { message?: string })?.message;
      if (m && m !== "null") setErrorMsg(m);
    };
    const onMsg = (p?: unknown) => {
      if (cancelled) return;
      const d = p as { source?: Source; text?: string };
      push(d?.source === "user" ? "user" : "ai", d?.text || "");
    };

    let attached = false;
    const attach = (pc: PC) => {
      if (attached) return;
      attached = true;
      pc.on("start", onStart);
      pc.on("end", onEnd);
      pc.on("mode", onMode);
      pc.on("error", onErr);
      pc.on("message", onMsg);
    };

    const pc0 = getPC();
    if (pc0) attach(pc0);
    const iv = setInterval(() => {
      const pc = getPC();
      if (pc) {
        attach(pc);
        clearInterval(iv);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearInterval(iv);
      const pc = getPC();
      if (pc && pc.off) {
        pc.off("start", onStart);
        pc.off("end", onEnd);
        pc.off("mode", onMode);
        pc.off("error", onErr);
        pc.off("message", onMsg);
      }
    };
  }, [push]);

  // Auto-scroll to newest.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const toggleMic = useCallback(() => {
    const pc = getPC();
    if (!pc) return;
    if (pc.isActive) {
      pc.end();
    } else {
      setStatus("connecting");
      pc.start();
    }
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const pc = getPC();
    if (!pc) return;
    // Text needs a live session; if none, open one first then send.
    if (!pc.isActive) {
      setStatus("connecting");
      pc.start();
      const t0 = Date.now();
      const iv = setInterval(() => {
        const p = getPC();
        if (p && p.isReady && p.isReady()) {
          clearInterval(iv);
          p.sendText && p.sendText(text);
        } else if (Date.now() - t0 > 8000) {
          clearInterval(iv);
        }
      }, 200);
    } else {
      pc.sendText && pc.sendText(text);
    }
    push("user", text); // optimistic
    setInput("");
  }, [input, push]);

  const onInputChange = useCallback((v: string) => {
    setInput(v);
    const now = Date.now();
    if (now - lastActivityRef.current > 1200) {
      lastActivityRef.current = now;
      const pc = getPC();
      pc?.sendActivity?.();
    }
  }, []);

  const dot =
    status === "speaking"
      ? "bg-fuchsia-400 animate-pulse"
      : status === "listening"
      ? "bg-emerald-400"
      : status === "connecting"
      ? "bg-amber-400 animate-pulse"
      : "bg-zinc-500";
  const statusLabel =
    status === "speaking"
      ? "Speaking…"
      : status === "listening"
      ? "Listening"
      : status === "connecting"
      ? "Connecting…"
      : "Tap the mic or type to start";

  // Collapsed → a slim launcher tab on the right edge.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Space Mario"
        className="fixed right-0 top-1/2 z-[2147483600] -translate-y-1/2 flex items-center gap-2 rounded-l-xl border border-r-0 border-white/15 bg-zinc-900/90 px-3 py-4 text-zinc-200 shadow-2xl backdrop-blur transition-colors hover:bg-zinc-800"
      >
        <Rocket className="h-5 w-5" style={{ color: ACCENT }} />
        <span className="text-xs font-semibold [writing-mode:vertical-rl]">Space Mario</span>
      </button>
    );
  }

  return (
    <aside
      className="fixed right-0 top-0 z-[2147483600] flex h-screen flex-col border-l border-white/10 bg-zinc-950/95 text-zinc-100 shadow-2xl backdrop-blur-xl"
      style={{ width: PANEL_WIDTH }}
    >
      {/* Header + astronaut dock */}
      <div className="relative shrink-0 border-b border-white/10 bg-gradient-to-b from-zinc-900/80 to-zinc-950/0">
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
            <div className="leading-tight">
              <div className="text-sm font-semibold">Space Mario</div>
              <div className="text-[11px] text-zinc-400">{statusLabel}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Collapse panel"
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {/* The astronaut's resting place. space-mario-buddy.js positions the
            fixed body over this box and returns here after flying out. */}
        <div id="buddy-dock" className="relative h-[150px] w-full" aria-hidden="true" />
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mt-6 text-center text-sm text-zinc-500">
            <p className="font-medium text-zinc-400">Hey, I&apos;m Space Mario 🚀</p>
            <p className="mt-1">Your build buddy. Talk or type — ask me to spin up an app, give you a tour, or point things out.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.source === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                m.source === "user"
                  ? "rounded-br-sm bg-fuchsia-600 text-white"
                  : "rounded-bl-sm bg-zinc-800 text-zinc-100"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      {/* Error strip */}
      {errorMsg && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <span className="flex-1">{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="shrink-0 border-t border-white/10 bg-zinc-900/60 p-3">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={toggleMic}
            aria-label={live ? "End voice" : "Start voice"}
            title={live ? "End voice" : "Start voice"}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
              live
                ? "border-fuchsia-400/50 bg-fuchsia-500/20 text-fuchsia-300"
                : "border-white/15 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {live ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </button>
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Message Space Mario…"
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-white/10 bg-zinc-800/80 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-fuchsia-400/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={!input.trim()}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: ACCENT }}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
