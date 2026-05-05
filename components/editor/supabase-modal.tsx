"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, Plus, ExternalLink, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@clerk/nextjs";
import {
  startOAuth, getMe, listProjects, linkProject, getConnectStatus,
  type SupabaseProject, type SupabaseLinkInfo,
} from "@/lib/supabase-client";

interface SupabaseModalProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onLinked: (link: SupabaseLinkInfo) => void;
}

type Step = "auth" | "pick" | "linking" | "error";

export function SupabaseModal({ projectId, open, onClose, onLinked }: SupabaseModalProps) {
  const { getToken } = useAuth();
  const [step, setStep] = useState<Step>("auth");
  const [projects, setProjects] = useState<SupabaseProject[]>([]);
  const [search, setSearch] = useState("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);

  // Check if already connected when modal opens
  useEffect(() => {
    if (!open) return;
    async function check() {
      try {
        const token = await getToken();
        if (!token) return;
        const me = await getMe(token);
        if (me.connected) {
          setConnected(true);
          setStep("pick");
          const proj = await listProjects(token);
          setProjects(Array.isArray(proj) ? proj : []);
        } else {
          setStep("auth");
        }
      } catch {
        setStep("auth");
      }
    }
    check();
  }, [open, getToken]);

  // Listen for OAuth popup completion
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.data?.type !== "supabase-oauth") return;
      if (e.data.payload?.ok) {
        setConnected(true);
        setStep("pick");
        getToken().then(async (token) => {
          if (!token) return;
          try {
            const proj = await listProjects(token);
            setProjects(Array.isArray(proj) ? proj : []);
          } catch {
            setError("Could not load projects. Please try again.");
          }
        });
      } else {
        setError(e.data.payload?.error === "state_invalid"
          ? "Connection failed (security check). Please try again."
          : "Supabase connection failed. Please try again.");
        setStep("error");
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [getToken]);

  const handleConnect = useCallback(async () => {
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("not authenticated");
      const url = await startOAuth(token, projectId);
      window.open(url, "supabase_oauth", "popup,width=520,height=720");
    } catch (err: any) {
      setError(err?.message || "Failed to start OAuth flow");
      setStep("error");
    }
  }, [getToken, projectId]);

  const handleLink = useCallback(async (ref: string) => {
    setLinking(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("not authenticated");
      const result = await linkProject(token, projectId, ref);
      onLinked(result.link);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to link project");
    } finally {
      setLinking(false);
    }
  }, [getToken, projectId, onLinked, onClose]);

  const filtered = projects.filter((p) => {
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.organization_name?.toLowerCase().includes(q);
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div>
            <h2 className="text-lg font-semibold text-white">Connect Supabase</h2>
            <p className="text-sm text-zinc-400">Link a real backend to this project</p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400" onClick={onClose}>
            <span className="sr-only">Close</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z"/></svg>
          </Button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Step: Auth */}
        {step === "auth" && (
          <div className="p-6 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <img src="https://supabase.com/favicon.ico" alt="" className="w-8 h-8" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            </div>
            <div>
              <h3 className="text-base font-medium text-white">Sign in with Supabase</h3>
              <p className="text-sm text-zinc-400 mt-1">
                You&apos;ll be redirected to Supabase to authorize Lovable Clone.
                We&apos;ll store your refresh token encrypted — we never see your password.
              </p>
            </div>
            <Button
              size="lg"
              className="w-full bg-[#3ECF8E] hover:bg-[#36b87a] text-black font-semibold"
              onClick={handleConnect}
            >
              <img src="https://supabase.com/favicon.ico" alt="" className="w-4 h-4 mr-2" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              Sign in with Supabase
            </Button>
            <p className="text-xs text-zinc-500">
              Scopes: read/write projects, SQL access, secrets for env vars
            </p>
          </div>
        )}

        {/* Step: Pick project */}
        {(step === "pick" || step === "linking") && (
          <>
            {/* Search + create bar */}
            <div className="px-6 py-3 flex items-center gap-2 border-b border-white/5">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <Input
                  className="pl-8 h-9 bg-white/5 border-white/10 text-sm"
                  placeholder="Search projects..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 shrink-0"
                disabled={linking}
              >
                <Plus className="w-4 h-4 mr-1" />
                Create New
              </Button>
            </div>

            {/* Project list */}
            <div className="flex-1 overflow-y-auto px-4 py-2">
              {filtered.length === 0 && (
                <div className="text-center py-8 text-zinc-500 text-sm">
                  {search ? "No projects match your search." : "No Supabase projects found. Create one first."}
                </div>
              )}
              {filtered.map((p) => (
                <button
                  key={p.ref}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors text-left disabled:opacity-50"
                  onClick={() => handleLink(p.ref)}
                  disabled={linking}
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    p.status === "ACTIVE_HEALTHY" ? "bg-green-400" :
                    p.status === "PAUSED" ? "bg-yellow-400" : "bg-red-400"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{p.name}</p>
                    <p className="text-xs text-zinc-500 truncate">{p.organization_name} · {p.region}</p>
                  </div>
                  {linking ? (
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                  ) : (
                    <span className="text-xs text-zinc-500 shrink-0">Link</span>
                  )}
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-white/5 flex items-center justify-between">
              <a
                href="https://app.supabase.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-zinc-500 hover:text-purple-400 flex items-center gap-1 transition-colors"
              >
                Open Supabase Dashboard <ExternalLink className="w-3 h-3" />
              </a>
              <Button variant="ghost" size="sm" className="text-zinc-400" onClick={() => setStep("auth")}>
                Switch Account
              </Button>
            </div>
          </>
        )}

        {/* Step: Error */}
        {step === "error" && (
          <div className="p-6 flex flex-col items-center gap-4">
            <Button
              size="lg"
              className="w-full bg-[#3ECF8E] hover:bg-[#36b87a] text-black font-semibold"
              onClick={handleConnect}
            >
              Retry Connection
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
