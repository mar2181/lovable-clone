"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, Paperclip, Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModelSelector } from "@/components/editor/model-selector";
import { ChatMessage, ChatMessageProps } from "@/components/editor/chat-message";
import { GenerationProgress } from "@/components/editor/generation-progress";
import { DEFAULT_MODEL, VISION_MODEL, AI_MODELS } from "@/lib/models";
import { useAuth } from "@/lib/dev-auth";
import { WORKER_URL } from "@/lib/constants";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { parseStreamToJSON } from "@/lib/file-parser";

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

// Marker the worker injects into the chunk stream when it switches from
// streaming model output to running fal.ai image generation. We detect it
// to update the visible status, but we don't render it in the chat bubble.
const IMAGE_GEN_MARKER = "Generating AI images";

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
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [previousModel, setPreviousModel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();

  // Raw streamed assistant response — used for parsing only, NEVER rendered.
  const rawAssistantResponseRef = useRef("");
  // Snapshot of the file map BEFORE this generation, for diff-based summaries.
  const filesAtSubmitRef = useRef<Record<string, string>>({});
  // Tracks whether we've already finalized the assistant message
  // (so the finally block doesn't overwrite a real done/error message).
  const finalizedRef = useRef(false);
  const doneReceivedRef = useRef(false);

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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  const MAX_IMAGES = 10;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const remaining = MAX_IMAGES - attachedImages.length;
    const toProcess = files.slice(0, remaining);

    if (files.length > remaining) {
      alert(`You can attach up to ${MAX_IMAGES} images. Only the first ${remaining} will be added.`);
    }

    toProcess.forEach(file => {
      if (file.size > 5 * 1024 * 1024) {
        alert(`"${file.name}" is larger than 5MB and was skipped.`);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachedImages(prev => {
          if (prev.length >= MAX_IMAGES) return prev;
          const next = [...prev, reader.result as string];
          // Auto-switch to vision model once first image is attached
          if (next.length === 1) {
            const currentModelInfo = AI_MODELS.find(m => m.id === selectedModel);
            if (currentModelInfo && !currentModelInfo.vision) {
              setPreviousModel(selectedModel);
              setSelectedModel(VISION_MODEL);
            }
          }
          return next;
        });
      };
      reader.readAsDataURL(file);
    });

    // Reset input so same files can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachedImages(prev => {
      const next = prev.filter((_, i) => i !== index);
      // Restore previous model if all images removed
      if (next.length === 0 && previousModel) {
        setSelectedModel(previousModel);
        setPreviousModel(null);
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    const userMessage = prompt;
    const currentImages = [...attachedImages];

    setPrompt("");
    setAttachedImages([]);
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsGenerating(true);
    setStatusMessage("Connecting to AI…");
    rawAssistantResponseRef.current = "";
    doneReceivedRef.current = false;
    finalizedRef.current = false;
    // Snapshot the pre-generation file set so we can summarize the diff at done.
    filesAtSubmitRef.current = { ...contextFilesRef.current };

    try {
      const token = await getToken();

      // Append the assistant placeholder. This is what the user sees while
      // the stream runs — NOT the raw JSON.
      setMessages((prev) => [...prev, { role: "assistant", content: PLACEHOLDER_GENERATING }]);

      await fetchEventSource(`${WORKER_URL}/api/chat/${projectId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          prompt: userMessage,
          model: selectedModel,
          contextFiles: contextFiles,
          imagesBase64: currentImages
        }),
        async onopen() {
          setStatusMessage("AI is generating code…");
        },
        onmessage(ev) {
          if (ev.event === "message") {
            let data: any;
            try { data = JSON.parse(ev.data); }
            catch { return; } // ignore malformed SSE frames

            if (data.type === "chunk") {
              // Accumulate raw chunks for parsing only — never render them.
              rawAssistantResponseRef.current += data.content || "";
              const accumulated = rawAssistantResponseRef.current;

              // Detect the worker's image-gen marker to update the visible
              // status (without showing the marker itself in chat).
              if (typeof data.content === "string" && data.content.includes(IMAGE_GEN_MARKER)) {
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

            } else if (data.type === "done") {
              doneReceivedRef.current = true;
              setStatusMessage(PLACEHOLDER_PARSING);

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
                finalizeAssistantMessage(aiMessage || buildDoneSummary(diff));
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
      const msg = error instanceof Error ? error.message : "could not reach the worker";
      finalizeAssistantMessage(`Generation failed: ${msg}`);
      setStatusMessage("Error");
    } finally {
      // Fallback: if the "done" event was dropped by fetchEventSource (it
      // sometimes is), reconstruct the result from the accumulated raw text.
      if (!doneReceivedRef.current && !finalizedRef.current && rawAssistantResponseRef.current) {
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
      setIsGenerating(false);
      setTimeout(() => setStatusMessage(""), 3000);
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 pb-20">
        {messages.length === 0 ? (
          <div className="flex gap-4 items-start">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 shrink-0">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div className="space-y-1 pt-1">
              <p className="text-sm font-medium text-white">Lovable AI</p>
              <div className="text-sm text-zinc-300">
                <p>Hello! I&apos;m ready to help you build. What would you like to create?</p>
                <p className="mt-2 text-zinc-500">Try saying: &ldquo;Create a modern landing page for a SaaS startup with a dark theme&rdquo;</p>
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <ChatMessage key={i} role={msg.role} content={msg.content} />
          ))
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
          onSubmit={handleSubmit}
          className="relative rounded-xl border border-white/10 bg-zinc-900/50 focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all overflow-hidden p-2"
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want to build..."
            className="w-full bg-transparent border-0 focus:ring-0 text-sm text-white resize-none min-h-[60px] max-h-[200px] p-2 placeholder:text-zinc-500 focus-visible:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5 bg-transparent">
            {attachedImages.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachedImages.map((img, idx) => (
                  <div key={idx} className="relative inline-block">
                    <img src={img} alt={`Attachment ${idx + 1}`} className="h-16 w-16 object-cover rounded-md border border-white/10" />
                    <button
                      type="button"
                      onClick={() => removeAttachment(idx)}
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
              </div>
            )}
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
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <ModelSelector
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                disabled={isGenerating}
              />
            </div>

            <Button
              type="submit"
              size="icon"
              disabled={!prompt.trim() || isGenerating}
              className="h-8 w-8 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
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