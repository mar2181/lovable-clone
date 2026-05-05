"use client";

import { useState } from "react";
import { Shield, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@clerk/nextjs";
import { runSql } from "@/lib/supabase-client";

interface MigrationProposal {
  description: string;
  sql: string;
}

interface SqlDiffModalProps {
  projectId: string;
  migration: MigrationProposal;
  open: boolean;
  onApplied: () => void;
  onSkip: () => void;
}

function assessRisk(sql: string): { level: "safe" | "warning" | "danger"; message: string } {
  const upper = sql.toUpperCase();
  if (/\bDROP\s+(TABLE|COLUMN|FUNCTION|TRIGGER|VIEW|INDEX)/.test(upper)) {
    return { level: "danger", message: "This migration drops database objects — data may be permanently lost." };
  }
  if (/\bALTER\s+TABLE\b/.test(upper) && /DROP/i.test(upper)) {
    return { level: "danger", message: "This migration drops columns or constraints." };
  }
  if (!/\bROW\s+LEVEL\s+SECURITY\b/i.test(upper) && /\bCREATE\s+TABLE\b/i.test(upper)) {
    return { level: "warning", message: "New table created without RLS. Anonymous users could read all rows." };
  }
  if (/\bCREATE\b/i.test(upper) || /\bALTER\b/i.test(upper)) {
    return { level: "safe", message: "Additive schema change — safe to apply." };
  }
  return { level: "safe", message: "No destructive operations detected." };
}

export function SqlDiffModal({ projectId, migration, open, onApplied, onSkip }: SqlDiffModalProps) {
  const { getToken } = useAuth();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [sql, setSql] = useState(migration.sql);

  if (!open) return null;

  const risk = assessRisk(sql);

  const handleApply = async () => {
    setApplying(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("not authenticated");
      const result = await runSql(token, projectId, sql);
      if (result.ok) {
        onApplied();
      } else {
        setError(result.details || result.error || "Migration failed");
      }
    } catch (err: any) {
      setError(err?.message || "Migration failed");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="alertdialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div>
            <h2 className="text-lg font-semibold text-white">Review Migration</h2>
            <p className="text-sm text-zinc-400">The AI proposes this schema change</p>
          </div>
        </div>

        {/* Description */}
        <div className="px-6 py-3 border-b border-white/5">
          <p className="text-sm text-zinc-300">{migration.description}</p>
        </div>

        {/* Risk badge */}
        <div className={`mx-6 mt-4 p-3 rounded-lg flex items-start gap-2.5 ${
          risk.level === "danger" ? "bg-red-500/10 border border-red-500/20" :
          risk.level === "warning" ? "bg-yellow-500/10 border border-yellow-500/20" :
          "bg-green-500/10 border border-green-500/20"
        }`}>
          {risk.level === "danger" ? <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" /> :
           risk.level === "warning" ? <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" /> :
           <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />}
          <span className={`text-sm ${
            risk.level === "danger" ? "text-red-400" :
            risk.level === "warning" ? "text-yellow-400" :
            "text-green-400"
          }`}>{risk.message}</span>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* SQL editor */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <textarea
            className="w-full min-h-[200px] bg-zinc-950 border border-white/10 rounded-lg p-4 text-sm font-mono text-zinc-300 focus:outline-none focus:border-purple-500/50 resize-y"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/5">
          <Button variant="ghost" className="text-zinc-400" onClick={onSkip} disabled={applying}>
            Skip
          </Button>
          <Button
            className="bg-[#3ECF8E] hover:bg-[#36b87a] text-black font-semibold"
            onClick={handleApply}
            disabled={applying}
          >
            {applying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Apply Migration
          </Button>
        </div>
      </div>
    </div>
  );
}
