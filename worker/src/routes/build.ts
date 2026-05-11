import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { hasEnoughCredits, deductCredit } from "../services/credits";
import {
  createManifest,
  generateBatch,
} from "../services/build-orchestrator";
import { BuildPlan, BuildEvent, PageSpec } from "../ai/build-types";

const buildRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

buildRouter.use("*", authMiddleware);

/**
 * POST /api/build/:projectId
 *
 * Multi-page build orchestrator (Ralph Loop).
 *
 * Body:
 *   buildPlan?: BuildPlan    — structured build spec (if you have one)
 *   description?: string     — freeform description (AI will plan from this)
 *   contentFiles?: object    — en.json/es.json content files
 *   model?: string           — AI model to use (default: moonshotai/kimi-k2.6)
 *   existingFiles?: object   — files already in the project
 *
 * Streams SSE events: build_start, batch_start, batch_stream, batch_done, page_status, build_complete, error
 */
buildRouter.post("/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    // 1. Check credits
    const { hasCredits } = await hasEnoughCredits(userId, kv);
    if (!hasCredits) {
      return c.json({ error: "Insufficient credits. Please upgrade to continue." }, 402);
    }

    // 2. Parse request
    const body = await c.req.json();
    const {
      buildPlan,
      description,
      contentFiles,
      model = "moonshotai/kimi-k2.6",
      existingFiles = {},
    } = body;

    // 3. Verify project exists
    const projectExists = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectExists) return c.json({ error: "Project not found" }, 404);

    // 4. Resolve build plan
    let plan: BuildPlan;

    if (buildPlan) {
      // Direct build plan provided
      plan = buildPlan as BuildPlan;
    } else if (description) {
      // Generate a build plan from description
      plan = generatePlanFromDescription(description, contentFiles);
    } else {
      return c.json({ error: "Must provide either buildPlan or description" }, 400);
    }

    // 5. Load existing project files if any
    const latestVersionStr = await kv.get(`project:${projectId}:latest_version`);
    let projectFiles: Record<string, string> = { ...existingFiles };

    if (latestVersionStr) {
      try {
        const latestData = await r2.get(`${projectId}/v${latestVersionStr}.json`);
        if (latestData) {
          const versionData = JSON.parse(await latestData.text());
          if (versionData.files) {
            projectFiles = { ...versionData.files, ...existingFiles };
          }
        }
      } catch (err) {
        console.error("Failed to load latest version:", err);
      }
    }

    // 6. Initialize manifest
    const manifest = createManifest(plan, projectFiles);

    // 7. Deduct credits (1 per batch)
    const creditsNeeded = manifest.totalBatches;
    const { hasCredits: hasEnough } = await hasEnoughCredits(userId, kv);
    if (!hasEnough) {
      return c.json({
        error: `Need ${creditsNeeded} credits for ${plan.pages.length} pages (${manifest.totalBatches} batches). Please upgrade.`
      }, 402);
    }

    // 8. Stream the build
    return streamSSE(c, async (stream) => {
      const sendEvent = async (event: BuildEvent) => {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: "message",
        });
      };

      try {
        // Build start
        await sendEvent({
          type: "build_start",
          totalPages: plan.pages.length,
          totalBatches: manifest.totalBatches,
        });

        // Process each batch
        for (let i = 0; i < manifest.totalBatches; i++) {
          const updatedManifest = await generateBatch(
            manifest,
            i,
            {
              openrouter: c.env.OPENROUTER_API_KEY,
              openai: (c.env as any).OPENAI_API_KEY,
              anthropic: (c.env as any).ANTHROPIC_API_KEY,
            },
            model,
            c.env.FAL_KEY,
            sendEvent,
            {
              r2,
              projectId,
              publicBaseUrl: new URL(c.req.url).origin,
            },
          );

          // Update manifest reference
          Object.assign(manifest, updatedManifest);

          // Deduct 1 credit per batch
          await deductCredit(userId, 1, kv);

          // Save version after each batch (so partial progress is saved)
          const currentVersionStr = await kv.get(`project:${projectId}:latest_version`);
          const newVersionNum = parseInt(currentVersionStr || "0") + 1;

          const versionData = {
            version: newVersionNum,
            createdAt: new Date().toISOString(),
            prompt: `Build batch ${i + 1}/${manifest.totalBatches}: ${manifest.batches[i].map(p => p.name).join(", ")}`,
            files: manifest.files,
          };

          await r2.put(`${projectId}/v${newVersionNum}.json`, JSON.stringify(versionData));
          await kv.put(`project:${projectId}:latest_version`, newVersionNum.toString());
        }

        // Build complete
        const finalVersionStr = await kv.get(`project:${projectId}:latest_version`);

        // Save chat history entry
        const chatHistoryStr = await kv.get(`project:${projectId}:chat_history`);
        const chatHistory: Array<{ role: string; summary: string }> = chatHistoryStr
          ? JSON.parse(chatHistoryStr)
          : [];
        chatHistory.push({
          role: "user",
          summary: `Build: ${plan.businessName} — ${plan.pages.length} pages`,
        });
        chatHistory.push({
          role: "assistant",
          summary: `Generated ${plan.pages.length} pages: ${plan.pages.map(p => p.name).join(", ")}`,
        });
        await kv.put(`project:${projectId}:chat_history`, JSON.stringify(chatHistory.slice(-10)));

        // Save project memory
        const memoryStr = await kv.get(`project:${projectId}:memory`);
        const newMemory = [
          memoryStr || "",
          `\nMulti-page build: ${plan.businessName} (${plan.businessType})`,
          `Pages: ${plan.pages.map(p => p.name).join(", ")}`,
          `Bilingual: ${plan.bilingual ? "yes" : "no"}`,
        ]
          .filter(Boolean)
          .join("\n");
        await kv.put(`project:${projectId}:memory`, newMemory);

        await sendEvent({
          type: "build_complete",
          files: manifest.files,
          totalPages: plan.pages.length,
          version: parseInt(finalVersionStr || "1"),
        });
      } catch (error: any) {
        console.error("Build orchestrator error:", error);
        await sendEvent({
          type: "error",
          error: error.message || "Build failed",
        });
      }
    });
  } catch (error) {
    console.error("Build route error:", error);
    return c.json({ error: "Failed to start build" }, 500);
  }
});

