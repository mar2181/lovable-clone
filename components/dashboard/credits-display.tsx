"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Zap, Loader2 } from "lucide-react";
import { WORKER_URL } from "@/lib/constants";
import { Button } from "@/components/ui/button";

export function CreditsDisplay() {
  const [credits, setCredits] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { getToken, isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    async function fetchCredits() {
      if (!isLoaded || !isSignedIn) return;

      try {
        const token = await getToken();
        const res = await fetch(`${WORKER_URL}/api/credits`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          setCredits(data.credits.balance);
        }
      } catch (error) {
        console.error("Failed to load credits:", error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchCredits();
  }, [getToken, isLoaded, isSignedIn]);

  return (
    <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-white flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          AI Credits
        </h3>
        {isLoading ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        ) : (
          <span className="text-sm font-bold text-primary">{credits ?? 0}</span>
        )}
      </div>
      
      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mb-3">
        <div 
          className="h-full bg-primary" 
          style={{ width: `${Math.min(100, (credits || 0) * 10)}%` }}
        />
      </div>
      
      <p className="text-xs text-muted-foreground mb-4">
        Each AI generation uses 1 credit.
      </p>
      
      <Button variant="outline" className="w-full text-xs h-8 bg-white/5 border-white/10 hover:bg-white/10">
        Upgrade Plan
      </Button>
    </div>
  );
}
