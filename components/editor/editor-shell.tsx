"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { ChatPanel } from "@/components/editor/chat-panel";
import { WorkspacePanel } from "@/components/editor/workspace-panel";
import { EditorHeader } from "@/components/editor/editor-header";
import { ProjectMemory } from "@/components/editor/project-memory";
import { SupabaseButton } from "@/components/editor/supabase-button";
import { SupabaseModal } from "@/components/editor/supabase-modal";
import { SupabaseStatusMenu } from "@/components/editor/supabase-status-menu";
import { SupabaseSchemaPanel } from "@/components/editor/supabase-schema-panel";
import { SqlDiffModal } from "@/components/editor/sql-diff-modal";
import { SupabaseBanner } from "@/components/editor/supabase-banner";
import type { SupabaseLinkInfo } from "@/lib/supabase-client";
import { WORKER_URL } from "@/lib/constants";
import { useSelectStore } from "@/lib/select-store";
import { MousePointerClick } from "lucide-react";

interface MigrationProposal {
  description: string;
  sql: string;
}

// Debounce window for auto-saving manual code edits to the server.
const MANUAL_SAVE_DEBOUNCE_MS = 1800;

export function EditorShell({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [dependencies, setDependencies] = useState<Record<string, string>>({});
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(400); // pixels
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();

  // ── Selection mode keyboard shortcuts ───────────────────────────
  const isModeActive = useSelectStore((s) => s.isModeActive);
  const setModeActive = useSelectStore((s) => s.setModeActive);
  const exitSelectMode = useSelectStore((s) => s.exit);
  const [showTooltip, setShowTooltip] = useState(false);

  // First-time tooltip (one-shot, persisted in localStorage)
  useEffect(() => {
    const seen = localStorage.getItem("lovable.selectMode.seen");
    if (!seen) {
      setShowTooltip(true);
    }
  }, []);

  const dismissTooltip = useCallback(() => {
    setShowTooltip(false);
    localStorage.setItem("lovable.selectMode.seen", "1");
  }, []);

  // Global keyboard shortcuts: Cmd/Ctrl+E toggles, Esc exits
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "e") {
        e.preventDefault();
        setModeActive(!useSelectStore.getState().isModeActive);
        dismissTooltip();
      }
      if (e.key === "Escape" && useSelectStore.getState().isModeActive) {
        exitSelectMode();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setModeActive, exitSelectMode, dismissTooltip]);
  // ── End selection keyboard ──────────────────────────────────────

  // Supabase state
  const [showSupabaseModal, setShowSupabaseModal] = useState(false);
  const [showSupabaseMenu, setShowSupabaseMenu] = useState(false);
  const [showSchemaPanel, setShowSchemaPanel] = useState(false);
  const [supabaseLink, setSupabaseLink] = useState<SupabaseLinkInfo | null>(null);
  const [supabaseBannerVisible, setSupabaseBannerVisible] = useState(false);
  const [pendingMigration, setPendingMigration] = useState<MigrationProposal | null>(null);

  const handleMigrationProposed = useCallback((migration: MigrationProposal) => {
    setPendingMigration(migration);
  }, []);

  const handleMigrationApplied = useCallback(() => {
    setPendingMigration(null);
  }, []);

  const handleMigrationSkipped = useCallback(() => {
    setPendingMigration(null);
  }, []);

  const handleSupabaseLinked = useCallback((link: SupabaseLinkInfo) => {
    setSupabaseLink(link);
    setShowSupabaseModal(false);
  }, []);

  const handleSupabaseUnlinked = useCallback(() => {
    setSupabaseLink(null);
  }, []);

  const handleReconnect = useCallback(() => {
    setSupabaseBannerVisible(false);
    setShowSupabaseModal(true);
  }, []);

  // Refs used by the debounced manual-save logic. We need them so the save
  // closure always sees the latest files/state without retriggering effects.
  const filesRef = useRef(files);
  filesRef.current = files;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether the latest `files` came from the AI/initial-load path
  // (which we should NOT save again) vs from a Monaco edit (which we should).
  const dirtyRef = useRef(false);
  const initialLoadRef = useRef(true);

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
            // Mark as non-dirty since these came from the server.
            dirtyRef.current = false;
            setFiles(data.version.files);
            if (data.version.dependencies) {
              setDependencies(data.version.dependencies);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load project files:", err);
      } finally {
        // After initial load completes, future state changes are real edits.
        // (Subsequent server-driven updates set dirtyRef=false explicitly.)
        initialLoadRef.current = false;
      }
    }
    loadProject();
  }, [projectId, getToken]);

  // Manual edits in the Monaco editor. Mark as dirty so the debounced
  // effect picks them up and persists them.
  const handleFileChange = useCallback((filename: string, content: string) => {
    dirtyRef.current = true;
    setFiles(prev => ({ ...prev, [filename]: content }));
  }, []);

  // AI-driven file updates (from chat-panel). NOT a manual edit — clear
  // any pending debounced save and don't re-trigger one.
  const handleAIFilesUpdate = useCallback((next: Record<string, string>) => {
    dirtyRef.current = false;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setFiles(next);
  }, []);

  const handleRestore = useCallback((restoredFiles: Record<string, string>, restoredDeps: Record<string, string>) => {
    // Restoration creates a new server version on its own (or should), so
    // mark as non-dirty and skip the manual-save path.
    dirtyRef.current = false;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setFiles(restoredFiles);
    if (Object.keys(restoredDeps).length > 0) {
      setDependencies(restoredDeps);
    }
  }, []);

  // Debounced auto-save for manual Monaco edits.
  useEffect(() => {
    // Skip if this state change wasn't a manual edit.
    if (!dirtyRef.current) return;
    // Skip while initial load is still in flight.
    if (initialLoadRef.current) return;
    // Skip empty file maps (e.g. after Reset).
    if (!files || Object.keys(files).length === 0) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      const snapshot = filesRef.current;
      try {
        setSaveStatus("saving");
        const token = await getToken();
        const res = await fetch(`${WORKER_URL}/api/versions/${projectId}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ files: snapshot, message: "Manual Edit" }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error(`Manual save failed: HTTP ${res.status}`, text.slice(0, 200));
          setSaveStatus("error");
        } else {
          // Successful persist. Clear dirty so we don't loop on the same content.
          dirtyRef.current = false;
          setSaveStatus("saved");
        }
      } catch (err) {
        console.error("Manual save failed:", err);
        setSaveStatus("error");
      } finally {
        // Reset the badge to idle after a short pause.
        setTimeout(() => setSaveStatus("idle"), 1800);
      }
    }, MANUAL_SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
    // We intentionally only depend on `files` here. The save closure reads
    // filesRef on fire, and the other refs are stable.
  }, [files, projectId, getToken]);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      // Clamp between 300px and 60% of container
      const maxWidth = containerRect.width * 0.6;
      setChatWidth(Math.max(300, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
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

  return (
    <div className="flex flex-col h-screen w-full bg-zinc-950 text-foreground">
      <SupabaseBanner visible={supabaseBannerVisible} onReconnect={handleReconnect} />

      <EditorHeader
        projectId={projectId}
        onOpenMemory={() => setIsMemoryOpen(true)}
        contextFiles={files}
        onUpdateFiles={handleAIFilesUpdate}
        supabaseSlot={
          <SupabaseButton
            projectId={projectId}
            onOpenModal={() => setShowSupabaseModal(true)}
            onOpenMenu={() => setShowSupabaseMenu(true)}
            onLinkUpdate={setSupabaseLink}
          />
        }
      />
      <ProjectMemory projectId={projectId} isOpen={isMemoryOpen} onClose={() => setIsMemoryOpen(false)} />

      {/* Tiny save-status badge — shows the user that manual edits are persisting */}
      {saveStatus !== "idle" && (
        <div className="absolute top-16 right-4 z-50 text-xs px-3 py-1.5 rounded-md border bg-zinc-900/90 backdrop-blur"
             style={{
               borderColor: saveStatus === "error" ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.1)",
               color: saveStatus === "error" ? "#fca5a5" : saveStatus === "saved" ? "#86efac" : "#a1a1aa",
             }}>
          {saveStatus === "saving" && "Saving manual edit…"}
          {saveStatus === "saved" && "Saved"}
          {saveStatus === "error" && "Save failed — check console"}
        </div>
      )}

      <div ref={containerRef} className="flex-1 flex overflow-hidden">
        {/* Chat Panel - fixed pixel width */}
        <div
          className="shrink-0 border-r border-white/5 bg-zinc-950/50 overflow-hidden"
          style={{ width: chatWidth }}
        >
          <ChatPanel
            projectId={projectId}
            contextFiles={files}
            onUpdateFiles={handleAIFilesUpdate}
            onUpdateDependencies={setDependencies}
            onMigrationProposed={handleMigrationProposed}
          />
        </div>

        {/* Drag Handle */}
        <div
          onMouseDown={handleMouseDown}
          className="w-[6px] shrink-0 cursor-col-resize bg-white/10 hover:bg-purple-500/60 active:bg-purple-500 transition-colors relative group"
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

      {/* Supabase modals & panels */}
      <SupabaseModal
        projectId={projectId}
        open={showSupabaseModal}
        onClose={() => setShowSupabaseModal(false)}
        onLinked={handleSupabaseLinked}
      />

      <div className="relative">
        <SupabaseStatusMenu
          projectId={projectId}
          link={supabaseLink!}
          open={showSupabaseMenu}
          onClose={() => setShowSupabaseMenu(false)}
          onUnlinked={handleSupabaseUnlinked}
          onViewSchema={() => setShowSchemaPanel(true)}
        />
      </div>

      <SupabaseSchemaPanel
        projectId={projectId}
        open={showSchemaPanel}
        onClose={() => setShowSchemaPanel(false)}
      />

      {pendingMigration && (
        <SqlDiffModal
          projectId={projectId}
          migration={pendingMigration}
          open={!!pendingMigration}
          onApplied={handleMigrationApplied}
          onSkip={handleMigrationSkipped}
        />
      )}
    </div>
  );
}
