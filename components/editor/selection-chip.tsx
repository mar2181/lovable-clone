"use client";

import { X, Crosshair } from "lucide-react";
import { useSelectStore } from "@/lib/select-store";

interface SelectionChipProps {
  dimmed?: boolean;
}

function truncateText(text: string): string {
  const t = text.trim();
  if (!t) return "";
  return t.length > 24 ? t.slice(0, 24) + "…" : t;
}

export function SelectionChip({ dimmed = false }: SelectionChipProps) {
  const current = useSelectStore((s) => s.current);
  const clear = useSelectStore((s) => s.clear);

  if (!current) return null;

  const label = current.text
    ? `${current.tag} · "${truncateText(current.text)}"`
    : `${current.tag} · <em>empty</em>`;

  return (
    <div
      className="relative inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-white/10 bg-zinc-800/60 text-xs text-zinc-300 max-w-[320px] shrink-0"
      style={{ opacity: dimmed ? 0.5 : 1, pointerEvents: dimmed ? "none" : "auto" }}
      role="status"
    >
      <Crosshair className="w-3.5 h-3.5 text-blue-400 shrink-0" />
      <span className="truncate">{label}</span>
      {!dimmed && (
        <button
          type="button"
          onClick={clear}
          className="ml-0.5 shrink-0 text-zinc-500 hover:text-white transition-colors"
          aria-label="Clear selection"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
