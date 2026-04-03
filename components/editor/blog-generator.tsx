"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FileText,
  Plus,
  Trash2,
  Loader2,
  Sparkles,
  CheckCircle,
  XCircle,
  Wand2,
} from "lucide-react";
import { WORKER_URL } from "@/lib/constants";

interface BlogTopic {
  title: string;
  keywords: string[];
}

interface BlogGeneratorProps {
  projectId: string;
  contextFiles: Record<string, string>;
  onUpdateFiles: (files: Record<string, string>) => void;
}

// Pre-built blog topic ideas by business type
const TOPIC_PRESETS: Record<string, BlogTopic[]> = {
  "home-services": [
    { title: "How to Choose the Right Contractor in McAllen", keywords: ["contractor mcallen", "home improvement"] },
    { title: "5 Signs Your AC Needs Repair", keywords: ["ac repair", "hvac maintenance"] },
    { title: "DIY vs Professional Home Repairs", keywords: ["home repairs", "professional contractor"] },
    { title: "Seasonal Home Maintenance Checklist", keywords: ["home maintenance", "seasonal checklist"] },
    { title: "How to Increase Your Home Value", keywords: ["home value", "home improvement roi"] },
  ],
  "medical-dental": [
    { title: "The Importance of Regular Dental Checkups", keywords: ["dental checkup", "dentist near me"] },
    { title: "What to Expect During Your First Visit", keywords: ["first dental visit", "new patient"] },
    { title: "Top 5 Cosmetic Dental Procedures", keywords: ["cosmetic dentistry", "smile makeover"] },
    { title: "How to Maintain Oral Health at Home", keywords: ["oral health", "dental hygiene tips"] },
    { title: "Understanding Dental Insurance Coverage", keywords: ["dental insurance", "affordable dental care"] },
  ],
  "restaurant-food": [
    { title: "The Story Behind Our Most Popular Dish", keywords: ["best restaurant", "local food"] },
    { title: "5 Must-Try Items on Our Menu", keywords: ["menu favorites", "best food mcallen"] },
    { title: "How We Source Our Fresh Ingredients", keywords: ["fresh ingredients", "farm to table"] },
    { title: "Planning the Perfect Catering Event", keywords: ["catering services", "event planning"] },
    { title: "Our Kitchen: A Behind the Scenes Look", keywords: ["restaurant kitchen", "chef story"] },
  ],
  "professional-services": [
    { title: "What to Look for in a Professional Service", keywords: ["professional services", "how to choose"] },
    { title: "Common Mistakes to Avoid", keywords: ["professional advice", "common mistakes"] },
    { title: "Questions to Ask Before Hiring", keywords: ["hiring guide", "what to ask"] },
    { title: "How Our Process Works", keywords: ["our process", "what to expect"] },
    { title: "Client Success Stories", keywords: ["success stories", "client results"] },
  ],
  "fitness-wellness": [
    { title: "5 Benefits of Regular Exercise", keywords: ["exercise benefits", "fitness tips"] },
    { title: "Nutrition Tips for Better Results", keywords: ["nutrition tips", "healthy eating"] },
    { title: "How to Stay Motivated", keywords: ["fitness motivation", "workout tips"] },
    { title: "Beginner's Guide to Getting Started", keywords: ["beginner fitness", "getting started"] },
    { title: "Recovery: The Most Important Step", keywords: ["recovery tips", "muscle recovery"] },
  ],
  "auto-services": [
    { title: "5 Warning Signs Your Car Needs Service", keywords: ["car repair", "auto service"] },
    { title: "How Often Should You Change Your Oil?", keywords: ["oil change", "car maintenance"] },
    { title: "The True Cost of Skipping Maintenance", keywords: ["car maintenance cost", "preventive care"] },
    { title: "Choosing the Right Tires for Your Vehicle", keywords: ["tire selection", "tire shop"] },
    { title: "What to Do After a Car Accident", keywords: ["car accident", "auto body repair"] },
  ],
};

