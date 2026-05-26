"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@/lib/dev-auth";
import { ChatPanel } from "@/components/editor/chat-panel";
import { WorkspacePanel } from "@/components/editor/workspace-panel";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();

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
    setFiles(prev => ({ ...prev, [filename]: content }));
  };

  const handleRestore = (restoredFiles: Record<string, string>, restoredDeps: Record<string, string>) => {
    setFiles(restoredFiles);
    if (Object.keys(restoredDeps).length > 0) {
      setDependencies(restoredDeps);
    }
  };

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
    </div>
  );
}