"use client";

import { MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSelectStore } from "@/lib/select-store";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SelectModeToggle() {
  const isModeActive = useSelectStore((s) => s.isModeActive);
  const setModeActive = useSelectStore((s) => s.setModeActive);

  return (
    <Tooltip>
      <TooltipTrigger>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setModeActive(!isModeActive)}
          className={cn(
            "h-7 px-3 text-xs rounded-md gap-1.5",
            isModeActive
              ? "bg-blue-500/15 ring-1 ring-blue-500/40 text-blue-400"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800/50",
          )}
          aria-pressed={isModeActive}
          aria-label="Toggle element select mode"
        >
          <MousePointerClick className="w-3.5 h-3.5" />
          Select
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {isModeActive
          ? "Select mode active. Click an element. Esc to exit."
          : "Select mode (⌘E) — click any element in the preview"}
      </TooltipContent>
    </Tooltip>
  );
}
