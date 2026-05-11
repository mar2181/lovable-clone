"use client";

import { X, Video, ImageIcon } from "lucide-react";
import { formatBytes } from "@/lib/format";

interface AttachmentPreviewProps {
  kind: "image" | "video";
  url: string;
  filename: string;
  sizeBytes: number;
  isVisionActive?: boolean;
  onRemove: () => void;
}

export function AttachmentPreview({
  kind,
  url,
  filename,
  sizeBytes,
  isVisionActive,
  onRemove,
}: AttachmentPreviewProps) {
  return (
    <div className="relative inline-block group">
      {kind === "image" ? (
        <img
          src={url}
          alt={filename}
          className="h-16 rounded-md border border-white/10 object-cover"
        />
      ) : (
        <video
          src={url}
          muted
          playsInline
          preload="metadata"
          className="h-16 rounded-md border border-white/10 object-cover"
          title={filename}
        />
      )}

      {/* Kind badge */}
      <span className="absolute top-1 left-1 bg-black/70 rounded px-1 py-0.5 text-[9px] text-zinc-300 flex items-center gap-0.5">
        {kind === "image" ? (
          <ImageIcon className="w-2.5 h-2.5" />
        ) : (
          <Video className="w-2.5 h-2.5" />
        )}
      </span>

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-2 -right-2 bg-zinc-800 text-white rounded-full p-0.5 border border-white/10 hover:bg-zinc-700 transition-colors"
        aria-label="Remove attachment"
      >
        <X className="w-3 h-3" />
      </button>

      {/* Filename + size label */}
      <div className="mt-1 flex items-center gap-2">
        <span
          className="text-[10px] text-zinc-400 truncate max-w-[160px]"
          title={filename}
        >
          {filename}
        </span>
        <span className="text-[10px] text-zinc-600">
          {formatBytes(sizeBytes)}
        </span>
      </div>

      {/* Vision model badge (images only) */}
      {kind === "image" && isVisionActive && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-blue-400">
          <span>Vision model active</span>
        </div>
      )}
    </div>
  );
}
