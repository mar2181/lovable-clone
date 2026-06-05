"use client";

import { useEffect, useState } from "react";
import { Loader2, ImageOff, RefreshCw, Check } from "lucide-react";
import { useAuth } from "@/lib/dev-auth";
import { WORKER_URL } from "@/lib/constants";

/**
 * A grid of images already stored for this project (the project image
 * library), so users can pick an existing image instead of pasting a URL or
 * re-uploading. Backed by the project attachments list endpoint
 * (`GET /api/attachments?projectId=…`), which serves the project's stored
 * objects with their public URLs.
 *
 * If the listing endpoint is unavailable, the component renders a small,
 * non-blocking notice and the surrounding inspector still offers URL + upload.
 */

interface StoredImage {
  id: string;
  filename: string;
  publicUrl: string;
  mimeType: string;
  kind: string;
}

interface SupabaseImagePickerProps {
  projectId: string;
  /** Currently-selected image URL, so the matching tile can show as active. */
  selectedUrl?: string;
  /** Fired with the public URL of the clicked image. */
  onSelect: (url: string) => void;
}

type LoadState = "loading" | "ok" | "empty" | "error";

export function SupabaseImagePicker({
  projectId,
  selectedUrl,
  onSelect,
}: SupabaseImagePickerProps) {
  const { getToken } = useAuth();
  const [images, setImages] = useState<StoredImage[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      setErrMsg(null);
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) {
            setErrMsg("Not authenticated — refresh and try again.");
            setState("error");
          }
          return;
        }
        const res = await fetch(
          `${WORKER_URL}/api/attachments?projectId=${encodeURIComponent(projectId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || `Couldn't load images (${res.status})`);
        }
        const all: StoredImage[] = Array.isArray(data?.attachments) ? data.attachments : [];
        const imgs = all.filter(
          (a) => a?.publicUrl && (a.kind === "image" || /^image\//.test(a.mimeType || "")),
        );
        if (cancelled) return;
        setImages(imgs);
        setState(imgs.length > 0 ? "ok" : "empty");
      } catch (e: any) {
        if (cancelled) return;
        setErrMsg(e?.message || "Couldn't load images.");
        setState("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, getToken]);

  function reload() {
    // Re-run the effect by nudging state; simplest is to re-trigger via a
    // tiny refetch using the same logic. Toggling to loading then re-mounting
    // is overkill, so we just call the fetch inline.
    setState("loading");
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setErrMsg("Not authenticated — refresh and try again.");
          setState("error");
          return;
        }
        const res = await fetch(
          `${WORKER_URL}/api/attachments?projectId=${encodeURIComponent(projectId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Couldn't load images (${res.status})`);
        const all: StoredImage[] = Array.isArray(data?.attachments) ? data.attachments : [];
        const imgs = all.filter(
          (a) => a?.publicUrl && (a.kind === "image" || /^image\//.test(a.mimeType || "")),
        );
        setImages(imgs);
        setState(imgs.length > 0 ? "ok" : "empty");
        setErrMsg(null);
      } catch (e: any) {
        setErrMsg(e?.message || "Couldn't load images.");
        setState("error");
      }
    })();
  }

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-xs text-zinc-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading project images…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-white/5 bg-zinc-950/40 px-2 py-2 text-xs text-zinc-500">
        <span className="truncate">{errMsg || "Couldn't load project images."}</span>
        <button
          onClick={reload}
          className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors shrink-0"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-white/5 bg-zinc-950/40 px-2 py-3 text-xs text-zinc-500">
        <ImageOff className="w-3.5 h-3.5 shrink-0" />
        No images in this project&apos;s library yet — upload one below.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-1.5 max-h-[156px] overflow-y-auto pr-0.5">
      {images.map((img) => {
        const active = !!selectedUrl && selectedUrl === img.publicUrl;
        return (
          <button
            key={img.id}
            type="button"
            onClick={() => onSelect(img.publicUrl)}
            title={img.filename}
            className={`group relative aspect-square overflow-hidden rounded-md border bg-zinc-950 transition-colors ${
              active
                ? "border-blue-500 ring-1 ring-blue-500"
                : "border-white/10 hover:border-white/30"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.publicUrl}
              alt={img.filename}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")}
            />
            {active && (
              <span className="absolute right-0.5 top-0.5 rounded-full bg-blue-600 p-0.5 text-white">
                <Check className="w-2.5 h-2.5" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
