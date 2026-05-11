/**
 * Types for the multi-page build orchestrator (Ralph Loop).
 */

export interface DesignSystem {
  colors: {
    primary: string;
    secondary: string;
    accent?: string;
    background?: string;
    text?: string;
  };
  fonts: {
    heading?: string;
    body?: string;
  };
  spacing?: {
    section?: string;
    container?: string;
  };
  // Free-form notes the AI should follow (e.g. "use rounded corners", "minimal shadows")
  notes?: string;
}

export interface PageSection {
  name: string;
  description?: string;
  // Reference to content keys, e.g. "hero" -> content.en.home.hero
  contentRef?: string;
}

export interface PageSpec {
  name: string;
  // URL slug, e.g. "auto-insurance" -> /auto-insurance
  slug: string;
  // Sections this page should contain
  sections: PageSection[];
  // Which content keys apply to this page
  contentRef?: string;
  // SEO metadata
  seo?: {
    title?: string;
    description?: string;
    keywords?: string[];
  };
  // Status tracking (filled during build)
  status?: "pending" | "generating" | "done" | "error";
}

export interface SharedComponent {
  name: string;
  description: string;
  // File path where it should live, e.g. "/src/components/Header.tsx"
  filePath: string;
}

export interface BuildPlan {
  // Business context
  businessName: string;
  businessType: string;
  description: string;
  // Pages to generate
  pages: PageSpec[];
  // Shared components (Header, Footer, LanguageToggle, etc.)
  sharedComponents: SharedComponent[];
  // Visual design rules
  designSystem: DesignSystem;
  // Content files (en.json / es.json structure)
  contentFiles?: Record<string, any>;
  // Whether this is a bilingual site
  bilingual?: boolean;
  // Default language
  defaultLanguage?: "en" | "es";
  // Free-form instructions the build should follow
  globalInstructions?: string;
}

export interface BuildManifest {
  plan: BuildPlan;
  // Current files in the project (accumulated across batches)
  files: Record<string, string>;
  // Dependencies detected
  dependencies: Record<string, string>;
  // Pages completed so far
  completedPages: string[];
  // Current batch index
  currentBatch: number;
  // Total batches
  totalBatches: number;
  // Batch groupings
  batches: PageSpec[][];
}

// SSE event types sent to the frontend
export type BuildEvent =
  | { type: "build_start"; totalPages: number; totalBatches: number }
  | { type: "batch_start"; batchIndex: number; totalBatches: number; pages: string[] }
  | { type: "batch_stream"; content: string }
  | { type: "batch_done"; batchIndex: number; files: Record<string, string> }
  | { type: "page_status"; page: string; status: "generating" | "done" | "error" }
  | { type: "build_complete"; files: Record<string, string>; totalPages: number; version: number }
  | { type: "error"; error: string; batchIndex?: number };
