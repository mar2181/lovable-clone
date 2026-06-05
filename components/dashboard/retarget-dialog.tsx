"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/dev-auth";
import { Loader2, Wand2, Globe, ArrowRight, ImageOff } from "lucide-react";
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

interface RetargetSource {
  id: string;
  name: string;
}

interface RetargetDialogProps {
  project: RetargetSource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// The identity fields the swap engine needs. Anything the scraper can't find
// comes back in `missing` and we surface it as an editable override.
const FIELDS: Array<{ key: string; label: string; placeholder: string }> = [
  { key: "firmFull", label: "Firm name", placeholder: "e.g. Smith & Jones Injury Law" },
  { key: "attorneyFull", label: "Attorney name", placeholder: "e.g. David Smith" },
  { key: "phone", label: "Phone", placeholder: "(956) 800-1000" },
  { key: "addressLine", label: "Street address", placeholder: "4200 N 10th St, Suite 200" },
  { key: "city", label: "City", placeholder: "Edinburg" },
  { key: "state", label: "State", placeholder: "TX" },
  { key: "zip", label: "ZIP", placeholder: "78539" },
];

type Extracted = Partial<Record<string, string>>;

export function RetargetDialog({ project, open, onOpenChange }: RetargetDialogProps) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<Extracted | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [imagesNeedingReplacement, setImagesNeedingReplacement] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Extracted>({});
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const { getToken } = useAuth();

  // Reset everything whenever a fresh project is picked or the dialog reopens.
  useEffect(() => {
    if (open) {
      setSourceUrl("");
      setNewProjectName("");
      setTarget(null);
      setMissing([]);
      setImagesNeedingReplacement([]);
      setOverrides({});
      setError(null);
    }
  }, [open, project?.id]);

  const busy = previewing || creating;

  // Merge the dry-run target with any edits the user has typed into overrides.
  const valueFor = (key: string) =>
    overrides[key] ?? (target ? target[key] ?? "" : "");

  const setOverride = (key: string, value: string) =>
    setOverrides((prev) => ({ ...prev, [key]: value }));

  // Only fields the user actually edited (or that were missing) get sent as
  // overrides — the rest the server keeps from its own extraction.
  const buildOverrides = (): Extracted => {
    const out: Extracted = {};
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  };

  const handlePreview = async () => {
    if (!project || !sourceUrl.trim() || busy) return;
    setPreviewing(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/retarget/${project.id}/from-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sourceUrl: sourceUrl.trim(), dryRun: true }),
      });

      const data = await res.json().catch(() => ({}));

      // 422 here means "scraped, but missing some required fields" — that's a
      // valid preview we still want to show so the user can fill the gaps.
      if (!res.ok && res.status !== 422) {
        throw new Error(data?.error || `Preview failed (${res.status})`);
      }

      setTarget((data?.target as Extracted) || (data?.extracted as Extracted) || {});
      setMissing(Array.isArray(data?.missing) ? data.missing : []);
      setImagesNeedingReplacement(
        Array.isArray(data?.imagesNeedingReplacement) ? data.imagesNeedingReplacement : [],
      );
      // Seed editable overrides for any missing field so the inputs aren't empty-
      // looking placeholders the user might miss.
      setOverrides({});
    } catch (err) {
      console.error("Error previewing retarget:", err);
      setError(err instanceof Error ? err.message : "Couldn't preview that site. Please try again.");
    } finally {
      setPreviewing(false);
    }
  };

  const handleCreate = async () => {
    if (!project || !sourceUrl.trim() || busy) return;
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      const ov = buildOverrides();
      const res = await fetch(`${WORKER_URL}/api/retarget/${project.id}/from-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sourceUrl: sourceUrl.trim(),
          createCopy: true,
          ...(newProjectName.trim() ? { newProjectName: newProjectName.trim() } : {}),
          ...(Object.keys(ov).length ? { overrides: ov } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // 422 with `missing` → not enough identity to build; show it inline.
        if (res.status === 422 && Array.isArray(data?.missing)) {
          setTarget((data?.target as Extracted) || {});
          setMissing(data.missing);
        }
        throw new Error(data?.error || `Create failed (${res.status})`);
      }

      const newId = data?.project?.id;
      if (!newId) throw new Error("Retarget succeeded but no project id was returned.");

      toast.success(`Re-targeted — ${data?.appliedTotal ?? 0} replacements`);
      router.push(`/editor/${newId}`);
    } catch (err) {
      console.error("Error creating retargeted site:", err);
      setError(err instanceof Error ? err.message : "Couldn't create the site. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onOpenChange(false)}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto bg-zinc-950/95 backdrop-blur-2xl border-white/10 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-primary" />
            Re-target to a URL
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Paste the new firm&apos;s website. We&apos;ll read their public
            identity and clone{project ? ` "${project.name}"` : " this template"}{" "}
            into a fresh, re-skinned site — no JSON required.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="retarget-url" className="text-zinc-200">
              Target firm website
            </Label>
            <Input
              id="retarget-url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://www.theirlawfirm.com"
              className="bg-zinc-900/50 border-white/10 focus-visible:ring-primary text-white"
              autoFocus
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="retarget-name" className="text-zinc-200">
              New project name <span className="text-zinc-500">(optional)</span>
            </Label>
            <Input
              id="retarget-name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Defaults to the firm name we find"
              className="bg-zinc-900/50 border-white/10 focus-visible:ring-primary text-white"
            />
          </div>

          {/* Preview result — extracted identity as editable overrides. */}
          {target && (
            <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <Globe className="w-4 h-4 text-primary" />
                What we found
              </div>
              <p className="text-xs text-zinc-400 -mt-1">
                Edit anything below before creating the site. Highlighted fields
                were not found on the page and must be filled in.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.map((f) => {
                  const isMissing = missing.includes(f.key);
                  return (
                    <div key={f.key} className="flex flex-col gap-1.5">
                      <Label
                        htmlFor={`retarget-${f.key}`}
                        className={isMissing ? "text-amber-400 text-xs" : "text-zinc-300 text-xs"}
                      >
                        {f.label}
                        {isMissing && " — required"}
                      </Label>
                      <Input
                        id={`retarget-${f.key}`}
                        value={valueFor(f.key)}
                        onChange={(e) => setOverride(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        className={
                          isMissing
                            ? "bg-zinc-900/50 border-amber-500/40 focus-visible:ring-amber-400 text-white text-sm h-9"
                            : "bg-zinc-900/50 border-white/10 focus-visible:ring-primary text-white text-sm h-9"
                        }
                      />
                    </div>
                  );
                })}
              </div>

              {imagesNeedingReplacement.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-zinc-900/40 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
                    <ImageOff className="w-3.5 h-3.5 text-amber-400" />
                    Images to replace after creating ({imagesNeedingReplacement.length})
                  </div>
                  <ul className="text-[11px] text-zinc-500 leading-relaxed list-disc pl-4">
                    {imagesNeedingReplacement.slice(0, 6).map((img, i) => (
                      <li key={i} className="truncate">{img}</li>
                    ))}
                    {imagesNeedingReplacement.length > 6 && (
                      <li>+{imagesNeedingReplacement.length - 6} more…</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-400 leading-snug">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handlePreview}
            disabled={busy || !sourceUrl.trim()}
            className="border-white/10 bg-zinc-900 hover:bg-white/10 text-white"
          >
            {previewing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Reading site...
              </>
            ) : target ? (
              "Re-check"
            ) : (
              "Preview"
            )}
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={busy || !sourceUrl.trim() || !target}
            className="bg-primary text-primary-foreground font-medium"
          >
            {creating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Create site
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
