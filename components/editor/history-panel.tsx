"use client";

import { useState, useEffect } from "react";
import { History, Clock, ArrowLeft, RefreshCw, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/dev-auth";
import { WORKER_URL } from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";

interface VersionSummary {
  version: number;
  createdAt: string;
  prompt: string;
}

export function HistoryPanel({ projectId, onRestore }: { projectId: string; onRestore: (files: Record<string, string>, deps: Record<string, string>) => void }) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const { getToken } = useAuth();

  const fetchVersions = async () => {
    setIsLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/versions/${projectId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setVersions(data.history || []);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = async (versionNum: number) => {
    setRestoringVersion(versionNum);
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/versions/${projectId}/${versionNum}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.files) {
          onRestore(data.files, data.dependencies || {});
        }
        // Refresh the timeline so the new "Restored from version N" entry shows
        await fetchVersions();
      } else {
        console.error("Restore failed:", res.status, await res.text());
      }
    } catch (err) {
      console.error("Failed to restore version:", err);
    } finally {
      setRestoringVersion(null);
    }
  };

  useEffect(() => {
    fetchVersions();
  }, [projectId]);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="h-12 border-b border-white/5 flex items-center justify-between px-4 shrink-0 bg-zinc-950/50">
        <div className="flex items-center gap-2 text-zinc-300">
          <History className="w-4 h-4" />
          <span className="text-sm font-medium">Version History</span>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchVersions} className="h-8 w-8 text-zinc-400 hover:text-white">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading && versions.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        ) : versions.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <Clock className="w-12 h-12 text-zinc-800 mb-4" />
            <p className="text-zinc-400 font-medium">No versions yet</p>
            <p className="text-zinc-500 text-sm mt-1">Generate code with the AI to create your first version.</p>
          </div>
        ) : (
          <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">
            {versions.map((version, i) => (
              <div key={version.version} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white/10 bg-zinc-900 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-[0_0_15px_rgba(0,0,0,0.5)] z-10">
                  <div className="w-3 h-3 rounded-full bg-primary" />
                </div>
                
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] bg-zinc-900/40 hover:bg-zinc-800/60 transition-colors border border-white/5 rounded-xl p-5 shadow-xl glass">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                    </span>
                    {i === 0 && (
                      <span className="text-[10px] uppercase font-bold tracking-wider text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">Current</span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-200 line-clamp-3 mb-4 leading-relaxed font-medium">
                    {version.prompt || "Initial version"}
                  </p>
                  
                  {i !== 0 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full h-8 text-xs border-white/10 bg-zinc-950 hover:bg-white hover:text-black transition-all"
                      disabled={restoringVersion === version.version}
                      onClick={() => handleRestore(version.version)}
                    >
                      {restoringVersion === version.version ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      Restore this version
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
