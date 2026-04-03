"use client";

import { useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonitorPlay, Code2, History, RotateCcw, CheckCircle, XCircle, Loader2, Trash2 } from "lucide-react";
import { PreviewPanel } from "@/components/editor/preview-panel";
import { CodeEditorPanel } from "@/components/editor/code-editor-panel";
import { HistoryPanel } from "@/components/editor/history-panel";
import { WORKER_URL } from "@/lib/constants";

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
        alert("Worker is DOWN. Open a terminal in the worker folder and run:\n\nnpx wrangler dev --port 8787 --persist-to C:\\Users\\mario\\.wrangler-state\n\nThen click Recovery again.");
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
      alert("Worker is not responding. Restart it in your terminal:\n\nnpx wrangler dev --port 8787");
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
            <PreviewPanel files={files} dependencies={dependencies} />
          </TabsContent>

          <TabsContent value="code" className="h-full m-0 absolute inset-0">
            <CodeEditorPanel files={files} onFileChange={onFileChange} />
          </TabsContent>

          <TabsContent value="history" className="h-full m-0 absolute inset-0">
            <HistoryPanel
              projectId={projectId}
              onRestore={(f, d) => onRestore && onRestore(f, d)}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