/**
 * Generate a basic BuildPlan from a freeform description.
 * This is the "regular level" mode — just describe what you want.
 */
function generatePlanFromDescription(
  description: string,
  contentFiles?: Record<string, any>,
): BuildPlan {
  const lowerDesc = description.toLowerCase();

  // Detect bilingual
  const bilingual =
    lowerDesc.includes("bilingual") ||
    lowerDesc.includes("spanish") ||
    lowerDesc.includes("español") ||
    lowerDesc.includes("en/es") ||
    !!contentFiles?.es;

  // Detect business type
  let businessType = "business";
  const typeKeywords: Record<string, string[]> = {
    insurance: ["insurance", "coverage", "policy", "auto insurance", "medicare"],
    "real estate": ["real estate", "realtor", "property", "homes", "listing"],
    restaurant: ["restaurant", "food", "menu", "dining", "cafe"],
    medical: ["medical", "doctor", "clinic", "health", "dental", "dental"],
    construction: ["construction", "builder", "contractor", "remodel"],
    fitness: ["gym", "fitness", "workout", "personal trainer"],
    legal: ["law", "lawyer", "attorney", "legal"],
    automotive: ["auto", "car", "mechanic", "automotive"],
  };

  for (const [type, keywords] of Object.entries(typeKeywords)) {
    if (keywords.some((kw) => lowerDesc.includes(kw))) {
      businessType = type;
      break;
    }
  }

  // Extract business name from description
  const nameMatch = description.match(/(?:for|called|named|business|company)\s+["""]?([A-Z][A-Za-z\s&]+)["""]?/i);
  const businessName = nameMatch?.[1]?.trim() || "My Business";

  // Generate standard pages based on business type
  const pages: PageSpec[] = [
    {
      name: "Home",
      slug: "",
      sections: [
        { name: "Hero", description: "Main hero section with headline and CTA" },
        { name: "Features", description: "Key services or features" },
        { name: "About", description: "Brief about section" },
        { name: "Testimonials", description: "Customer reviews" },
        { name: "CTA", description: "Call to action" },
      ],
      contentRef: "home",
      seo: { title: `${businessName} — Home`, description: description.slice(0, 160) },
    },
    {
      name: "About Us",
      slug: "about",
      sections: [
        { name: "AboutHero", description: "About page hero" },
        { name: "Story", description: "Company story" },
        { name: "Team", description: "Team members" },
        { name: "Values", description: "Company values" },
      ],
      contentRef: "about",
      seo: { title: `About — ${businessName}` },
    },
    {
      name: "Services",
      slug: "services",
      sections: [
        { name: "ServicesHero", description: "Services overview" },
        { name: "ServiceList", description: "List of services" },
        { name: "WhyChooseUs", description: "Why choose us section" },
      ],
      contentRef: "services",
      seo: { title: `Services — ${businessName}` },
    },
    {
      name: "Contact",
      slug: "contact",
      sections: [
        { name: "ContactHero", description: "Contact page header" },
        { name: "ContactForm", description: "Contact form" },
        { name: "ContactInfo", description: "Phone, email, address" },
        { name: "Map", description: "Location map" },
      ],
      contentRef: "contact",
      seo: { title: `Contact — ${businessName}` },
    },
  ];

  // Add business-type-specific pages
  if (businessType === "insurance") {
    pages.splice(1, 0,
      {
        name: "Auto Insurance",
        slug: "auto-insurance",
        sections: [
          { name: "Hero", description: "Auto insurance hero" },
          { name: "Coverage", description: "Coverage types" },
          { name: "Benefits", description: "Benefits" },
          { name: "QuoteCTA", description: "Get a quote" },
        ],
        contentRef: "auto",
        seo: { title: `Auto Insurance — ${businessName}` },
      },
      {
        name: "Home Insurance",
        slug: "home-insurance",
        sections: [
          { name: "Hero", description: "Home insurance hero" },
          { name: "Coverage", description: "Coverage details" },
          { name: "Benefits", description: "Benefits" },
          { name: "QuoteCTA", description: "Get a quote" },
        ],
        contentRef: "home-insurance",
        seo: { title: `Home Insurance — ${businessName}` },
      }
    );
  }

  // Shared components
  const sharedComponents = [
    {
      name: "Header",
      description: "Navigation header with logo, nav links, phone number, and mobile menu",
      filePath: "/src/components/Header.tsx",
    },
    {
      name: "Footer",
      description: "Footer with contact info, links, and copyright",
      filePath: "/src/components/Footer.tsx",
    },
  ];

  if (bilingual) {
    sharedComponents.push({
      name: "LanguageToggle",
      description: "EN/ES language switcher button",
      filePath: "/src/components/LanguageToggle.tsx",
    });
  }

  return {
    businessName,
    businessType,
    description,
    pages,
    sharedComponents,
    designSystem: {
      colors: {
        primary: "#1e40af",
        secondary: "#0f172a",
        accent: "#3b82f6",
        background: "#ffffff",
        text: "#1f2937",
      },
      fonts: {
        heading: "Inter",
        body: "Inter",
      },
      notes: "Clean, professional, modern design. Responsive mobile-first.",
    },
    contentFiles,
    bilingual,
    defaultLanguage: "en",
  };
}

export default buildRouter;
