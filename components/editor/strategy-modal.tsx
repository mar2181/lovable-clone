"use client";

import { useEffect } from "react";
import { ClipboardList, X, ExternalLink } from "lucide-react";

interface StrategyModalProps {
  open: boolean;
  onClose: () => void;
  digest: string | null;
  loading: boolean;
}

export function StrategyModal({ open, onClose, digest, loading }: StrategyModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] bg-zinc-950 border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 text-amber-200">
            <ClipboardList className="w-4 h-4" />
            <h2 className="text-sm font-medium tracking-wide uppercase">Strategy Source-of-Truth</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-sm text-zinc-500">Loading…</div>
          ) : digest ? (
            <>
              <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
                This digest was produced by the Outlier Research Engine. It is
                automatically injected into every Build prompt as
                source-of-truth — you don&rsquo;t need to remind the pet about
                it. The full blueprint lives at{" "}
                <code className="px-1 py-0.5 rounded bg-white/5 text-amber-200">
                  /strategy
                </code>{" "}
                in your live preview.
              </p>
              <pre className="whitespace-pre-wrap text-xs text-zinc-200 font-mono leading-relaxed bg-black/30 rounded-md p-3 border border-white/5">
                {digest}
              </pre>
            </>
          ) : (
            <div className="text-sm text-zinc-500">
              No strategy has been generated yet for this project.
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex items-center justify-between text-[11px] text-zinc-500">
          <span>Press Esc to close</span>
          <a
            href="/strategy"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-amber-300 hover:text-amber-200 transition-colors"
          >
            Open /strategy in preview
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
