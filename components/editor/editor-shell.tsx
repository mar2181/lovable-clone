"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { ChatPanel } from "@/components/editor/chat-panel";
import { WorkspacePanel } from "@/components/editor/workspace-panel";
import { EditorHeader } from "@/components/editor/editor-header";
import { ProjectMemory } from "@/components/editor/project-memory";
import { WORKER_URL } from "@/lib/constants";

export function EditorShell({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [dependencies, setDependencies] = useState<Record<string, string>>({});
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(400); // pixels
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

  return (
    <div className="flex flex-col h-screen w-full bg-zinc-950 text-foreground">
      <EditorHeader projectId={projectId} onOpenMemory={() => setIsMemoryOpen(true)} contextFiles={files} onUpdateFiles={setFiles} />
      <ProjectMemory projectId={projectId} isOpen={isMemoryOpen} onClose={() => setIsMemoryOpen(false)} />

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
    </div>
  );
}
