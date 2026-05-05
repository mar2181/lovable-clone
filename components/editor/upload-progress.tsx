"use client";

import { Loader2, X, AlertTriangle, RefreshCw } from "lucide-react";

interface UploadProgressProps {
  filename: string;
  progress: number; // 0–100
  error?: string | null;
  onCancel: () => void;
  onRetry?: () => void;
}

export function UploadProgress({
  filename,
  progress,
  error,
  onCancel,
  onRetry,
}: UploadProgressProps) {
  return (
    <div
      className="relative inline-block rounded-md border border-white/10 bg-zinc-900/80 p-2 min-w-[200px]"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        {error ? (
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
        ) : (
          <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
        )}

        <span
          className="text-[11px] text-zinc-300 truncate max-w-[140px]"
          title={filename}
        >
          {filename}
        </span>

        {!error && (
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto text-zinc-500 hover:text-white transition-colors shrink-0"
            aria-label="Cancel upload"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {error && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-auto text-zinc-400 hover:text-white transition-colors shrink-0"
            aria-label="Retry upload"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {error ? (
        <p className="mt-1 text-[10px] text-red-400">{error}</p>
      ) : (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-zinc-500 tabular-nums w-8 text-right">
            {progress}%
          </span>
        </div>
      )}
    </div>
  );
}
