"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/dev-auth";
import { Loader2, Plus, Code2 } from "lucide-react";
import { WORKER_URL } from "@/lib/constants";
import { ProjectCard } from "@/components/dashboard/project-card";
import { CloneProjectDialog } from "@/components/dashboard/clone-project-dialog";
import { Button } from "@/components/ui/button";

interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
}

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [cloneSource, setCloneSource] = useState<{ id: string; name: string } | null>(null);
  const { getToken, isLoaded, isSignedIn } = useAuth();

  async function loadProjects() {
    if (!isLoaded || !isSignedIn) return;

    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/projects`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error("Failed to load projects");

      const data = await res.json();
      setProjects(data.projects || []);
    } catch (err) {
      console.error("Error loading projects:", err);
      setError("Failed to load projects. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, [getToken, isLoaded, isSignedIn]);

  async function handleDelete(projectId: string) {
    setDeleting(prev => new Set(prev).add(projectId));
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/projects/${projectId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Delete failed");
      setProjects(prev => prev.filter(p => p.id !== projectId));
    } catch (err) {
      console.error("Error deleting project:", err);
    } finally {
      setDeleting(prev => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  }

  function handleClone(projectId: string) {
    const project = projects.find(p => p.id === projectId);
    if (project) setCloneSource({ id: project.id, name: project.name });
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
        <p className="text-muted-foreground">Loading your projects...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-destructive mb-4">{error}</div>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center rounded-2xl border border-dashed border-white/10 bg-white/5">
        <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mb-6">
          <Code2 className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">No projects yet</h3>
        <p className="text-muted-foreground max-w-sm mb-8">
          Get started by creating your first AI-generated application. It only takes a few seconds.
        </p>
        <Button onClick={() => {
          const btn = document.querySelector('[data-create-project]') as HTMLButtonElement;
          btn?.click();
        }} className="bg-primary text-primary-foreground">
          <Plus className="w-5 h-5 mr-2" />
          Create First Project
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onDelete={handleDelete}
            isDeleting={deleting.has(project.id)}
            onClone={handleClone}
          />
        ))}
      </div>
      <CloneProjectDialog
        project={cloneSource}
        onClose={() => setCloneSource(null)}
        onCloned={loadProjects}
      />
    </>
  );
}
