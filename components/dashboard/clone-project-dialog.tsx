"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/dev-auth";
import { Loader2, Copy, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WORKER_URL } from "@/lib/constants";

interface CloneSource {
  id: string;
  name: string;
}

interface CloneProjectDialogProps {
  project: CloneSource | null;
  onClose: () => void;
  onCloned: () => void;
}

export function CloneProjectDialog({ project, onClose, onCloned }: CloneProjectDialogProps) {
  const [name, setName] = useState("");
  const [loadingMode, setLoadingMode] = useState<"stay" | "open" | null>(null);
  const router = useRouter();
  const { getToken } = useAuth();

  // Pre-fill the name each time a new project is picked for cloning
  useEffect(() => {
    if (project) setName(`Copy of ${project.name}`);
  }, [project?.id]);

  const handleClone = async (mode: "stay" | "open") => {
    if (!project || !name.trim() || loadingMode) return;

    setLoadingMode(mode);
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/projects/${project.id}/clone`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (!res.ok) throw new Error(`Clone failed (${res.status})`);

      const data = await res.json();

      if (mode === "open") {
        router.push(`/editor/${data.project.id}`);
        return;
      }

      toast.success(`Cloned — "${data.project.name}"`);
      onCloned();
      onClose();
    } catch (err) {
      console.error("Error cloning project:", err);
      toast.error("Couldn't clone the project. Please try again.");
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <Dialog open={!!project} onOpenChange={(o) => !o && !loadingMode && onClose()}>
      <DialogContent className="sm:max-w-[440px] bg-zinc-950/95 backdrop-blur-2xl border-white/10 text-white shadow-2xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleClone("stay");
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold flex items-center gap-2">
              <Copy className="w-5 h-5 text-primary" />
              Duplicate Project
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              Creates a separate, independent copy with the current files only —
              no version history or chat is carried over.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="clone-name" className="text-zinc-200">
                New Project Name
              </Label>
              <Input
                id="clone-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Smith Law Firm"
                className="bg-zinc-900/50 border-white/10 focus-visible:ring-primary text-white"
                autoFocus
                required
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="submit"
              variant="outline"
              disabled={!!loadingMode || !name.trim()}
              className="border-white/10 bg-zinc-900 hover:bg-white/10 text-white"
            >
              {loadingMode === "stay" ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cloning...
                </>
              ) : (
                "Clone & Stay"
              )}
            </Button>
            <Button
              type="button"
              onClick={() => handleClone("open")}
              disabled={!!loadingMode || !name.trim()}
              className="bg-primary text-primary-foreground font-medium"
            >
              {loadingMode === "open" ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Opening...
                </>
              ) : (
                <>
                  Clone &amp; Open
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
