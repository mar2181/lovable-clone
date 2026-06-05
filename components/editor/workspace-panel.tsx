"use client";

import { useState, useCallback, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonitorPlay, Code2, History, RotateCcw, CheckCircle, XCircle, Loader2, Trash2, ClipboardList, RefreshCw, ExternalLink } from "lucide-react";
import { PreviewPanel } from "@/components/editor/preview-panel";
import { CodeEditorPanel } from "@/components/editor/code-editor-panel";
import { HistoryPanel } from "@/components/editor/history-panel";
import { useAuth } from "@/lib/dev-auth";
import { WORKER_URL } from "@/lib/constants";

// ── Worker Output panel ──────────────────────────────────────────────────
// Surfaces the per-project research artifacts produced by the Outlier Research
// Engine: the strategy_digest (an executive blueprint stored at KV
// project:ID:strategy_digest) plus any source links cited inside it.
//
// Reads the existing worker route GET /api/projects/:id/strategy, which returns
// { exists: boolean, digest?: string }. No new worker route is required.

// Pull http(s) URLs out of the digest so we can list the scraped sources the
// research engine cited. De-duped, trailing punctuation trimmed.
function extractSources(digest: string): string[] {
  const matches = digest.match(/https?:\/\/[^\s)\]"'<>]+/g) || [];
  const cleaned = matches.map((u) => u.replace(/[.,;:)\]]+$/, ""));
  return Array.from(new Set(cleaned));
}

