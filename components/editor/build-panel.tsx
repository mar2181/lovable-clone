"use client";

import { useState, useRef } from "react";
import {
  Layers,
  Loader2,
  CheckCircle2,
  Circle,
  AlertCircle,
  Play,
  ChevronDown,
  ChevronUp,
  FileCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/dev-auth";
import { WORKER_URL } from "@/lib/constants";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { cn } from "@/lib/utils";

interface BuildPanelProps {
  projectId: string;
  contextFiles: Record<string, string>;
  onUpdateFiles: (files: Record<string, string>) => void;
}

interface PageStatus {
  name: string;
  status: "pending" | "generating" | "done" | "error";
}

type PageStatusMap = Record<string, PageStatus>;

export function BuildPanel({ projectId, contextFiles, onUpdateFiles }: BuildPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [buildPlanJson, setBuildPlanJson] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildStatus, setBuildStatus] = useState("");
  const [pages, setPages] = useState<PageStatusMap>({});
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [completedPages, setCompletedPages] = useState(0);
  const [streamOutput, setStreamOutput] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { getToken } = useAuth();

  const filesRef = useRef(contextFiles);
  filesRef.current = contextFiles;
  // Abort handle so a hung/dropped build stream can't leave isBuilding stuck
  // true — which would lock this dialog open with no way to close it.
  const abortRef = useRef<AbortController | null>(null);

  const handleBuild = async () => {
    if (isBuilding) return;

    // Must have either a description or a build plan
    if (!description.trim() && !buildPlanJson.trim()) {
      alert("Enter a description or paste a build plan JSON to start building.");
      return;
    }

    setIsBuilding(true);
    setBuildStatus("Starting build...");
    setPages({});
    setCurrentBatch(0);
    setTotalBatches(0);
    setTotalPages(0);
    setCompletedPages(0);
    setStreamOutput("");

    // Abort controller + stall watchdog so a dropped/hung stream can't leave
    // isBuilding stuck true (which locks this dialog open with no way out).
    const controller = new AbortController();
    abortRef.current = controller;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), 180_000);
    };

    try {
      const token = await getToken();

      // Build the request body
      const body: Record<string, any> = {};

      if (buildPlanJson.trim()) {
        try {
          body.buildPlan = JSON.parse(buildPlanJson);
        } catch (e) {
          alert("Invalid build plan JSON. Check the format and try again.");
          setIsBuilding(false);
          return;
        }
      } else {
        body.description = description;
      }

      body.existingFiles = filesRef.current;

      armWatchdog();
      await fetchEventSource(`${WORKER_URL}/api/build/${projectId}`, {
        method: "POST",
        signal: controller.signal,
        // Keep streaming when the tab is backgrounded — otherwise the build
        // connection is dropped the moment the tab loses focus.
        openWhenHidden: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        async onopen() {
          armWatchdog();
          setBuildStatus("Connected. Waiting for AI...");
        },
        onmessage(ev) {
          armWatchdog();
          if (ev.event !== "message") return;

          try {
            const data = JSON.parse(ev.data);

            switch (data.type) {
              case "build_start":
                setTotalPages(data.totalPages);
                setTotalBatches(data.totalBatches);
                setBuildStatus(`Building ${data.totalPages} pages in ${data.totalBatches} batches...`);
                break;

              case "batch_start":
                setCurrentBatch(data.batchIndex + 1);
                setBuildStatus(`Batch ${data.batchIndex + 1}/${data.totalBatches}: ${data.pages.join(", ")}`);
                // Mark these pages as generating
                setPages((prev) => {
                  const next = { ...prev };
                  for (const pageName of data.pages) {
                    next[pageName] = { name: pageName, status: "generating" };
                  }
                  return next;
                });
                setStreamOutput("");
                break;

              case "batch_stream":
                setStreamOutput((prev) => prev + data.content);
                break;

              case "batch_done":
                // Update files in the editor
                if (data.files) {
                  onUpdateFiles(data.files);
                }
                break;

              case "page_status":
                setPages((prev) => ({
                  ...prev,
                  [data.page]: { name: data.page, status: data.status },
                }));
                if (data.status === "done") {
                  setCompletedPages((prev) => prev + 1);
                }
                break;

              case "build_complete":
                setBuildStatus(`Done! ${data.totalPages} pages built.`);
                if (data.files) {
                  onUpdateFiles(data.files);
                }
                // Mark all pages as done
                setPages((prev) => {
                  const next = { ...prev };
                  for (const key of Object.keys(next)) {
                    if (next[key].status === "generating" || next[key].status === "pending") {
                      next[key] = { ...next[key], status: "done" };
                    }
                  }
                  return next;
                });
                break;

              case "error":
                setBuildStatus(`Error: ${data.error}`);
                break;
            }
          } catch (e) {
            console.error("Failed to parse build event:", e);
          }
        },
        onclose() {
          if (watchdog) clearTimeout(watchdog);
          setIsBuilding(false);
        },
        onerror(err) {
          console.error("Build SSE error:", err);
          setBuildStatus("Connection error — check console");
          throw err;
        },
      });
    } catch (error) {
      console.error("Build error:", error);
      setBuildStatus(
        controller.signal.aborted
          ? "Build stopped."
          : "Build failed — check console"
      );
    } finally {
      if (watchdog) clearTimeout(watchdog);
      abortRef.current = null;
      setIsBuilding(false);
      setTimeout(() => setStreamOutput(""), 5000);
    }
  };

  const handleStopBuild = () => {
    abortRef.current?.abort();
  };

  const pageList = Object.values(pages);
  const hasStarted = pageList.length > 0 || isBuilding;

  return (
    <>
      {/* Trigger Button */}
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "h-8 bg-white/5 border-white/10 hover:border-white/30",
          isBuilding && "border-amber-500/50 text-amber-400"
        )}
        onClick={() => setIsOpen(true)}
        disabled={isBuilding}
      >
        {isBuilding ? (
          <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
        ) : (
          <Layers className="w-3.5 h-3.5 mr-2" />
        )}
        {isBuilding ? `Building ${completedPages}/${totalPages}` : "Build"}
      </Button>

      {/* Build Panel Dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-white/10 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-semibold text-white">Ralph Loop — Multi-Page Builder</h2>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Build Input */}
              {!hasStarted && (
                <>
                  <div>
                    <label className="text-sm font-medium text-zinc-300 block mb-2">
                      Describe your website
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="e.g. A bilingual insurance agency website in McAllen TX. Auto, home, commercial, life insurance pages. Professional blue theme."
                      className="w-full h-24 bg-zinc-800 border border-white/10 rounded-lg p-3 text-sm text-white placeholder:text-zinc-500 resize-none focus:outline-none focus:border-amber-500/50"
                      disabled={isBuilding}
                    />
                  </div>

                  <div>
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
                    >
                      {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      Advanced: paste a build plan JSON
                    </button>
                    {showAdvanced && (
                      <textarea
                        value={buildPlanJson}
                        onChange={(e) => setBuildPlanJson(e.target.value)}
                        placeholder='{"businessName": "...", "pages": [...], "designSystem": {...}}'
                        className="w-full h-40 bg-zinc-800 border border-white/10 rounded-lg p-3 text-xs text-zinc-300 placeholder:text-zinc-600 resize-none mt-2 font-mono focus:outline-none focus:border-amber-500/50"
                        disabled={isBuilding}
                      />
                    )}
                  </div>
                </>
              )}

              {/* Build Progress */}
              {hasStarted && (
                <>
                  {/* Status bar */}
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-zinc-300">{buildStatus}</span>
                      {isBuilding && <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />}
                    </div>
                    {totalBatches > 0 && (
                      <div className="text-xs text-zinc-500">
                        Batch {currentBatch}/{totalBatches} · {completedPages}/{totalPages} pages
                      </div>
                    )}
                    {/* Progress bar */}
                    {totalPages > 0 && (
                      <div className="mt-2 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all duration-500"
                          style={{ width: `${(completedPages / totalPages) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Page list */}
                  {pageList.length > 0 && (
                    <div className="space-y-1">
                      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Pages</h3>
                      <div className="space-y-1">
                        {pageList.map((page) => (
                          <div
                            key={page.name}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
                              page.status === "generating" && "bg-amber-500/10 text-amber-300",
                              page.status === "done" && "text-zinc-400",
                              page.status === "error" && "bg-red-500/10 text-red-400",
                              page.status === "pending" && "text-zinc-500"
                            )}
                          >
                            {page.status === "generating" && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />}
                            {page.status === "done" && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                            {page.status === "error" && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                            {page.status === "pending" && <Circle className="w-3.5 h-3.5" />}
                            <FileCode className="w-3.5 h-3.5 opacity-50" />
                            <span>{page.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Streaming output */}
                  {streamOutput && (
                    <div className="bg-zinc-950 rounded-lg p-3 max-h-32 overflow-y-auto">
                      <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap break-all">
                        {streamOutput.slice(-2000)}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-4 border-t border-white/5">
              <span className="text-xs text-zinc-500">
                {hasStarted
                  ? isBuilding
                    ? "Building..."
                    : "Build complete"
                  : "Generates all pages in batches via AI"}
              </span>
              <div className="flex gap-2">
                {isBuilding && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleStopBuild}
                    className="text-red-400 hover:text-red-300"
                  >
                    Stop
                  </Button>
                )}
                {!hasStarted && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsOpen(false)}
                    className="text-zinc-400"
                  >
                    Cancel
                  </Button>
                )}
                {!hasStarted && (
                  <Button
                    size="sm"
                    onClick={handleBuild}
                    disabled={isBuilding || (!description.trim() && !buildPlanJson.trim())}
                    className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
                  >
                    <Play className="w-3.5 h-3.5 mr-2" />
                    Start Build
                  </Button>
                )}
                {hasStarted && !isBuilding && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsOpen(false);
                      setPages({});
                      setBuildStatus("");
                    }}
                    className="text-zinc-400"
                  >
                    Close
                  </Button>
                )}
                {hasStarted && !isBuilding && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setPages({});
                      setBuildStatus("");
                      setCompletedPages(0);
                      handleBuild();
                    }}
                    className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
                  >
                    <Play className="w-3.5 h-3.5 mr-2" />
                    Rebuild
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
