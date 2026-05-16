"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Share, Settings, Download, Loader2, GitBranch, Rocket, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/editor/export-button";
import { BlogGenerator } from "@/components/editor/blog-generator";
import { WORKER_URL } from "@/lib/constants";
import { useAuth } from "@/lib/dev-auth";

function GitHubButton({ projectId }: { projectId: string }) {
  const [state, setState] = useState<"idle" | "pushing" | "done" | "error">("idle");
  const { getToken } = useAuth();

  const handlePush = async () => {
    const repoName = prompt("Enter GitHub repository name:", `lovable-project-${projectId.slice(0, 8)}`);
    if (!repoName) return;

    setState("pushing");
    try {
      const token = await getToken();

      // Fetch latest version files
      const res = await fetch(`${WORKER_URL}/api/versions/${projectId}/latest`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Could not load project");
      const data = await res.json();
      const files = data.version?.files || {};

      // Push to GitHub via the worker endpoint
      const pushRes = await fetch(`${WORKER_URL}/api/github/push`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ repoName, files, projectId })
      });

      if (pushRes.ok) {
        const result = await pushRes.json();
        setState("done");
        window.open(result.repoUrl, "_blank");
      } else {
        const err = await pushRes.json().catch(() => ({ error: `HTTP ${pushRes.status}` }));
        setState("error");
        alert(`GitHub push failed: ${err.error || "Unknown error"}`);
      }
    } catch (err) {
      setState("error");
      const msg = err instanceof Error ? err.message : String(err);
      alert(`GitHub push failed: ${msg}`);
    } finally {
      setTimeout(() => setState("idle"), 2000);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 bg-white/5 border-white/10 hover:border-white/30 inline-flex"
      onClick={handlePush}
      disabled={state === "pushing"}
    >
      {state === "pushing" ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <GitBranch className="w-3.5 h-3.5 mr-2" />}
      GitHub
    </Button>
  );
}

function ShareToPhoneButton({ projectId }: { projectId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const { getToken } = useAuth();

  const handleShare = async () => {
    setState("sending");
    try {
      const token = await getToken();
      const shareUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/editor/${projectId}`
          : `/editor/${projectId}`;

      const res = await fetch(`${WORKER_URL}/api/share/phone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          channel: "telegram",
          url: shareUrl,
          message: `📱 HS App Builder — preview on your phone:\n${shareUrl}`,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        setState("done");
      } else {
        setState("error");
        const detail =
          data?.results?.[0]?.detail || data?.error || `HTTP ${res.status}`;
        alert(`Couldn't send the preview link to your phone.\n\nDetail: ${detail}`);
      }
    } catch (err) {
      setState("error");
      alert(
        `Couldn't reach the worker. Make sure it's running on ${WORKER_URL}.\n\n${
          (err as Error).message
        }`
      );
    } finally {
      setTimeout(() => setState("idle"), 2500);
    }
  };

  const Icon =
    state === "sending" ? Loader2 : state === "done" ? Check : Share;
  const iconClass =
    state === "sending"
      ? "w-4 h-4 mr-2 animate-spin"
      : "w-4 h-4 mr-2";
  const label =
    state === "sending"
      ? "Sending..."
      : state === "done"
      ? "Sent to phone"
      : "Share";

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 bg-white/5 border-white/10 hover:border-white/30 hidden lg:inline-flex"
      onClick={handleShare}
      disabled={state === "sending"}
      title="Send this preview to your phone via Telegram"
    >
      <Icon className={iconClass} />
      {label}
    </Button>
  );
}

function VercelButton({ projectId }: { projectId: string }) {
  const [state, setState] = useState<"idle" | "deploying" | "done" | "error">("idle");
  const { getToken } = useAuth();

  const handleDeploy = async () => {
    setState("deploying");
    try {
      const token = await getToken();

      const res = await fetch(`${WORKER_URL}/api/versions/${projectId}/latest`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Could not load project");
      const data = await res.json();
      const files = data.version?.files || {};

      const deployRes = await fetch(`${WORKER_URL}/api/vercel/deploy`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ files, projectId })
      });

      if (deployRes.ok) {
        const result = await deployRes.json();
        setState("done");
        window.open(result.deploymentUrl, "_blank");
      } else {
        setState("error");
        let detail = `HTTP ${deployRes.status}`;
        try {
          const body = await deployRes.json();
          if (body?.error) detail = body.error;
        } catch {
          try { detail = await deployRes.text(); } catch {}
        }
        alert(`Vercel deploy failed: ${detail}`);
      }
    } catch (err) {
      setState("error");
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Vercel deploy failed: ${msg}`);
    } finally {
      setTimeout(() => setState("idle"), 2000);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 bg-white/5 border-white/10 hover:border-white/30 inline-flex"
      onClick={handleDeploy}
      disabled={state === "deploying"}
    >
      {state === "deploying" ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Rocket className="w-3.5 h-3.5 mr-2" />}
      Vercel
    </Button>
  );
}

export function EditorHeader({ projectId, onOpenMemory, contextFiles, onUpdateFiles, supabaseSlot }: { projectId: string; onOpenMemory?: () => void; contextFiles?: Record<string, string>; onUpdateFiles?: (files: Record<string, string>) => void; supabaseSlot?: React.ReactNode }) {
  return (
    <header className="h-14 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-4">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-white">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="h-4 w-px bg-white/10" />
        <div className="flex flex-col">
          <span className="text-sm font-medium text-white">Project Setup</span>
          <span className="text-xs text-muted-foreground">ID: {projectId?.slice(0, 8) ?? "..."}...</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {contextFiles && onUpdateFiles && (
          <BlogGenerator projectId={projectId} contextFiles={contextFiles} onUpdateFiles={onUpdateFiles} />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground hover:text-white hidden sm:flex"
          onClick={onOpenMemory}
        >
          <Settings className="w-4 h-4 mr-2" />
          Settings
        </Button>
        <ShareToPhoneButton projectId={projectId} />
        <GitHubButton projectId={projectId} />
        <VercelButton projectId={projectId} />
        {supabaseSlot}
        <ExportButton projectId={projectId} />
      </div>
    </header>
  );
}
