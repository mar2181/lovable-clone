"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, Paperclip, Eye, MessageSquare, Hammer, Square, Loader2, AlertCircle, ClipboardList, Brain, Rocket, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModelSelector } from "@/components/editor/model-selector";
import { ChatMessage, ChatMessageProps, ChatAttachment } from "@/components/editor/chat-message";
import { GenerationProgress } from "@/components/editor/generation-progress";
import { TasteToggle } from "@/components/editor/taste-toggle";
import { StrategyModal } from "@/components/editor/strategy-modal";
import { DEFAULT_MODEL, VISION_MODEL, AI_MODELS } from "@/lib/models";
import { useAuth } from "@/lib/dev-auth";
import { WORKER_URL } from "@/lib/constants";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { parseStreamToJSON } from "@/lib/file-parser";
import { uploadAttachment, type AttachmentUploadResult } from "@/lib/upload";

// One thumbnail in the chat composer. Tracks both halves of the upload:
//   • `dataUrl`  — compressed JPEG sent as vision context (so the model SEES it)
//   • `publicUrl` — R2-hosted URL the AI can embed in the generated site
// Until `status === "uploaded"`, `publicUrl` is undefined and the slot is
// not eligible to be sent as an attachment.
interface AttachmentSlot {
  id: string;
  dataUrl: string;
  filename: string;
  mimeType: string;
  status: "uploading" | "uploaded" | "failed";
  publicUrl?: string;
  kind?: "image" | "video";
  abort?: AbortController;
  errorMessage?: string;
}

interface ChatPanelProps {
  projectId: string;
  contextFiles: Record<string, string>;
  onUpdateFiles: (files: Record<string, string>) => void;
  onUpdateDependencies?: (deps: Record<string, string>) => void;
}

// Visible-message states. The chat bubble shows ONE of these strings,
// never the raw streamed JSON. The raw JSON lives in a ref for parsing.
const PLACEHOLDER_GENERATING = "Generating your app…";
const PLACEHOLDER_PARSING = "Parsing files…";
const PLACEHOLDER_IMAGES = "Generating AI images…";
const PLACEHOLDER_VIDEO = "Rendering hero video (Kling, ~3 min)…";

// Marker the worker injects into the chunk stream when it switches from
// streaming model output to running fal.ai image generation. We detect it
// to update the visible status, but we don't render it in the chat bubble.
const IMAGE_GEN_MARKER = "Generating AI images";
const VIDEO_GEN_MARKER = "Rendering hero video";

function summarizeChanges(prev: Record<string, string> | null | undefined, next: Record<string, string>): { added: number; modified: number; total: number } {
  const before = prev || {};
  let added = 0;
  let modified = 0;
  for (const k of Object.keys(next)) {
    if (!(k in before)) added++;
    else if (before[k] !== next[k]) modified++;
  }
  return { added, modified, total: added + modified };
}

function buildDoneSummary(diff: { added: number; modified: number; total: number }): string {
  if (diff.total === 0) {
    return "Done — but no files were changed. Try rephrasing your prompt.";
  }
  const parts: string[] = [];
  if (diff.added > 0) parts.push(`${diff.added} new`);
  if (diff.modified > 0) parts.push(`${diff.modified} updated`);
  const noun = diff.total === 1 ? "file" : "files";
  return `Done — ${parts.join(", ")} ${noun}. Preview updated.`;
}

