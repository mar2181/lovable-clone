"use client";

import { Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMapModeStore } from "@/lib/mapmode-store";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function MapModeToggle() {
  const isMapMode = useMapModeStore((s) => s.isMapMode);
  const toggle = useMapModeStore((s) => s.toggle);

  return (
    <Tooltip>
      <TooltipTrigger>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggle()}
          className={cn(
            "h-7 px-3 text-xs rounded-md gap-1.5",
            isMapMode
              ? "bg-emerald-500/15 ring-1 ring-emerald-500/40 text-emerald-400"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800/50",
          )}
          aria-pressed={isMapMode}
          aria-label="Toggle map mode"
        >
          <Hash className="w-3.5 h-3.5" />
          Map mode
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {isMapMode
          ? "Map mode active — say/type a number to act. Alt+` or Esc to exit."
          : "Map mode (Alt+`) — number every element, command by voice or keys"}
      </TooltipContent>
    </Tooltip>
  );
}
