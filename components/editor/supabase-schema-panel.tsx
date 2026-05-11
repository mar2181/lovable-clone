"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Loader2, Shield, ShieldOff, Columns3 } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { getSchema, getMigrationHistory, type SupabaseTable } from "@/lib/supabase-client";

interface SupabaseSchemaPanelProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export function SupabaseSchemaPanel({ projectId, open, onClose }: SupabaseSchemaPanelProps) {
  const { getToken } = useAuth();
  const [tables, setTables] = useState<SupabaseTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"schema" | "history">("schema");
  const [history, setHistory] = useState<any[]>([]);

  const fetchSchema = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) return;
      const data = await getSchema(token, projectId, refresh);
      setTables(Array.isArray(data) ? data : []);
    } catch (err: any) {
      if (err?.message === "supabase_reauth_required") {
        setError("Reconnect Supabase to view schema.");
      } else {
        setError("Could not load schema.");
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, getToken]);

  const fetchHistory = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await getMigrationHistory(token, projectId);
      setHistory(data.history || []);
    } catch {
      // non-critical
    }
  }, [projectId, getToken]);

  useEffect(() => {
    if (!open) return;
    fetchSchema();
    fetchHistory();
  }, [open, fetchSchema, fetchHistory]);

  if (!open) return null;

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-96 max-w-[100vw] bg-zinc-900 border-l border-white/10 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-base font-semibold text-white">Schema</h2>
          <div className="flex items-center gap-1">
            <button
              className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
              onClick={() => fetchSchema(true)}
              title="Refresh schema"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
              onClick={onClose}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z"/></svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/5">
          <button
            className={`flex-1 py-2 text-xs font-medium transition-colors ${activeTab === "schema" ? "text-purple-400 border-b-2 border-purple-500" : "text-zinc-500 hover:text-zinc-300"}`}
            onClick={() => setActiveTab("schema")}
          >
            Tables
          </button>
          <button
            className={`flex-1 py-2 text-xs font-medium transition-colors ${activeTab === "history" ? "text-purple-400 border-b-2 border-purple-500" : "text-zinc-500 hover:text-zinc-300"}`}
            onClick={() => setActiveTab("history")}
          >
            Migrations
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "schema" && (
            <>
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                </div>
              )}
              {error && <p className="p-4 text-sm text-red-400">{error}</p>}
              {!loading && tables.length === 0 && !error && (
                <p className="p-4 text-sm text-zinc-500">No tables in public schema yet.</p>
              )}
              {tables.map((t) => (
                <div key={t.name} className="border-b border-white/5">
                  <button
                    className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-white/5 transition-colors"
                    onClick={() => toggleExpand(t.name)}
                  >
                    <Columns3 className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-sm font-medium text-white flex-1">{t.name}</span>
                    {t.rlsEnabled
                      ? <span title="RLS enabled"><Shield className="w-3.5 h-3.5 text-green-400" /></span>
                      : <span title="RLS disabled"><ShieldOff className="w-3.5 h-3.5 text-yellow-400" /></span>
                    }
                    <span className="text-xs text-zinc-600">{t.columns.length} cols</span>
                  </button>
                  {expanded.has(t.name) && (
                    <div className="px-5 pb-3 space-y-2">
                      <div className="space-y-1">
                        {t.columns.map((col) => (
                          <div key={col.name} className="flex items-center justify-between text-xs">
                            <span className="text-zinc-300 font-mono">{col.name}</span>
                            <span className="text-zinc-500">
                              {col.type}{col.nullable ? "" : " NOT NULL"}
                              {col.default !== null ? ` DEFAULT ${col.default}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                      {t.policies.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/5">
                          <p className="text-xs text-zinc-500 mb-1">Policies:</p>
                          {t.policies.map((p, i) => (
                            <div key={i} className="text-xs text-zinc-400 pl-2 border-l-2 border-purple-500/50 mb-1">
                              <span className="font-mono text-purple-400">{p.name}</span>
                              <span className="text-zinc-600"> ({p.command})</span>
                              {p.roles.length > 0 && (
                                <span className="text-zinc-600"> for [{p.roles.join(", ")}]</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {activeTab === "history" && (
            <div className="p-4">
              {history.length === 0 && (
                <p className="text-sm text-zinc-500">No migrations applied yet.</p>
              )}
              {history.map((m, i) => (
                <div key={m.id} className="mb-3 p-3 rounded-lg bg-white/[0.03] border border-white/5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-white">{m.description}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${m.result === "success" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                      {m.result}
                    </span>
                  </div>
                  <pre className="text-xs text-zinc-500 font-mono whitespace-pre-wrap line-clamp-4">{m.sql}</pre>
                  <p className="text-[10px] text-zinc-600 mt-1">{new Date(m.appliedAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