export function BlogGenerator({ projectId, contextFiles, onUpdateFiles }: BlogGeneratorProps) {
  const [open, setOpen] = useState(false);
  const [topics, setTopics] = useState<BlogTopic[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; title: string; status: string } | null>(null);
  const [results, setResults] = useState<Array<{ title: string; slug: string; status: "success" | "error" }>>([]);
  const [presetKey, setPresetKey] = useState<string>("");
  const [newTitle, setNewTitle] = useState("");
  const [newKeywords, setNewKeywords] = useState("");

  const { getToken } = useAuth();

  function handleLoadPreset(key: string) {
    setPresetKey(key);
    setTopics(TOPIC_PRESETS[key] || []);
  }

  function handleAddTopic() {
    if (!newTitle.trim()) return;
    setTopics([...topics, {
      title: newTitle.trim(),
      keywords: newKeywords.split(",").map(k => k.trim()).filter(Boolean),
    }]);
    setNewTitle("");
    setNewKeywords("");
  }

  function handleRemoveTopic(index: number) {
    setTopics(topics.filter((_, i) => i !== index));
  }

  async function handleGenerate() {
    if (topics.length === 0) return;
    setGenerating(true);
    setResults([]);
    setProgress({ current: 0, total: topics.length, title: "", status: "starting" });

    try {
      const token = await getToken();

      // Extract business info from project memory or use defaults
      // In practice, this comes from the project's template generation data
      const businessInfo = {
        businessName: "Custom Designs TX",
        phone: "(956) 624-2463",
        email: "info@customdesignstx.com",
        city: "McAllen",
        state: "TX",
        primaryColor: "#2563eb",
        secondaryColor: "#1e40af",
        tagline: "Premium Home Technology Solutions",
        description: "Custom Designs TX is McAllen's trusted home technology installer.",
        services: [
          { name: "Home Theater", description: "Custom home theater installation", icon: "Monitor" },
          { name: "Smart Home", description: "Smart home automation", icon: "Zap" },
          { name: "Security Cameras", description: "Security camera systems", icon: "Shield" },
        ],
      };

      const res = await fetch(`${WORKER_URL}/api/blog/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectId, topics, businessInfo }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
        setGenerating(false);
        return;
      }

      // Read SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === "progress") {
                  setProgress({
                    current: data.current,
                    total: data.total,
                    title: data.title,
                    status: "generating",
                  });
                } else if (data.type === "blog-done") {
                  setResults(prev => [...prev, { title: data.title, slug: data.slug, status: "success" }]);
                } else if (data.type === "blog-error") {
                  setResults(prev => [...prev, { title: data.title, slug: data.slug, status: "error" }]);
                } else if (data.type === "done") {
                  setProgress(null);
                  if (data.files) {
                    onUpdateFiles(data.files);
                  }
                }
              } catch (e) {
                // Ignore parse errors on partial lines
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Blog generation failed:", err);
      alert("Blog generation failed. Check console for details.");
    }

    setGenerating(false);
  }

  function resetAndClose() {
    setOpen(false);
    setTopics([]);
    setResults([]);
    setProgress(null);
    setGenerating(false);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-zinc-400 hover:text-white hover:bg-zinc-800/50 h-8 px-3 text-xs"
      >
        <FileText className="w-3.5 h-3.5 mr-1.5" />
        Blog Gen
      </Button>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : resetAndClose())}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-purple-400" />
              Blog Batch Generator
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 mt-4">
            {/* Presets */}
            <div>
              <Label className="text-zinc-400 text-sm">Quick Start — Load Topic Preset</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(TOPIC_PRESETS).map(([key, presets]) => (
                  <button
                    key={key}
                    onClick={() => handleLoadPreset(key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      presetKey === key
                        ? "bg-purple-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                    }`}
                  >
                    {key.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase())} ({presets.length})
                  </button>
                ))}
              </div>
            </div>

            {/* Add custom topic */}
            <div className="border border-zinc-700 rounded-xl p-4 space-y-3">
              <Label className="text-zinc-400 text-sm">Add Custom Topic</Label>
              <div className="flex gap-2">
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Blog post title..."
                  className="bg-zinc-800 border-zinc-700 text-white flex-1"
                  onKeyDown={(e) => e.key === "Enter" && handleAddTopic()}
                />
                <Input
                  value={newKeywords}
                  onChange={(e) => setNewKeywords(e.target.value)}
                  placeholder="keyword1, keyword2"
                  className="bg-zinc-800 border-zinc-700 text-white flex-[0.7]"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleAddTopic}
                  disabled={!newTitle.trim()}
                  className="shrink-0 text-purple-400 hover:text-purple-300"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Topic list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-zinc-400 text-sm">
                  Topics ({topics.length})
                </Label>
                {topics.length > 0 && (
                  <button
                    onClick={() => setTopics([])}
                    className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    Clear All
                  </button>
                )}
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-2">
                {topics.length === 0 ? (
                  <p className="text-sm text-zinc-600 py-4 text-center">
                    Load a preset or add custom topics above
                  </p>
                ) : (
                  topics.map((topic, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 p-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50 group"
                    >
                      <FileText className="w-4 h-4 text-zinc-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{topic.title}</p>
                        {topic.keywords.length > 0 && (
                          <p className="text-xs text-zinc-500 truncate">
                            {topic.keywords.join(", ")}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveTopic(i)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Progress */}
            {generating && progress && (
              <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                  <div>
                    <p className="text-sm font-medium text-white">
                      Generating {progress.current}/{progress.total}
                    </p>
                    <p className="text-xs text-zinc-400 truncate">{progress.title}</p>
                  </div>
                </div>
                <div className="mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 transition-all duration-500"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Results */}
            {results.length > 0 && (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-2">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {r.status === "success" ? (
                      <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <span className={r.status === "success" ? "text-green-300" : "text-red-300"}>
                      {r.title}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Generate button */}
            <Button
              onClick={handleGenerate}
              disabled={generating || topics.length === 0}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating {results.length}/{topics.length} blogs...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate {topics.length} Blog Post{topics.length !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
