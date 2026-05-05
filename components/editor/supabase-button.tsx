"use client";

import { useEffect, useState, useCallback } from "react";
import { Database, CheckCircle2, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@clerk/nextjs";
import { getConnectStatus, type SupabaseLinkInfo } from "@/lib/supabase-client";

interface SupabaseButtonProps {
  projectId: string;
  onOpenModal: () => void;
  onOpenMenu: () => void;
  onLinkUpdate: (link: SupabaseLinkInfo | null) => void;
}

export function SupabaseButton({ projectId, onOpenModal, onOpenMenu, onLinkUpdate }: SupabaseButtonProps) {
  const { getToken } = useAuth();
  const [link, setLink] = useState<SupabaseLinkInfo | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const status = await getConnectStatus(token, projectId);
      if (status.linked && status.link) {
        setLink(status.link);
        onLinkUpdate(status.link);
      } else {
        setLink(null);
        onLinkUpdate(null);
      }
      setConnected(status.connected);
    } catch {
      setLink(null);
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [projectId, getToken, onLinkUpdate]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Listen for OAuth completion from popup
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.data?.type === "supabase-oauth" && e.data.payload?.ok) {
        setConnected(true);
        fetchStatus();
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [fetchStatus]);

  if (loading) {
    return (
      <Button variant="outline" size="sm" className="h-8 bg-white/5 border-white/10" disabled>
        <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
        Supabase
      </Button>
    );
  }

  if (link) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-8 bg-white/5 border-purple-500/30 hover:border-purple-500/60"
        onClick={onOpenMenu}
      >
        <CheckCircle2 className="w-3.5 h-3.5 mr-2 text-green-400" />
        <span className="max-w-[120px] truncate">{link.name}</span>
        <ChevronDown className="w-3 h-3 ml-1.5 opacity-50" />
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 bg-white/5 border-white/10 hover:border-purple-500/50 hover:text-purple-400 transition-colors"
      onClick={onOpenModal}
    >
      <Database className="w-3.5 h-3.5 mr-2" />
      Connect Supabase
    </Button>
  );
}
