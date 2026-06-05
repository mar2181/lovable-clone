"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Save, Loader2, Upload, AlertCircle, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useSelectStore } from "@/lib/select-store";
import { useAuth } from "@/lib/dev-auth";
import { WORKER_URL } from "@/lib/constants";
import { validateAttachmentFile, uploadAttachment } from "@/lib/upload";
import { SupabaseImagePicker } from "@/components/editor/supabase-image-picker";

interface InspectorPanelProps {
  projectId: string;
  onApplied: (files: Record<string, string>, deps: Record<string, string>) => void;
  onOpenCode?: () => void;
}

type SaveState = "idle" | "saving" | "ok" | "error";

const TEXT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "span", "a", "button", "li", "label",
  "div", "strong", "em", "small", "blockquote",
]);

function isTextLeaf(tag: string, text: string, html: string): boolean {
  if (!TEXT_TAGS.has(tag)) return false;
  if (!text || text.trim().length === 0) return false;
  const stripped = html.replace(/<[^>]+>/g, "").trim();
  return stripped === text.trim();
}

export function InspectorPanel({ projectId, onApplied, onOpenCode }: InspectorPanelProps) {
  const current = useSelectStore((s) => s.current);
  const isModeActive = useSelectStore((s) => s.isModeActive);
  const clear = useSelectStore((s) => s.clear);
  const { getToken } = useAuth();

  const [textDraft, setTextDraft] = useState("");
  const [imgUrlDraft, setImgUrlDraft] = useState("");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  // Reset draft state when selection changes
  useEffect(() => {
    if (!current) {
      setTextDraft("");
      setImgUrlDraft("");
      setSaveState("idle");
      setErrMsg(null);
      return;
    }
    setTextDraft(current.text || "");
    setImgUrlDraft(current.attributes?.src || "");
    setSaveState("idle");
    setErrMsg(null);
  }, [current?.id]);

  const isImg = current?.tag === "img";
  const isText = current ? isTextLeaf(current.tag, current.text, current.outerHTML) : false;
  const editable = isImg || isText;

  const hasChange = useMemo(() => {
    if (!current) return false;
    if (isImg) return imgUrlDraft && imgUrlDraft !== current.attributes?.src;
    if (isText) return textDraft !== current.text;
    return false;
  }, [current, imgUrlDraft, textDraft, isImg, isText]);

  if (!isModeActive || !current) return null;

  function handleClose() {
    if (uploadAbortRef.current) uploadAbortRef.current.abort();
    clear();
  }

  async function handleFilePick(file: File) {
    setErrMsg(null);
    const err = validateAttachmentFile(file);
    if (err) {
      setErrMsg(err);
      return;
    }
    try {
      const token = await getToken();
      if (!token) {
        setErrMsg("Not authenticated — refresh and try again.");
        return;
      }
      uploadAbortRef.current = new AbortController();
      setUploadPct(0);
      const result = await uploadAttachment(
        file,
        projectId,
        token,
        (pct) => setUploadPct(pct),
        uploadAbortRef.current.signal,
      );
      setUploadPct(null);
      const url = (result as any).publicUrl || (result as any).url;
      if (!url) {
        setErrMsg("Upload returned no public URL.");
        return;
      }
      setImgUrlDraft(url);
    } catch (e: any) {
      setUploadPct(null);
      setErrMsg(e?.message || "Upload failed.");
    }
  }

  async function handleSave() {
    if (!current || !hasChange) return;
    setSaveState("saving");
    setErrMsg(null);

    const edits = isImg
      ? [{ kind: "img-src" as const, oldValue: current.attributes!.src, newValue: imgUrlDraft }]
      : [{ kind: "text" as const, oldValue: current.text, newValue: textDraft }];

    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated — refresh and try again.");
      const res = await fetch(`${WORKER_URL}/api/projects/${projectId}/inline-edits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ edits }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Save failed (${res.status})`);
      }
      if (data.rejected && data.rejected.length > 0) {
        const reasons = data.rejected.map((r: any) => r.reason).join("; ");
        setErrMsg(`Couldn't apply: ${reasons}`);
        setSaveState("error");
        return;
      }
      onApplied(data.files || {}, data.dependencies || {});
      setSaveState("ok");
      setTimeout(() => {
        clear();
        setSaveState("idle");
      }, 800);
    } catch (e: any) {
      setErrMsg(e?.message || "Save failed.");
      setSaveState("error");
    }
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[min(520px,calc(100%-32px))] rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-blue-400">&lt;{current.tag}&gt;</span>
          <span className="text-zinc-500 truncate max-w-[280px]">{current.selectorPath}</span>
        </div>
        <button
          onClick={handleClose}
          className="text-zinc-500 hover:text-white transition-colors"
          aria-label="Close inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {isText && (
          <div>
            <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium block mb-1.5">
              Text
            </label>
            <Textarea
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              rows={3}
              className="bg-zinc-950/60 border-white/10 text-sm text-white"
              placeholder="Edit the text…"
            />
          </div>
        )}

        {isImg && (
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium block">
              Image source
            </label>
            {imgUrlDraft && (
              <div className="rounded-md overflow-hidden border border-white/5 bg-zinc-950 aspect-video flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgUrlDraft}
                  alt="preview"
                  className="max-h-full max-w-full object-contain"
                  onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                />
              </div>
            )}
            <Input
              value={imgUrlDraft}
              onChange={(e) => setImgUrlDraft(e.target.value)}
              placeholder="https://… or pick / upload below"
              className="bg-zinc-950/60 border-white/10 text-xs text-white font-mono"
            />
            <div>
              <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium block mb-1.5">
                From this project
              </label>
              <SupabaseImagePicker
                projectId={projectId}
                selectedUrl={imgUrlDraft}
                onSelect={(url) => {
                  setImgUrlDraft(url);
                  setErrMsg(null);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFilePick(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadPct !== null}
                className="h-8 text-xs border-white/10 bg-zinc-950/60 hover:bg-zinc-800 text-zinc-300"
              >
                {uploadPct !== null ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Uploading {uploadPct}%
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Upload new
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {!editable && (
          <div className="text-xs text-zinc-400">
            This element isn't inline-editable from here — nested content or no text. Open it in the
            code editor to make changes.
          </div>
        )}

        {errMsg && (
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md p-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{errMsg}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenCode}
            className="h-8 text-xs text-zinc-400 hover:text-white"
          >
            <Code2 className="w-3.5 h-3.5 mr-1.5" />
            Open in code
          </Button>

          {editable && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChange || saveState === "saving"}
              className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saveState === "saving" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Saving…
                </>
              ) : saveState === "ok" ? (
                <>
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  Saved
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  Save change
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
