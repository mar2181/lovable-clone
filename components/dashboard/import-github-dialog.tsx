"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/dev-auth";
import { GitBranch, Loader2 } from "lucide-react";
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

export function ImportGithubDialog() {
  const [open, setOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { getToken } = useAuth();

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();

      const res = await fetch(`${WORKER_URL}/api/github/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          branch: branch.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to import repository");
      }

      setOpen(false);
      setRepoUrl("");
      setBranch("");

      router.push(`/editor/${data.project.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to import repository",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        data-import-github
        variant="outline"
        onClick={() => setOpen(true)}
        className="border-white/10 bg-white/5 text-white hover:bg-white/10 font-medium"
      >
        <GitBranch className="w-5 h-5 mr-2" />
        Import from GitHub
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[460px] bg-zinc-950/95 backdrop-blur-2xl border-white/10 text-white shadow-2xl">
          <form onSubmit={handleImport}>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold">
                Import from GitHub
              </DialogTitle>
              <DialogDescription className="text-zinc-400">
                Paste a GitHub repo URL to pull it in as a new project you can
                edit and rebuild here.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-6">
              <div className="flex flex-col gap-2">
                <Label htmlFor="repoUrl" className="text-zinc-200">
                  Repository URL
                </Label>
                <Input
                  id="repoUrl"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="bg-zinc-900/50 border-white/10 focus-visible:ring-primary text-white"
                  autoFocus
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="branch" className="text-zinc-200">
                  Branch (optional)
                </Label>
                <Input
                  id="branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="defaults to the repo's default branch"
                  className="bg-zinc-900/50 border-white/10 focus-visible:ring-primary text-white"
                />
              </div>
              {error && (
                <p className="text-sm text-red-400 leading-snug">{error}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                className="text-zinc-400 hover:text-white hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isLoading || !repoUrl.trim()}
                className="bg-primary text-primary-foreground font-medium"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  "Import Repo"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
