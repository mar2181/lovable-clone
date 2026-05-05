"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SupabaseBannerProps {
  visible: boolean;
  onReconnect: () => void;
}

export function SupabaseBanner({ visible, onReconnect }: SupabaseBannerProps) {
  if (!visible) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-yellow-400" />
        <span className="text-sm text-yellow-300">
          Supabase connection expired. Reconnect to continue using the database.
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 bg-yellow-500/10 border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/20 text-xs"
        onClick={onReconnect}
      >
        Reconnect
      </Button>
    </div>
  );
}
