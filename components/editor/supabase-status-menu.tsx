"use client";

import { useState } from "react";
import { ExternalLink, Eye, LogOut, Loader2 } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { unlinkProject, type SupabaseLinkInfo } from "@/lib/supabase-client";

interface SupabaseStatusMenuProps {
  projectId: string;
  link: SupabaseLinkInfo;
  open: boolean;
  onClose: () => void;
  onUnlinked: () => void;
  onViewSchema: () => void;
}

export function SupabaseStatusMenu({
  projectId, link, open, onClose, onUnlinked, onViewSchema,
}: SupabaseStatusMenuProps) {
  const { getToken } = useAuth();
  const [disconnecting, setDisconnecting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  if (!open) return null;

  const dashboardUrl = `https://app.supabase.com/project/${link.ref}`;

  const handleDisconnect = async () => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }
    setDisconnecting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("not authenticated");
      await unlinkProject(token, projectId);
      onUnlinked();
      onClose();
    } catch {
      // surface via toast on parent
    } finally {
      setDisconnecting(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5">
          <p className="text-sm font-medium text-white truncate">{link.name}</p>
          <p className="text-xs text-zinc-500 truncate">{link.organization_name}</p>
        </div>

        <div className="py-1">
          <button
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5 transition-colors"
            onClick={() => { onViewSchema(); onClose(); }}
          >
            <Eye className="w-4 h-4" />
            View Schema
          </button>
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Open in Supabase
          </a>
        </div>

        <div className="border-t border-white/5 py-1">
          {showConfirm ? (
            <div className="px-4 py-2">
              <p className="text-xs text-zinc-400 mb-2">
                Disconnect &quot;{link.name}&quot;? Your Supabase data won&apos;t be deleted.
              </p>
              <div className="flex gap-2">
                <button
                  className="flex-1 px-3 py-1.5 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Yes, Disconnect"}
                </button>
                <button
                  className="px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-zinc-400 text-xs hover:bg-white/10 transition-colors"
                  onClick={() => setShowConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              onClick={handleDisconnect}
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
          )}
        </div>
      </div>
    </>
  );
}
