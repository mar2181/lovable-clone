"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/dev-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LayoutTemplate,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Palette,
  Plus,
  Trash2,
  Check,
} from "lucide-react";
import { WORKER_URL } from "@/lib/constants";

// Icon map for template previews
const ICON_MAP: Record<string, string> = {
  Hammer: "🔨",
  Stethoscope: "🦷",
  UtensilsCrossed: "🍽️",
  Briefcase: "💼",
  Dumbbell: "💪",
  Car: "🚗",
};

interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  defaultServices: Array<{ name: string; description: string; icon: string }>;
  defaultPages: string[];
  colorSchemes: Array<{ name: string; primary: string; secondary: string; accent: string }>;
}

interface ServiceInput {
  name: string;
  description: string;
  icon: string;
}

export function TemplatePicker() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"template" | "info" | "colors">("template");
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateInfo | null>(null);

  // Business info form
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("TX");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [services, setServices] = useState<ServiceInput[]>([]);
  const [selectedColorScheme, setSelectedColorScheme] = useState(0);

  const { getToken } = useAuth();
  const router = useRouter();

  // Fetch templates when dialog opens
  useEffect(() => {
    if (open && templates.length === 0) {
      fetchTemplates();
    }
  }, [open]);

  async function fetchTemplates() {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/template`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates);
      }
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    }
    setLoading(false);
  }

  function handleSelectTemplate(t: TemplateInfo) {
    setSelectedTemplate(t);
    setServices(
      t.defaultServices.map((s) => ({
        name: s.name,
        description: s.description,
        icon: s.icon,
      }))
    );
    setStep("info");
  }

  function handleAddService() {
    setServices([...services, { name: "", description: "", icon: "Star" }]);
  }

  function handleRemoveService(index: number) {
    setServices(services.filter((_, i) => i !== index));
  }

  function handleServiceChange(index: number, field: keyof ServiceInput, value: string) {
    const updated = [...services];
    updated[index] = { ...updated[index], [field]: value };
    setServices(updated);
  }

  async function handleGenerate() {
    if (!selectedTemplate || !businessName) return;
    setGenerating(true);

    try {
      const token = await getToken();
      const colorScheme = selectedTemplate.colorSchemes[selectedColorScheme];

      const res = await fetch(`${WORKER_URL}/api/template/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          businessInfo: {
            businessName,
            phone: phone || "(956) 555-0100",
            email: email || `info@${businessName.toLowerCase().replace(/\s+/g, "")}.com`,
            address: address || "123 Main St",
            city: city || "McAllen",
            state: stateVal,
            primaryColor: colorScheme.primary,
            secondaryColor: colorScheme.secondary,
            tagline: tagline || `Your Trusted ${selectedTemplate.name} Partner`,
            description: description || `Professional ${selectedTemplate.name.toLowerCase()} services in ${city || "McAllen"}, ${stateVal}. Quality work, fair prices, and customer satisfaction guaranteed.`,
            services: services.filter((s) => s.name.trim()),
            pages: selectedTemplate.defaultPages,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setOpen(false);
        // Navigate to the new project
        router.push(`/editor/${data.project.id}`);
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (err) {
      console.error("Generation failed:", err);
      alert("Failed to generate project. Please try again.");
    }
    setGenerating(false);
  }

  function resetAndClose() {
    setOpen(false);
    setStep("template");
    setSelectedTemplate(null);
    setBusinessName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setCity("");
    setTagline("");
    setDescription("");
    setServices([]);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : resetAndClose())}>
        <Button
          variant="outline"
          className="border-dashed border-2 border-zinc-700 hover:border-purple-500/50 hover:bg-purple-500/5 text-zinc-400 hover:text-white h-auto py-4 px-6"
          onClick={() => setOpen(true)}
        >
          <LayoutTemplate className="w-4 h-4 mr-2" />
          Use Template
        </Button>

      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-800 text-white">
        {/* STEP 1: Pick Template */}
        {step === "template" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <LayoutTemplate className="w-5 h-5 text-purple-400" />
                Choose a Template
              </DialogTitle>
            </DialogHeader>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 mt-4">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectTemplate(t)}
                    className="p-4 rounded-xl border border-zinc-700 hover:border-purple-500/50 hover:bg-purple-500/5 text-left transition-all group"
                  >
                    <div className="text-3xl mb-2">{ICON_MAP[t.icon] || "📋"}</div>
                    <h3 className="font-semibold text-white group-hover:text-purple-300 transition-colors">
                      {t.name}
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1">{t.description}</p>
                    <div className="flex items-center gap-1 mt-3">
                      {t.colorSchemes.slice(0, 4).map((c, i) => (
                        <div
                          key={i}
                          className="w-4 h-4 rounded-full border border-zinc-600"
                          style={{ background: c.primary }}
                        />
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* STEP 2: Business Info */}
        {step === "info" && selectedTemplate && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <span className="text-2xl">{ICON_MAP[selectedTemplate.icon] || "📋"}</span>
                {selectedTemplate.name} — Business Info
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label className="text-zinc-400 text-sm">Business Name *</Label>
                  <Input
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Smile Bright Dental"
                    className="bg-zinc-800 border-zinc-700 text-white mt-1"
                  />
                </div>
                <div>
                  <Label className="text-zinc-400 text-sm">Phone</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(956) 555-1234"
                    className="bg-zinc-800 border-zinc-700 text-white mt-1"
                  />
                </div>
                <div>
                  <Label className="text-zinc-400 text-sm">Email</Label>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="info@business.com"
                    className="bg-zinc-800 border-zinc-700 text-white mt-1"
                  />
                </div>
                <div>
                  <Label className="text-zinc-400 text-sm">City</Label>
                  <Input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="McAllen"
                    className="bg-zinc-800 border-zinc-700 text-white mt-1"
                  />
                </div>
                <div>
                  <Label className="text-zinc-400 text-sm">State</Label>
                  <Input
                    value={stateVal}
                    onChange={(e) => setStateVal(e.target.value)}
                    placeholder="TX"
                    className="bg-zinc-800 border-zinc-700 text-white mt-1"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-zinc-400 text-sm">Address</Label>
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main St"
                    className="bg-zinc-800 border-zinc-700 text-white mt-1"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-zinc-400 text-sm">Tagline</Label>
                  <Input
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    placeholder="Your Trusted Partner in..."
                    className="bg-zinc-800 border-zinc-700 text-white mt-1"
                  />
                </div>
              </div>

              {/* Services */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-zinc-400 text-sm">Services</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAddService}
                    className="text-xs text-purple-400 hover:text-purple-300"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Service
                  </Button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                  {services.map((service, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <Input
                        value={service.name}
                        onChange={(e) => handleServiceChange(i, "name", e.target.value)}
                        placeholder="Service name"
                        className="bg-zinc-800 border-zinc-700 text-white text-sm flex-1"
                      />
                      <Input
                        value={service.description}
                        onChange={(e) => handleServiceChange(i, "description", e.target.value)}
                        placeholder="Short description"
                        className="bg-zinc-800 border-zinc-700 text-white text-sm flex-[2]"
                      />
                      <button
                        onClick={() => handleRemoveService(i)}
                        className="p-2 text-zinc-500 hover:text-red-400 transition-colors shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep("template")}
                  className="text-zinc-400 hover:text-white"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button
                  onClick={() => setStep("colors")}
                  disabled={!businessName.trim()}
                  className="bg-purple-600 hover:bg-purple-500 text-white"
                >
                  Next: Colors
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </>
        )}

        {/* STEP 3: Color Scheme */}
        {step === "colors" && selectedTemplate && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Palette className="w-5 h-5 text-purple-400" />
                Choose Your Colors
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-1 gap-3">
                {selectedTemplate.colorSchemes.map((scheme, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedColorScheme(i)}
                    className={`flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
                      selectedColorScheme === i
                        ? "border-purple-500 bg-purple-500/10"
                        : "border-zinc-700 hover:border-zinc-600"
                    }`}
                  >
                    <div className="flex gap-2">
                      <div
                        className="w-10 h-10 rounded-lg shadow-inner"
                        style={{ background: scheme.primary }}
                      />
                      <div
                        className="w-10 h-10 rounded-lg shadow-inner"
                        style={{ background: scheme.secondary }}
                      />
                      <div
                        className="w-10 h-10 rounded-lg shadow-inner"
                        style={{ background: scheme.accent }}
                      />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-white">{scheme.name}</p>
                      <p className="text-xs text-zinc-500">{scheme.primary}</p>
                    </div>
                    {selectedColorScheme === i && (
                      <Check className="w-5 h-5 text-purple-400" />
                    )}
                  </button>
                ))}
              </div>

              {/* Preview */}
              <div className="rounded-xl border border-zinc-700 p-6 bg-zinc-800">
                <p className="text-sm text-zinc-400 mb-3">Preview</p>
                <div className="space-y-3">
                  <div
                    className="text-lg font-bold"
                    style={{ color: selectedTemplate.colorSchemes[selectedColorScheme].primary }}
                  >
                    {businessName || "Your Business Name"}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="px-4 py-2 rounded-lg text-white text-sm font-medium"
                      style={{
                        background: selectedTemplate.colorSchemes[selectedColorScheme].primary,
                      }}
                    >
                      Get a Quote
                    </button>
                    <button
                      className="px-4 py-2 rounded-lg text-sm font-medium border"
                      style={{
                        borderColor: selectedTemplate.colorSchemes[selectedColorScheme].primary,
                        color: selectedTemplate.colorSchemes[selectedColorScheme].primary,
                      }}
                    >
                      Call Now
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep("info")}
                  className="text-zinc-400 hover:text-white"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="bg-purple-600 hover:bg-purple-500 text-white px-6"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      Generate Website
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
