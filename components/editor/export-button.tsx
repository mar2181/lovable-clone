"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WORKER_URL } from "@/lib/constants";
import { useAuth } from "@clerk/nextjs";

export function ExportButton({ projectId }: { projectId: string }) {
  const [isExporting, setIsExporting] = useState(false);
  const { getToken } = useAuth();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const token = await getToken();
      
      // First, get the latest version number
      const latestRes = await fetch(`${WORKER_URL}/api/versions/${projectId}/latest`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!latestRes.ok) throw new Error("Could not determine latest version");
      const latestData = await latestRes.json();
      const versionNum = latestData.version?.version || 1;
      
      // Now export that version as ZIP
      const res = await fetch(`${WORKER_URL}/api/export/${projectId}/${versionNum}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error("Export failed");
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-${projectId}-v${versionNum}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button 
      size="sm" 
      onClick={handleExport}
      disabled={isExporting}
      className="h-8 bg-primary text-primary-foreground font-medium"
    >
      {isExporting ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
      Export
    </Button>
  );
}