function WorkerOutputPanel({ projectId }: { projectId: string }) {
  const { getToken } = useAuth();
  const [digest, setDigest] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDigest = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/projects/${projectId}/strategy`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDigest(data.exists ? (data.digest ?? null) : null);
      } else {
        setError(`Worker returned ${res.status}`);
        setDigest(null);
      }
    } catch (err) {
      console.error("Failed to fetch worker output:", err);
      setError("Worker is not responding.");
      setDigest(null);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, getToken]);

  useEffect(() => {
    fetchDigest();
  }, [fetchDigest]);

  const sources = digest ? extractSources(digest) : [];

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="h-12 border-b border-white/5 flex items-center justify-between px-4 shrink-0 bg-zinc-950/50">
        <div className="flex items-center gap-2 text-zinc-300">
          <ClipboardList className="w-4 h-4" />
          <span className="text-sm font-medium">Worker Output</span>
        </div>
        <button
          onClick={fetchDigest}
          disabled={isLoading}
          className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          title="Refresh worker output"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && digest === null ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <XCircle className="w-12 h-12 text-zinc-800 mb-4" />
            <p className="text-zinc-400 font-medium">Couldn&rsquo;t load worker output</p>
            <p className="text-zinc-500 text-sm mt-1">{error}</p>
          </div>
        ) : !digest ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <ClipboardList className="w-12 h-12 text-zinc-800 mb-4" />
            <p className="text-zinc-400 font-medium">No worker output yet</p>
            <p className="text-zinc-500 text-sm mt-1">
              Run the Outlier Research Engine from the chat to generate a strategy
              digest and scraped sources for this project.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
                Research strategy digest produced by the Outlier Research Engine.
                It is automatically injected into every Build prompt as
                source-of-truth.
              </p>
              <pre className="whitespace-pre-wrap break-words text-xs text-zinc-200 font-mono leading-relaxed bg-black/30 rounded-md p-3 border border-white/5">
                {digest}
              </pre>
            </div>

            {sources.length > 0 && (
              <div>
                <h3 className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                  Scraped sources ({sources.length})
                </h3>
                <ul className="space-y-1">
                  {sources.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200 transition-colors break-all"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        <span className="truncate">{url}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface WorkspacePanelProps {
  projectId: string;
  files: Record<string, string>;
  dependencies?: Record<string, string>;
  onFileChange?: (filename: string, content: string) => void;
  onRestore?: (files: Record<string, string>, deps: Record<string, string>) => void;
}

export function WorkspacePanel({ projectId, files, dependencies, onFileChange, onRestore }: WorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState("preview");
  const [recoveryState, setRecoveryState] = useState<"idle" | "checking" | "ok" | "error">("idle");

  const handleReset = useCallback(() => {
    const confirmed = window.confirm(
      "This will WIPE all current files and let you start fresh with a new prompt.\n\n" +
      "Your version history is preserved — you can restore any previous version from the History tab.\n\n" +
      "Continue?"
    );
    if (!confirmed) return;
    // Clear all files so the next prompt triggers scaffold mode (no contextFiles)
    if (onRestore) onRestore({}, {});
  }, [onRestore]);

  const handleRecovery = useCallback(async () => {
    setRecoveryState("checking");

    try {
      // Step 1: Check if the worker is alive
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${WORKER_URL}/`, { signal: controller.signal }).catch(() => null);
      clearTimeout(timeout);

      if (!res || !res.ok) {
        setRecoveryState("error");
        alert("Worker is DOWN. From the project root run:\n\nnpm run dev:worker\n\n(worker listens on port 8788). Then click Recovery again.");
        setTimeout(() => setRecoveryState("idle"), 3000);
        return;
      }

      // Step 2: Force refresh the Sandpack preview by switching away and back
      setActiveTab("code");
      await new Promise(r => setTimeout(r, 200));
      setActiveTab("preview");

      setRecoveryState("ok");
      setTimeout(() => setRecoveryState("idle"), 2000);
    } catch {
      setRecoveryState("error");
      alert("Worker is not responding. From the project root run: npm run dev:worker (port 8788).");
      setTimeout(() => setRecoveryState("idle"), 3000);
    }
  }, []);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        <div className="h-12 border-b border-white/5 px-4 flex items-center justify-between bg-zinc-950/50 shrink-0">
          <TabsList className="bg-transparent border-0 h-full p-0 space-x-4">
            <TabsTrigger
              value="preview"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-white rounded-none h-full px-2 text-zinc-400"
            >
              <MonitorPlay className="w-4 h-4 mr-2" />
              Preview
            </TabsTrigger>
            <TabsTrigger
              value="code"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-white rounded-none h-full px-2 text-zinc-400"
            >
              <Code2 className="w-4 h-4 mr-2" />
              Code
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-white rounded-none h-full px-2 text-zinc-400"
            >
              <History className="w-4 h-4 mr-2" />
              History
            </TabsTrigger>
            <TabsTrigger
              value="worker"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-white rounded-none h-full px-2 text-zinc-400"
            >
              <ClipboardList className="w-4 h-4 mr-2" />
              Worker
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            {/* Reset Button — wipes files so next prompt scaffolds from scratch */}
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all border border-white/10 hover:border-red-500/50 hover:bg-red-500/10 text-zinc-400 hover:text-red-400"
              title="Wipe current files and start fresh (history preserved)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Reset
            </button>

            {/* Recovery Button */}
            <button
              onClick={handleRecovery}
              disabled={recoveryState === "checking"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all border border-white/10 hover:border-amber-500/50 hover:bg-amber-500/10 text-zinc-400 hover:text-amber-400 disabled:opacity-50"
              title="Check worker health and refresh preview"
            >
              {recoveryState === "checking" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {recoveryState === "ok" && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
              {recoveryState === "error" && <XCircle className="w-3.5 h-3.5 text-red-400" />}
              {recoveryState === "idle" && <RotateCcw className="w-3.5 h-3.5" />}
              Recovery
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden relative">
          <TabsContent value="preview" className="h-full m-0 absolute inset-0">
            <PreviewPanel
              files={files}
              dependencies={dependencies}
              projectId={projectId}
              onInlineApplied={(f, d) => {
                if (onRestore) onRestore(f, d);
              }}
              onOpenCode={() => setActiveTab("code")}
            />
          </TabsContent>

          <TabsContent value="code" className="h-full m-0 absolute inset-0">
            <CodeEditorPanel files={files} onFileChange={onFileChange} />
          </TabsContent>

          <TabsContent value="history" className="h-full m-0 absolute inset-0">
            <HistoryPanel
              projectId={projectId}
              onRestore={(f, d) => {
                if (onRestore) onRestore(f, d);
                // Jump to the preview so the restored version is visible
                setActiveTab("preview");
              }}
            />
          </TabsContent>

          <TabsContent value="worker" className="h-full m-0 absolute inset-0">
            <WorkerOutputPanel projectId={projectId} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
