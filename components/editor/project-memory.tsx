"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Brain, Save, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WORKER_URL } from "@/lib/constants";
import { useAuth } from "@clerk/nextjs";

interface ProjectMemoryProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectMemory({ projectId, isOpen, onClose }: ProjectMemoryProps) {
  const [memory, setMemory] = useState("");
  const [history, setHistory] = useState<Array<{ role: string; summary: string }>>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"" | "saved" | "error">("");
  const { getToken } = useAuth();

  const loadMemory = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/versions/${projectId}/memory`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMemory(data.memory || "");
        setHistory(data.history || []);
      }
    } catch (err) {
      console.error("Failed to load memory:", err);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, getToken]);

  useEffect(() => {
    if (isOpen) loadMemory();
  }, [isOpen, loadMemory]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus("");
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/versions/${projectId}/memory`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ memory }),
      });
      setSaveStatus(res.ok ? "saved" : "error");
    } catch {
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveStatus(""), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-zinc-900 border-l border-white/10 flex flex-col h-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            <h2 className="text-base font-semibold text-white">Project Memory</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Memory Editor */}
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Project Context
              </label>
              <p className="text-xs text-zinc-500 mb-3">
                Describe what this project is so the AI always stays on track. This gets injected into every AI prompt.
              </p>
              <textarea
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                placeholder="Example: This is a locksmith business website for 956 Locksmith in South Texas. Dark slate-900 theme with amber/gold accents. Serves McAllen, Edinburg, Mission, Pharr area. Services include residential, commercial, automotive locksmith and emergency lockouts."
                className="w-full bg-zinc-800/50 border border-white/10 rounded-lg p-3 text-sm text-white placeholder:text-zinc-600 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 resize-none min-h-[160px] focus-visible:outline-none"
              />
              <div className="flex items-center gap-2 mt-3">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {isSaving ? (
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5 mr-2" />
                  )}
                  Save Memory
                </Button>
                {saveStatus === "saved" && (
                  <span className="text-xs text-green-400">Saved!</span>
                )}
                {saveStatus === "error" && (
                  <span className="text-xs text-red-400">Failed to save</span>
                )}
              </div>
            </div>

            {/* Chat History */}
            {history.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare className="w-4 h-4 text-zinc-400" />
                  <label className="text-sm font-medium text-zinc-300">
                    Recent Chat History
                  </label>
                  <span className="text-xs text-zinc-600">
                    (auto-tracked, last {Math.floor(history.length / 2)} exchanges)
                  </span>
                </div>
                <div className="space-y-2">
                  {history.map((entry, i) => (
                    <div
                      key={i}
                      className={`text-xs rounded-lg px-3 py-2 ${
                        entry.role === "user"
                          ? "bg-zinc-800/50 border border-white/5 text-zinc-300"
                          : "bg-purple-900/20 border border-purple-500/10 text-purple-300"
                      }`}
                    >
                      <span className="font-medium text-zinc-500 mr-2">
                        {entry.role === "user" ? "You:" : "AI:"}
                      </span>
                      {entry.summary}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
