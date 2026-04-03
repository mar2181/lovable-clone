"use client";

import { Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface GenerationProgressProps {
  isGenerating: boolean;
  message?: string;
  className?: string;
}

export function GenerationProgress({ isGenerating, message, className }: GenerationProgressProps) {
  if (!isGenerating && !message) return null;

  return (
    <div className={cn("flex items-center gap-3 px-4 py-3 bg-zinc-900/80 border border-white/10 rounded-xl backdrop-blur-md shadow-2xl", className)}>
      {isGenerating ? (
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
      ) : (
        <CheckCircle2 className="w-5 h-5 text-green-500" />
      )}
      <p className="text-sm font-medium text-white">
        {message || (isGenerating ? "Generating code..." : "Completed")}
      </p>
    </div>
  );
}
