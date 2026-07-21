"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@/lib/dev-auth";
import { ChatPanel } from "@/components/editor/chat-panel";
import { WorkspacePanel } from "@/components/editor/workspace-panel";
import { MapModeController } from "@/components/editor/map-mode-controller";
import { EditorHeader } from "@/components/editor/editor-header";
import { ProjectMemory } from "@/components/editor/project-memory";
import { SupabaseButton } from "@/components/editor/supabase-button";
import { SupabaseModal } from "@/components/editor/supabase-modal";
import { SupabaseStatusMenu } from "@/components/editor/supabase-status-menu";
import { SupabaseSchemaPanel } from "@/components/editor/supabase-schema-panel";
import { SupabaseBanner } from "@/components/editor/supabase-banner";
import { getConnectStatus, type SupabaseLinkInfo } from "@/lib/supabase-client";
import { WORKER_URL } from "@/lib/constants";

export function EditorShell({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [dependencies, setDependencies] = useState<Record<string, string>>({});
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(400); // pixels
  const [supabaseLink, setSupabaseLink] = useState<SupabaseLinkInfo | null>(null);
  const [supabaseModalOpen, setSupabaseModalOpen] = useState(false);
  const [supabaseMenuOpen, setSupabaseMenuOpen] = useState(false);
  const [supabaseSchemaOpen, setSupabaseSchemaOpen] = useState(false);
  const [supabasePatMissing, setSupabasePatMissing] = useState(false);
  const isDragging = useRef(false);
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();

  // --- Manual-edit persistence (Phase 0) ------------------------------------
  // Hand edits (Monaco, and the click-to-edit surface coming in Phase 1) used to
  // live only in React state and vanished on reload. We now debounce-save them to
  // the append-only version store via POST /api/versions/:projectId.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const hydratedRef = useRef(false);   // true once the initial version has loaded
  const filesRef = useRef(files);      // latest files, read at flush time
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  filesRef.current = files;

  const persistFiles = useCallback(async () => {
    // Never write before the project has hydrated (would fork an empty version)
    // or with nothing loaded.
    if (!hydratedRef.current || Object.keys(filesRef.current).length === 0) return;
    setSaveState("saving");
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/versions/${projectId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ files: filesRef.current, message: "Manual edit" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveState("saved");
      if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
      savedFlashRef.current = setTimeout(() => setSaveState("idle"), 1800);
    } catch (err) {
      console.error("Failed to save manual edit:", err);
      setSaveState("error");   // fail-visibly — the pill turns red, edit stays in state
    }
  }, [projectId, getToken]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    // Coalesce a burst of keystrokes/inline edits into one version.
    saveTimerRef.current = setTimeout(() => { void persistFiles(); }, 1500);
  }, [persistFiles]);

  // Flush any pending save on unmount so a quick close doesn't drop the last edit.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        void persistFiles();
      }
      if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
    };
  }, [persistFiles]);

  useEffect(() => {
    async function loadProject() {
      try {
        const token = await getToken();
        const res = await fetch(`${WORKER_URL}/api/versions/${projectId}/latest`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          if (data.version && data.version.files) {
            setFiles(data.version.files);
            if (data.version.dependencies) {
              setDependencies(data.version.dependencies);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load project files:", err);
      } finally {
        // Autosave is armed only after the first load settles, so restoring the
        // current version never spawns a duplicate.
        hydratedRef.current = true;
      }
    }
    loadProject();
  }, [projectId, getToken]);

  // Refresh the Dashboard thumbnail (hero image) once when the editor opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        await fetch(`${WORKER_URL}/api/projects/${projectId}/thumbnail`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Non-critical — thumbnail just won't refresh this visit.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, getToken]);

  useEffect(() => {
    async function probeSupabase() {
      try {
        const token = await getToken();
        if (!token) return;
        const status = await getConnectStatus(token, projectId);
        setSupabasePatMissing(!status.patConfigured);
        if (status.linked && status.link) {
          setSupabaseLink(status.link);
        }
      } catch {
        // Swallow — the banner stays hidden if the probe itself fails.
      }
    }
    probeSupabase();
  }, [projectId, getToken]);

  const handleFileChange = (filename: string, content: string) => {
    setFiles(prev => {
      const next = { ...prev, [filename]: content };
      filesRef.current = next;   // so a flush right now sees this edit
      return next;
    });
    scheduleSave();
  };

  const handleRestore = (restoredFiles: Record<string, string>, restoredDeps: Record<string, string>) => {
    setFiles(restoredFiles);
    if (Object.keys(restoredDeps).length > 0) {
      setDependencies(restoredDeps);
    }
  };

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    setResizing(true); // mounts a full-window overlay so the Sandpack iframe
                       // can't swallow mousemove mid-drag (the real "bad control" bug)
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      // Clamp: down to 280px, up to 80% of the container — full control.
      const maxWidth = containerRect.width * 0.8;
      setChatWidth(Math.max(280, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        setResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const supabaseSlot = (
    <div className="relative">
      <SupabaseButton
        projectId={projectId}
        onOpenModal={() => setSupabaseModalOpen(true)}
        onOpenMenu={() => setSupabaseMenuOpen((v) => !v)}
        onLinkUpdate={setSupabaseLink}
      />
      {supabaseLink && (
        <SupabaseStatusMenu
          projectId={projectId}
          link={supabaseLink}
          open={supabaseMenuOpen}
          onClose={() => setSupabaseMenuOpen(false)}
          onUnlinked={() => setSupabaseLink(null)}
          onViewSchema={() => setSupabaseSchemaOpen(true)}
        />
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-screen w-full bg-zinc-950 text-foreground">
      <EditorHeader projectId={projectId} onOpenMemory={() => setIsMemoryOpen(true)} contextFiles={files} onUpdateFiles={setFiles} supabaseSlot={supabaseSlot} />
      <SupabaseBanner visible={supabasePatMissing} onReconnect={() => setSupabaseModalOpen(true)} />
      <ProjectMemory projectId={projectId} isOpen={isMemoryOpen} onClose={() => setIsMemoryOpen(false)} />
      <SupabaseModal
        projectId={projectId}
        open={supabaseModalOpen}
        onClose={() => setSupabaseModalOpen(false)}
        onLinked={(link) => {
          setSupabaseLink(link);
          setSupabasePatMissing(false);
        }}
      />
      <SupabaseSchemaPanel
        projectId={projectId}
        open={supabaseSchemaOpen}
        onClose={() => setSupabaseSchemaOpen(false)}
      />

      <div ref={containerRef} className="flex-1 flex overflow-hidden">
        {/* Chat Panel - fixed pixel width */}
        <div
          className="shrink-0 border-r border-white/5 bg-zinc-950/50 overflow-hidden"
          style={{ width: chatWidth }}
        >
          <ChatPanel
            projectId={projectId}
            contextFiles={files}
            onUpdateFiles={setFiles}
            onUpdateDependencies={setDependencies}
          />
        </div>

        {/* Drag Handle */}
        <div
          onMouseDown={handleMouseDown}
          className="w-[6px] shrink-0 cursor-col-resize bg-white/10 hover:bg-sky-500/60 active:bg-sky-500 transition-colors relative group"
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-white/30 group-hover:bg-white/60 transition-colors" />
        </div>

        {/* Workspace Panel - fills remaining space */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <WorkspacePanel
            projectId={projectId}
            files={files}
            dependencies={dependencies}
            onFileChange={handleFileChange}
            onRestore={handleRestore}
          />
        </div>
      </div>

      {/* While dragging the chat/preview divider, this transparent overlay sits
          above the Sandpack iframe so the parent keeps receiving mousemove —
          without it the drag stalls the moment the cursor crosses the preview. */}
      {resizing && <div className="fixed inset-0 z-[2147483000] cursor-col-resize" />}

      {/* Save-status pill — manual edits persist to the version store (Phase 0).
          Hidden while idle so it never competes with the Map Mode HUD. */}
      {saveState !== "idle" && (
        <div
          className={`fixed bottom-4 right-4 z-[2147483001] flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur ${
            saveState === "error"
              ? "bg-red-500/90 text-white"
              : "bg-zinc-800/90 text-zinc-100 border border-white/10"
          }`}
          role="status"
          aria-live="polite"
        >
          {saveState === "saving" && (
            <>
              <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
              Saving…
            </>
          )}
          {saveState === "saved" && (
            <>
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Saved
            </>
          )}
          {saveState === "error" && (
            <>
              <span className="h-2 w-2 rounded-full bg-white" />
              Save failed — retry
              <button
                onClick={() => void persistFiles()}
                className="ml-1 rounded bg-white/20 px-1.5 py-0.5 hover:bg-white/30"
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}

      {/* Map Mode — numbered voice/keyboard command HUD (docs/SOP_MAP_MODE.md) */}
      <MapModeController />
    </div>
  );
}