export function ChatPanel({ projectId, contextFiles, onUpdateFiles, onUpdateDependencies }: ChatPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [messages, setMessages] = useState<ChatMessageProps[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [attachments, setAttachments] = useState<AttachmentSlot[]>([]);
  const hasUploadingAttachment = attachments.some((s) => s.status === "uploading");
  const [previousModel, setPreviousModel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();

  // Taste-skill + Outlier Research Engine state. Loaded once on mount; updated
  // optimistically on user actions and by the worker's `done` event flags.
  const [tasteEnabled, setTasteEnabled] = useState(true);
  const [strategyDocExists, setStrategyDocExists] = useState(false);
  const [showStrategyGate, setShowStrategyGate] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [strategyDigest, setStrategyDigest] = useState<string | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  // The last user prompt that triggered a BUILD (held for re-submission as
  // a research turn when the gate is clicked).
  const lastBuildPromptRef = useRef<string>("");

  // Raw streamed assistant response — used for parsing only, NEVER rendered.
  const rawAssistantResponseRef = useRef("");
  // Display buffer for ASK / RESEARCH bubbles. Accumulates both model text
  // deltas AND tool-heartbeat lines from the worker so the user sees live
  // progress during long research turns. Decoupled from raw* so JSON parsing
  // in build mode never sees the heartbeat prose.
  const displayBufferRef = useRef("");
  // Snapshot of the file map BEFORE this generation, for diff-based summaries.
  const filesAtSubmitRef = useRef<Record<string, string>>({});
  // Tracks whether we've already finalized the assistant message
  // (so the finally block doesn't overwrite a real done/error message).
  const finalizedRef = useRef(false);
  const doneReceivedRef = useRef(false);
  // Abort handle for the in-flight generation + why it was stopped. Lets the
  // user (or the stall watchdog) break out of a hung stream instead of
  // leaving isGenerating stuck true forever.
  const abortRef = useRef<AbortController | null>(null);
  const stopReasonRef = useRef<"manual" | "timeout" | null>(null);

  // Live ref to current contextFiles, so the chunk handler always sees the
  // freshest file map even though it captures contextFiles in a closure.
  const contextFilesRef = useRef(contextFiles);
  contextFilesRef.current = contextFiles;

  // Helper: replace the last assistant placeholder with a finalized message
  // (clean summary or error). Idempotent — runs at most once per submit.
  const finalizeAssistantMessage = useCallback((finalText: string) => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === "assistant") {
        next[next.length - 1] = { ...last, content: finalText };
      }
      return next;
    });
  }, []);

  // Abort an in-flight generation (user pressed Stop, or the watchdog fired).
  const handleStop = useCallback(() => {
    stopReasonRef.current = "manual";
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  // Load per-project taste flag + strategy existence on mount. Both endpoints
  // are cheap KV reads; failure to load is non-fatal (taste stays ON by
  // default, strategy stays hidden).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const [tasteRes, strategyRes] = await Promise.all([
          fetch(`${WORKER_URL}/api/projects/${projectId}/taste`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${WORKER_URL}/api/projects/${projectId}/strategy`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        if (cancelled) return;
        if (tasteRes.ok) {
          const j = await tasteRes.json();
          setTasteEnabled(j.enabled !== false);
        }
        if (strategyRes.ok) {
          const j = await strategyRes.json();
          setStrategyDocExists(Boolean(j.exists));
        }
      } catch {
        // ignore — default state is correct
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, getToken]);

  const handleTasteToggle = useCallback(
    async (next: boolean) => {
      const before = tasteEnabled;
      setTasteEnabled(next); // optimistic
      try {
        const token = await getToken();
        if (!token) throw new Error("not authenticated");
        const r = await fetch(`${WORKER_URL}/api/projects/${projectId}/taste`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ enabled: next }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (err) {
        console.error("Taste toggle failed:", err);
        setTasteEnabled(before); // revert
      }
    },
    [projectId, tasteEnabled, getToken],
  );

  const openStrategyModal = useCallback(async () => {
    setStrategyOpen(true);
    if (strategyDigest) return;
    setStrategyLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch(`${WORKER_URL}/api/projects/${projectId}/strategy`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const j = await r.json();
        setStrategyDigest(typeof j.digest === "string" ? j.digest : null);
      }
    } catch (err) {
      console.error("Strategy load failed:", err);
    } finally {
      setStrategyLoading(false);
    }
  }, [projectId, getToken, strategyDigest]);

  const MAX_IMAGES = 10;
  // Raw upload cap is intentionally generous — modern phones produce 8-15 MB
  // photos and DSLRs hit 25-40 MB. We accept up to 30 MB and downscale before
  // sending to the model, which keeps the chat payload tiny (vision models
  // don't benefit from > 2048px input anyway — they downsample internally).
  const MAX_RAW_BYTES = 30 * 1024 * 1024;
  const MAX_IMAGE_EDGE_PX = 2048;
  const JPEG_QUALITY = 0.85;

  /**
   * Downscale + recompress an image File to a JPEG data URL.
   * If the original is already small (< 600 KB) and not larger than the max
   * edge, returns the raw data URL untouched to avoid re-encoding artifacts.
   */
  const compressImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("read failed"));
      reader.onload = () => {
        const rawDataUrl = reader.result as string;
        const img = new Image();
        img.onerror = () => reject(new Error("decode failed"));
        img.onload = () => {
          const maxEdge = Math.max(img.width, img.height);
          const needsResize = maxEdge > MAX_IMAGE_EDGE_PX;
          const needsRecompress = file.size > 600 * 1024;
          if (!needsResize && !needsRecompress && file.type !== "image/gif") {
            resolve(rawDataUrl);
            return;
          }
          const scale = needsResize ? MAX_IMAGE_EDGE_PX / maxEdge : 1;
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            // Canvas unavailable — fall back to raw upload (still better than
            // dropping the image entirely).
            resolve(rawDataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          // Always output JPEG — smaller payload, broad model support.
          // PNG / WebP / GIF transparency is lost, but the use case is photo
          // attachments for vision, not asset import.
          resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
        };
        img.src = rawDataUrl;
      };
      reader.readAsDataURL(file);
    });

  // Update a single slot in place by id. Used by both the upload-success and
  // upload-failure callbacks, which fire asynchronously after the slot has
  // already been rendered, so we can't rely on the slot's array index (the
  // user may have added or removed others in the meantime).
  const updateSlot = useCallback((id: string, patch: Partial<AttachmentSlot>) => {
    setAttachments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const remaining = MAX_IMAGES - attachments.length;
    if (files.length > remaining) {
      alert(
        `You already have ${attachments.length} attached. ${MAX_IMAGES} max — adding the first ${remaining}.`,
      );
    }
    const toProcess = files.slice(0, remaining);

    const skipped: string[] = [];
    const newSlots: Array<{ slot: AttachmentSlot; file: File }> = [];

    for (const file of toProcess) {
      if (file.size > MAX_RAW_BYTES) {
        skipped.push(`${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB)`);
        continue;
      }
      try {
        const dataUrl = await compressImage(file);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        newSlots.push({
          file,
          slot: {
            id,
            dataUrl,
            filename: file.name,
            mimeType: file.type || "image/jpeg",
            status: "uploading",
            abort: new AbortController(),
          },
        });
      } catch (err) {
        console.error("compressImage failed:", err);
        skipped.push(`${file.name} (could not read)`);
      }
    }

    if (newSlots.length > 0) {
      setAttachments((prev) => {
        const room = MAX_IMAGES - prev.length;
        const next = [...prev, ...newSlots.slice(0, room).map((n) => n.slot)];
        // Auto-switch to vision model once first image is attached
        if (prev.length === 0 && next.length > 0) {
          const currentModelInfo = AI_MODELS.find((m) => m.id === selectedModel);
          if (currentModelInfo && !currentModelInfo.vision) {
            setPreviousModel(selectedModel);
            setSelectedModel(VISION_MODEL);
          }
        }
        return next;
      });

      // Fire the actual R2 uploads in parallel. Each completion patches its
      // slot independently — order doesn't matter, and a failure here is
      // non-fatal because the vision base64 still works for the model.
      const room = MAX_IMAGES - attachments.length;
      const tokenPromise = getToken();
      for (const { slot, file } of newSlots.slice(0, room)) {
        (async () => {
          try {
            const token = await tokenPromise;
            if (!token) throw new Error("Not authenticated — refresh and try again.");
            const result: AttachmentUploadResult = await uploadAttachment(
              file,
              projectId,
              token,
              () => {
                // Per-file progress callback. We don't surface % in the UI
                // (the file cap is 30 MB compressed → upload is sub-second on
                // typical connections), but the callback is required by the
                // helper signature.
              },
              slot.abort?.signal,
            );
            updateSlot(slot.id, {
              status: "uploaded",
              publicUrl: result.url,
              kind: result.kind,
              mimeType: result.mimeType,
              abort: undefined,
            });
          } catch (err: any) {
            // Aborts are user-initiated removals — leave the slot alone, it's
            // already been spliced out of state.
            if (err?.name === "AbortError" || /cancelled/i.test(err?.message || "")) {
              return;
            }
            console.error("Attachment upload failed:", err);
            updateSlot(slot.id, {
              status: "failed",
              errorMessage: err?.message || "Upload failed",
              abort: undefined,
            });
          }
        })();
      }
    }

    if (skipped.length > 0) {
      alert(
        `Couldn't attach:\n• ${skipped.join("\n• ")}\n\nMax raw size is ${MAX_RAW_BYTES / 1024 / 1024} MB per image.`,
      );
    }

    // Reset input so same files can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const slot = prev.find((s) => s.id === id);
      // Cancel the upload if still in flight so we don't waste bandwidth or
      // leave an orphaned R2 object the user no longer wants.
      if (slot?.status === "uploading") slot.abort?.abort();
      const next = prev.filter((s) => s.id !== id);
      // Restore previous model if all images removed
      if (next.length === 0 && previousModel) {
        setSelectedModel(previousModel);
        setPreviousModel(null);
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (
    e: React.FormEvent,
    submitMode: "ask" | "build" | "research" | "cinematic" = "build",
    overridePrompt?: string,
  ) => {
    e.preventDefault();
    const usePrompt = (overridePrompt ?? prompt).trim();
    if (!usePrompt || isGenerating) return;
    // Hide the strategy gate the moment any new turn starts — clicking
    // through it or dismissing it both should retire the UI.
    setShowStrategyGate(false);
    // Guard against keyboard-Enter while an attachment is mid-upload. The
    // buttons are visually disabled in this state, but keyboard shortcuts
    // still fire — they need their own check.
    if (attachments.some((s) => s.status === "uploading")) return;

    const userMessage = usePrompt;
    if (submitMode === "build") {
      // Keep a copy for the strategy gate's "Run strategy first" re-submit.
      lastBuildPromptRef.current = userMessage;
    }
    // Snapshot the slot list. We split it into two payloads:
    //   • visionImages: every slot's compressed base64 — sent to the model as
    //     vision input so it can SEE the photo (e.g. recognize a person, room,
    //     style).
    //   • hostedAttachments: only slots that finished uploading to R2 — these
    //     are real, public URLs the AI can embed in the generated site.
    // If an upload failed (or was still in flight at submit time — the Build
    // button guards against this), the slot still contributes vision context
    // but no asset URL.
    const slotsSnapshot = [...attachments];
    const visionImages = slotsSnapshot.map((s) => s.dataUrl);
    const hostedAttachments = slotsSnapshot
      .filter((s) => s.status === "uploaded" && s.publicUrl)
      .map((s) => ({
        publicUrl: s.publicUrl!,
        kind: s.kind ?? "image",
        mimeType: s.mimeType,
        filename: s.filename,
      }));
    const userMessageAttachments: ChatAttachment[] = hostedAttachments.map((a) => ({
      url: a.publicUrl,
      kind: a.kind,
      filename: a.filename,
    }));
    // Capture mode for this submission. Used in the closure below and stable
    // across the streaming lifecycle (state changes during stream are fine).
    const currentMode = submitMode;

    // Only clear the textarea when the prompt came from there (not an override).
    if (!overridePrompt) {
      setPrompt("");
      setAttachments([]);
    }
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userMessage,
        attachments: userMessageAttachments.length > 0 ? userMessageAttachments : undefined,
      },
    ]);
    setIsGenerating(true);
    setStatusMessage(
      currentMode === "ask"
        ? "Thinking…"
        : currentMode === "research"
          ? "Researching the top sites in your niche — this takes 3–5 minutes…"
          : currentMode === "cinematic"
            ? "Rendering cinematic page — Flux stills + Kling 5s hero video (~4 minutes)…"
            : "Connecting to AI…",
    );
    rawAssistantResponseRef.current = "";
    displayBufferRef.current = "";
    doneReceivedRef.current = false;
    finalizedRef.current = false;
    stopReasonRef.current = null;
    // Snapshot the pre-generation file set so we can summarize the diff at done.
    filesAtSubmitRef.current = { ...contextFilesRef.current };

    // Abort controller + stall watchdog. fetchEventSource silently parks a
    // dropped connection (hidden tab, dead worker) without ever settling its
    // promise — that would leave isGenerating stuck true and freeze the whole
    // panel. The watchdog force-aborts after total silence so the finally
    // block can always recover.
    const controller = new AbortController();
    abortRef.current = controller;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    // Research turns are tool-heavy and routinely sit silent for 60–90 s
    // between Firecrawl scrapes. The default 3-min watchdog kills them
    // prematurely. Each tool heartbeat re-arms the watchdog (via armWatchdog
    // on every onmessage), so the relevant ceiling is "silence between
    // events", not total elapsed time. 6 min covers slow scrapes safely.
    // Cinematic turns sit silent for the full fal Kling render. Worker side
    // caps at 10 min (PER_VIDEO_TIMEOUT_MS = 600_000) + image gen (~45 s) +
    // R2 asset copy (~10 s). Watchdog needs to outlast the worker, so 12 min.
    const watchdogMs =
      currentMode === "research"
        ? 360_000
        : currentMode === "cinematic"
          ? 720_000
          : 180_000;
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        stopReasonRef.current = "timeout";
        controller.abort();
      }, watchdogMs);
    };

    try {
      const token = await getToken();

      // In ASK mode, the assistant bubble streams the prose live. In BUILD
      // mode it stays as a "Generating..." placeholder until done.
      const initialAssistantContent =
        currentMode === "ask" ? "" : PLACEHOLDER_GENERATING;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: initialAssistantContent },
      ]);

      armWatchdog();
      await fetchEventSource(`${WORKER_URL}/api/chat/${projectId}`, {
        method: "POST",
        signal: controller.signal,
        // Keep streaming when the tab is backgrounded. Without this,
        // fetch-event-source drops the connection the moment the tab loses
        // focus (e.g. while checking the preview) and never recovers.
        openWhenHidden: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          prompt: userMessage,
          model: selectedModel,
          contextFiles: contextFiles,
          imagesBase64: visionImages,
          attachments: hostedAttachments,
          mode: currentMode,
        }),
        async onopen() {
          armWatchdog();
          setStatusMessage(currentMode === "ask" ? "Answering…" : "AI is generating code…");
        },
        onmessage(ev) {
          armWatchdog();
          if (ev.event === "message") {
            let data: any;
            try { data = JSON.parse(ev.data); }
            catch { return; } // ignore malformed SSE frames

            if (data.type === "chunk") {
              // Accumulate raw chunks for parsing only — never render them.
              rawAssistantResponseRef.current += data.content || "";
              displayBufferRef.current += data.content || "";
              const accumulated = rawAssistantResponseRef.current;

              if (currentMode === "ask" || currentMode === "research") {
                // Stream the prose (+ any earlier tool heartbeats) into the
                // assistant bubble. ASK doesn't parse JSON. RESEARCH parses
                // at done time, not mid-stream — its JSON envelope is the
                // tail of the response, not the bulk.
                const display = displayBufferRef.current;
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last && last.role === "assistant") {
                    next[next.length - 1] = { ...last, content: display };
                  }
                  return next;
                });
                setStatusMessage(
                  currentMode === "ask" ? "Answering…" : "Writing strategy…",
                );
                return;
              }

              // Detect the worker's image/video-gen markers to update the
              // visible status (without showing the marker itself in chat).
              if (typeof data.content === "string" && data.content.includes(VIDEO_GEN_MARKER)) {
                setStatusMessage(PLACEHOLDER_VIDEO);
              } else if (typeof data.content === "string" && data.content.includes(IMAGE_GEN_MARKER)) {
                setStatusMessage(PLACEHOLDER_IMAGES);
              } else {
                setStatusMessage("Writing code…");
              }

              // Best-effort partial parse to update the live preview.
              try {
                const parsed = parseStreamToJSON(accumulated);
                if (parsed && parsed.files && Object.keys(parsed.files).length > 0) {
                  onUpdateFiles({ ...contextFilesRef.current, ...parsed.files });
                }
              } catch {
                // ignore — partial JSON is expected mid-stream
              }

            } else if (data.type === "tool") {
              // Tool-heartbeat chunk from the worker. Decorative only — never
              // contributes to rawAssistantResponseRef (would break JSON
              // parsing in build mode). For ASK / RESEARCH, append to the
              // visible bubble. For BUILD, surface as a status line.
              displayBufferRef.current += data.content || "";
              if (currentMode === "ask" || currentMode === "research") {
                const display = displayBufferRef.current;
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last && last.role === "assistant") {
                    next[next.length - 1] = { ...last, content: display };
                  }
                  return next;
                });
              }
              const toolName = typeof data.toolName === "string" ? data.toolName : "tool";
              setStatusMessage(`${toolName}…`);

            } else if (data.type === "done") {
              doneReceivedRef.current = true;

              // ASK mode: finalize with the streamed prose, do NOT touch files.
              if (currentMode === "ask" || data.mode === "ask") {
                const finalText =
                  (typeof data.aiMessage === "string" && data.aiMessage.trim()) ||
                  rawAssistantResponseRef.current.trim() ||
                  "(no response)";
                finalizeAssistantMessage(finalText);
                setStatusMessage("Done");
                return;
              }

              setStatusMessage(PLACEHOLDER_PARSING);

              // Flags from the worker that drive the taste/strategy UI.
              //   strategyGateAvailable — first scaffold + no prior research = offer the gate.
              //   strategyDocExists     — KV has a digest (or one was just written this turn).
              if (typeof data.strategyDocExists === "boolean") {
                setStrategyDocExists(data.strategyDocExists);
                if (data.strategyDocExists) {
                  // Clear cached digest so the modal re-fetches the fresh one.
                  setStrategyDigest(null);
                }
              }
              if (data.strategyGateAvailable === true) {
                setShowStrategyGate(true);
              }

              if (data.files && typeof data.files === "object") {
                onUpdateFiles(data.files);
                if (data.dependencies && onUpdateDependencies) {
                  onUpdateDependencies(data.dependencies);
                }
                const diff = summarizeChanges(filesAtSubmitRef.current, data.files);
                // If the worker provided an aiMessage (model's own no-op
                // explanation, or the prose the model returned when JSON
                // parsing failed), show that instead of the generic
                // "Try rephrasing your prompt" string.
                const aiMessage = typeof data.aiMessage === "string" ? data.aiMessage.trim() : "";
                // Research turns produce a Strategy.tsx file. Use a friendlier
                // summary than the generic "N new file" string.
                const summary =
                  currentMode === "research"
                    ? `Strategy drafted — open /strategy in the preview to read it. Future builds will use this as source-of-truth automatically.`
                    : aiMessage || buildDoneSummary(diff);
                finalizeAssistantMessage(summary);
              } else {
                finalizeAssistantMessage(
                  "Generation finished, but the response could not be parsed into files. Please try again."
                );
              }
              setStatusMessage("Done");

            } else if (data.type === "error") {
              const msg = typeof data.error === "string" && data.error ? data.error : "unknown error";
              finalizeAssistantMessage(`Generation failed: ${msg}`);
              setStatusMessage("Error");
            }
          } else if (ev.event === "error") {
            console.error("Stream error event:", ev.data);
            let msg = "unknown error";
            try {
              const parsed = JSON.parse(ev.data);
              if (parsed?.error) msg = String(parsed.error);
            } catch {}
            finalizeAssistantMessage(`Generation failed: ${msg}`);
            setStatusMessage("Error");
          }
        },
        onclose() {
          // Server closed the connection — normal after "done". Do NOT retry.
          if (watchdog) clearTimeout(watchdog);
        },
        onerror(err) {
          console.error("EventSource connection error:", err);
          // Throw to stop fetchEventSource's retry loop. The catch / finally
          // below will surface a clean error to the user.
          throw err;
        }
      });
    } catch (error) {
      console.error("Chat error:", error);
      if (stopReasonRef.current === "manual") {
        finalizeAssistantMessage("Stopped.");
        setStatusMessage("Stopped");
      } else if (stopReasonRef.current === "timeout") {
        finalizeAssistantMessage(
          "Generation timed out — the AI stopped responding. Please try again."
        );
        setStatusMessage("Timed out");
      } else {
        const msg = error instanceof Error ? error.message : "could not reach the worker";
        finalizeAssistantMessage(`Generation failed: ${msg}`);
        setStatusMessage("Error");
      }
    } finally {
      if (watchdog) clearTimeout(watchdog);
      abortRef.current = null;
      // If the user stopped or the watchdog timed out, finalize cleanly.
      // Covers the case where the abort resolves the stream instead of
      // throwing — without this, isGenerating could stay stuck.
      if (!finalizedRef.current && stopReasonRef.current) {
        finalizeAssistantMessage(
          stopReasonRef.current === "manual"
            ? "Stopped."
            : "Generation timed out — the AI stopped responding. Please try again."
        );
      }
      // Fallback: if the "done" event was dropped by fetchEventSource (it
      // sometimes is), reconstruct the result from the accumulated raw text.
      if (!doneReceivedRef.current && !finalizedRef.current && rawAssistantResponseRef.current) {
        // ASK mode: the raw text IS the answer. No JSON parsing needed.
        if (currentMode === "ask") {
          finalizeAssistantMessage(rawAssistantResponseRef.current.trim());
          setStatusMessage("Done");
        } else {
          try {
            const parsed = parseStreamToJSON(rawAssistantResponseRef.current);
            if (parsed && parsed.files && Object.keys(parsed.files).length > 0) {
              const merged = { ...contextFilesRef.current, ...parsed.files };
              onUpdateFiles(merged);
              if (parsed.dependencies && onUpdateDependencies) {
                onUpdateDependencies(parsed.dependencies);
              }
              const diff = summarizeChanges(filesAtSubmitRef.current, merged);
              finalizeAssistantMessage(buildDoneSummary(diff));
              setStatusMessage("Done");
            } else {
              finalizeAssistantMessage(
                "Generation finished, but the response could not be parsed into files. Please try again."
              );
            }
          } catch (e) {
            console.error("Fallback parsing failed:", e);
            finalizeAssistantMessage(
              "Generation finished, but the response could not be parsed into files. Please try again."
            );
          }
        }
      }
      setIsGenerating(false);
      setTimeout(() => setStatusMessage(""), 3000);
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      <StrategyModal
        open={strategyOpen}
        onClose={() => setStrategyOpen(false)}
        digest={strategyDigest}
        loading={strategyLoading}
      />
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 pb-20">
        {messages.length === 0 ? (
          <div className="flex gap-4 items-start">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 shrink-0">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div className="space-y-1 pt-1">
              <p className="text-sm font-medium text-white">HS Solutions AI</p>
              <div className="text-sm text-zinc-300">
                <p>Hello! I&apos;m ready to help you build. What would you like to create?</p>
                <p className="mt-2 text-zinc-500">Try saying: &ldquo;Create a modern landing page for a SaaS startup with a dark theme&rdquo;</p>
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <ChatMessage key={i} role={msg.role} content={msg.content} attachments={msg.attachments} />
          ))
        )}

        {showStrategyGate && !isGenerating && (
          <div className="flex gap-4 items-start">
            <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center border border-amber-500/30 shrink-0">
              <Brain className="w-4 h-4 text-amber-300" />
            </div>
            <div className="space-y-3 pt-0.5 max-w-xl">
              <p className="text-sm text-zinc-200 leading-relaxed">
                Want me to research the top sites in this niche first?
                I&rsquo;ll scrape the actual winners, derive the optimal
                section order, and build from real data instead of guessing.
                Takes about 3–5 minutes — but every future build uses it as
                source-of-truth.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={(e) =>
                    handleSubmit(e as unknown as React.FormEvent, "research", lastBuildPromptRef.current)
                  }
                  className="h-9 px-3.5 rounded-lg bg-amber-500/20 text-amber-100 border border-amber-500/40 hover:bg-amber-500/30 text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <Brain className="w-4 h-4" />
                  Run strategy first
                </button>
                <button
                  type="button"
                  onClick={() => setShowStrategyGate(false)}
                  className="h-9 px-3.5 rounded-lg bg-zinc-800 text-zinc-300 border border-white/10 hover:bg-zinc-700 text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <Rocket className="w-4 h-4" />
                  Skip — keep building
                </button>
              </div>
              <p className="text-[11px] text-zinc-500">
                You can always run research later from the chat.
              </p>
            </div>
          </div>
        )}
      </div>

      {(isGenerating || statusMessage) && (
        <div className="absolute bottom-[160px] left-1/2 -translate-x-1/2 z-10 w-full max-w-[90%] px-4">
          <GenerationProgress
            isGenerating={isGenerating}
            message={statusMessage || "Processing…"}
            className="w-full shadow-[0_0_30px_rgba(0,0,0,0.8)]"
          />
        </div>
      )}

      <div className="p-4 border-t border-white/5 bg-zinc-950/80 backdrop-blur-xl shrink-0 z-20 relative">
        <form
          onSubmit={(e) => handleSubmit(e, "build")}
          className="relative rounded-xl border border-white/10 bg-zinc-900/50 focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all overflow-hidden p-2"
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask a question, or describe what to build..."
            className="w-full bg-transparent border-0 focus:ring-0 text-sm text-white resize-none min-h-[60px] max-h-[200px] p-2 placeholder:text-zinc-500 focus-visible:outline-none"
            onKeyDown={(e) => {
              // Enter alone → BUILD (primary action, preserves existing UX)
              // Shift+Enter → newline. Ctrl/Cmd+Enter → ASK.
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSubmit(e, "ask");
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e, "build");
              }
            }}
          />

          {/* Attachments preview — full-width row above the controls. */}
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((slot) => (
                <div key={slot.id} className="relative inline-block" title={slot.filename}>
                  <img
                    src={slot.dataUrl}
                    alt={slot.filename}
                    className={`h-16 w-16 object-cover rounded-md border border-white/10 ${slot.status !== "uploaded" ? "opacity-60" : ""}`}
                  />
                  {slot.status === "uploading" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-md">
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                    </div>
                  )}
                  {slot.status === "failed" && (
                    <div
                      className="absolute inset-0 flex items-center justify-center bg-red-900/60 rounded-md"
                      title={slot.errorMessage || "Upload failed — vision only"}
                    >
                      <AlertCircle className="w-4 h-4 text-red-200" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(slot.id)}
                    className="absolute -top-2 -right-2 bg-zinc-800 text-white rounded-full p-0.5 border border-white/10 hover:bg-zinc-700"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              ))}
              {previousModel && (
                <div className="w-full flex items-center gap-1 text-[10px] text-blue-400">
                  <Eye className="w-3 h-3" />
                  <span>Vision model active</span>
                </div>
              )}
              {attachments.some((s) => s.status === "uploading") && (
                <div className="w-full flex items-center gap-1 text-[10px] text-zinc-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Uploading attachments… submit will unlock when done.</span>
                </div>
              )}
              {attachments.some((s) => s.status === "failed") && (
                <div className="w-full flex items-center gap-1 text-[10px] text-red-400">
                  <AlertCircle className="w-3 h-3" />
                  <span>One or more uploads failed. The AI can still SEE these images, but it can&apos;t embed them on the site.</span>
                </div>
              )}
            </div>
          )}

          {/*
            Compose controls — two rows so nothing is crammed:
              ROW A (config)   Model · 🎨 Taste · 📋 Strategy (conditional)
              ROW B (actions)  📎 Attach   |   💬 Ask · 🧠 Research · 🎬 Cinematic · 🔨 Build/Stop

            Width never has to grow: the actions row keeps a fixed compact
            layout, and the config row wraps cleanly on narrow widths.
          */}
          <div className="mt-2 pt-2 border-t border-white/5 bg-transparent space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <ModelSelector
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                disabled={isGenerating}
              />
              <TasteToggle
                enabled={tasteEnabled}
                onToggle={handleTasteToggle}
                disabled={isGenerating}
              />
              {strategyDocExists && (
                <button
                  type="button"
                  onClick={openStrategyModal}
                  disabled={isGenerating}
                  title="View the Outlier Research strategy digest. Injected into every Build as source-of-truth."
                  className="h-8 px-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  Strategy
                </button>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-zinc-400 hover:text-white rounded-lg"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach images"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!prompt.trim() || isGenerating || hasUploadingAttachment}
                  onClick={(e) => handleSubmit(e as unknown as React.FormEvent, "ask")}
                  className="h-8 px-3 rounded-lg bg-zinc-800 text-white border border-white/10 hover:bg-zinc-700 disabled:opacity-50"
                  title={hasUploadingAttachment ? "Waiting for attachments to finish uploading…" : "Discuss without making any code changes (Ctrl+Enter)"}
                >
                  <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                  Ask
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!prompt.trim() || isGenerating || hasUploadingAttachment}
                  onClick={(e) => handleSubmit(e as unknown as React.FormEvent, "research")}
                  className="h-8 px-3 rounded-lg bg-amber-500/20 text-amber-100 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50"
                  title="Outlier Research Engine — scrape the top sites in this niche and build a Strategy.tsx as source-of-truth (~3–5 min)."
                >
                  <Brain className="w-3.5 h-3.5 mr-1.5" />
                  Research
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!prompt.trim() || isGenerating || hasUploadingAttachment}
                  onClick={(e) => handleSubmit(e as unknown as React.FormEvent, "cinematic")}
                  className="h-8 px-3 rounded-lg bg-fuchsia-500/20 text-fuchsia-100 border border-fuchsia-500/40 hover:bg-fuchsia-500/30 disabled:opacity-50"
                  title="Cinematic Magazine Engine — dark-magazine page with a real Kling 5s hero video + fal.ai stills (blog, landing, or homepage; ~4 min)."
                >
                  <Film className="w-3.5 h-3.5 mr-1.5" />
                  Cinematic
                </Button>
                {isGenerating ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleStop}
                    className="h-8 px-3 rounded-lg bg-red-600 text-white hover:bg-red-700"
                    title="Stop the current generation"
                  >
                    <Square className="w-3.5 h-3.5 mr-1.5 fill-current" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!prompt.trim() || hasUploadingAttachment}
                    className="h-8 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    title={hasUploadingAttachment ? "Waiting for attachments to finish uploading…" : "Modify the code (Enter)"}
                  >
                    <Hammer className="w-3.5 h-3.5 mr-1.5" />
                    Build
                  </Button>
                )}
              </div>
            </div>
          </div>
        </form>
        <div className="text-center mt-3">
          <p className="text-[10px] text-zinc-500">
            AI can make mistakes. Verify code before deploying.
          </p>
        </div>
      </div>
    </div>
  );
}