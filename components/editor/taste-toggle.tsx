"use client";

import { useState } from "react";
import { Sparkles, Check } from "lucide-react";

interface TasteToggleProps {
  enabled: boolean;
  onToggle: (next: boolean) => Promise<void> | void;
  disabled?: boolean;
}

export function TasteToggle({ enabled, onToggle, disabled }: TasteToggleProps) {
  const [busy, setBusy] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const handleClick = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onToggle(!enabled);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={() => setShowHint(true)}
        onMouseLeave={() => setShowHint(false)}
        disabled={busy || disabled}
        title={
          enabled
            ? "Taste-skill ON — anti-AI-defaults applied to every build. Click to disable."
            : "Taste-skill OFF. Click to enable for this project."
        }
        className={[
          "h-8 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors",
          enabled
            ? "bg-violet-500/15 text-violet-200 border-violet-500/30 hover:bg-violet-500/25"
            : "bg-zinc-800/50 text-zinc-500 border-white/10 hover:text-zinc-300 hover:bg-zinc-800",
          (busy || disabled) && "opacity-50 cursor-not-allowed",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>Taste</span>
        {enabled && <Check className="w-3 h-3" />}
      </button>
      {showHint && (
        <div className="absolute bottom-full mb-2 right-0 z-50 w-56 p-2.5 rounded-md bg-zinc-900 border border-white/10 shadow-xl text-[11px] text-zinc-300 leading-snug pointer-events-none">
          Anti-AI design layer. When ON, every build avoids the LLM defaults
          (centered gradient hero, three equal feature cards, generic
          glassmorphism) and applies the three-dial design discipline.
        </div>
      )}
    </div>
  );
}
