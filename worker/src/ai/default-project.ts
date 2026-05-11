import { shadcnFiles } from "./shadcn-components";

export const defaultFiles: Record<string, string> = {
  // shadcn/ui components (pre-installed, AI can import directly)
  ...shadcnFiles,
  "/src/__lovable_select_runtime.ts": `// /src/__lovable_select_runtime.ts
// AUTO-GENERATED — do not edit manually.
// Listens for "lovable-select" postMessages from the parent window.
// On enable: attaches DOM listeners; on element click, posts selection back.
// On disable: detaches everything; zero residual cost.

type Sel = {
  tag: string;
  text: string;
  selectorPath: string;
  attributes: Record<string, string>;
  computedStyles: Record<string, string>;
  outerHTML: string;
  ancestorContext: string;
  bbox: { x: number; y: number; width: number; height: number };
};

const STYLE_PROPS = [
  "color", "background-color", "background-image",
  "font-size", "font-family", "font-weight", "line-height", "text-align",
  "padding", "margin", "border", "border-radius",
  "width", "height", "display", "position",
  "opacity", "transform", "box-shadow",
  "gap", "justify-content", "align-items",
] as const;

const EXCLUDED_TAGS = new Set(["html", "body", "head", "script", "style"]);

let active = false;
let hoverPill: HTMLDivElement | null = null;
let selectedEl: HTMLElement | null = null;
let selectedBadge: HTMLDivElement | null = null;
let injectedStyle: HTMLStyleElement | null = null;

const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n) + "…");

function send(type: string, payload: unknown = {}) {
  parent.postMessage({ source: "lovable-select", v: 1, type, payload }, "*");
}

function buildSelectorPath(el: HTMLElement): string {
  const parts: string[] = [];
  let node: HTMLElement | null = el;
  while (node && node.tagName.toLowerCase() !== "body" && parts.length < 6) {
    const tag = node.tagName.toLowerCase();
    let part = tag;
    if (node.id) {
      part += "#" + node.id;
      parts.unshift(part);
      break;
    }
    if (node.className && typeof node.className === "string") {
      const cls = node.className.trim().split(/\\s+/).slice(0, 2).join(".");
      if (cls) part += "." + cls;
    }
    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === node!.tagName,
      );
      if (sameTag.length > 1) {
        const idx = sameTag.indexOf(node) + 1;
        part += \`:nth-of-type(\${idx})\`;
      }
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}

function extractStyles(el: HTMLElement): Record<string, string> {
  const cs = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const p of STYLE_PROPS) {
    const v = cs.getPropertyValue(p).trim();
    if (
      !v ||
      v === "none" ||
      v === "auto" ||
      v === "0px" ||
      v === "rgba(0, 0, 0, 0)" ||
      v === "normal"
    )
      continue;
    out[p] = v;
  }
  return out;
}

function extractAttrs(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name === "style") continue;
    if (a.value.length > 200) continue;
    out[a.name] = a.value;
  }
  return out;
}

function ancestorContext(el: HTMLElement): string {
  const parts: string[] = [];
  let node = el.parentElement;
  let depth = 0;
  while (node && depth < 3 && node.tagName.toLowerCase() !== "body") {
    const tag = node.tagName.toLowerCase();
    const cls = (node.className && typeof node.className === "string")
      ? node.className.trim().split(/\\s+/)[0]
      : "";
    const text = (node.innerText || "").trim().slice(0, 40);
    parts.push(
      \`<\${tag}\${cls ? \`.\${cls}\` : ""}>\${text ? \` "\${text}"\` : ""}\`,
    );
    node = node.parentElement;
    depth++;
  }
  return truncate(parts.join(" / "), 300);
}

function buildSelection(el: HTMLElement): Sel {
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    text: truncate((el.innerText || "").trim(), 200),
    selectorPath: buildSelectorPath(el),
    attributes: extractAttrs(el),
    computedStyles: extractStyles(el),
    outerHTML: truncate(el.outerHTML, 1000),
    ancestorContext: ancestorContext(el),
    bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}

function clearSelected() {
  if (selectedEl) {
    selectedEl.style.outline = "";
    selectedEl.style.outlineOffset = "";
  }
  selectedEl = null;
  if (selectedBadge) {
    selectedBadge.remove();
    selectedBadge = null;
  }
}

function isSelectable(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  return !EXCLUDED_TAGS.has(el.tagName.toLowerCase());
}

function onMouseMove(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (!isSelectable(t)) {
    if (hoverPill) hoverPill.style.display = "none";
    return;
  }
  if (t === selectedEl) {
    if (hoverPill) hoverPill.style.display = "none";
    return;
  }
  if (!hoverPill) {
    hoverPill = document.createElement("div");
    Object.assign(hoverPill.style, {
      position: "fixed",
      background: "#0a0a0a",
      color: "white",
      padding: "2px 6px",
      font: "11px/1.2 ui-monospace, monospace",
      borderRadius: "4px",
      pointerEvents: "none",
      zIndex: "2147483647",
      maxWidth: "300px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    document.body.appendChild(hoverPill);
  }
  const text = truncate((t.innerText || "").trim(), 30);
  const cls = (t.className && typeof t.className === "string")
    ? t.className.trim().split(/\\s+/)[0]
    : "";
  hoverPill.textContent = \`\${t.tagName.toLowerCase()}\${cls ? \`.\${cls}\` : ""}\${text ? \` \\u00b7 "\${text}"\` : ""}\`;
  hoverPill.style.display = "block";
  hoverPill.style.left = \`\${e.clientX + 12}px\`;
  hoverPill.style.top = \`\${e.clientY + 12}px\`;
}

function onMouseOver(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (!isSelectable(t) || t === selectedEl) return;
  t.style.outline = "2px dashed rgb(59,130,246)";
  t.style.outlineOffset = "2px";
}

function onMouseOut(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (!isSelectable(t) || t === selectedEl) return;
  t.style.outline = "";
  t.style.outlineOffset = "";
}

function onClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const t = e.target as HTMLElement | null;
  if (!isSelectable(t)) {
    clearSelected();
    send("cleared");
    return;
  }
  clearSelected();
  selectedEl = t;
  t.style.outline = "2px solid rgb(59,130,246)";
  t.style.outlineOffset = "2px";
  send("selected", buildSelection(t));
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    clearSelected();
    send("cleared");
  }
}

function enable() {
  if (active) return;
  active = true;
  if (!injectedStyle) {
    injectedStyle = document.createElement("style");
    injectedStyle.textContent = "html, body { cursor: crosshair !important; }";
    document.head.appendChild(injectedStyle);
  }
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
}

function disable() {
  if (!active) return;
  active = false;
  if (injectedStyle) {
    injectedStyle.remove();
    injectedStyle = null;
  }
  if (hoverPill) {
    hoverPill.remove();
    hoverPill = null;
  }
  clearSelected();
  document.removeEventListener("mousemove", onMouseMove, true);
  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("mouseout", onMouseOut, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKey, true);
}

window.addEventListener("message", (event) => {
  const d = event.data;
  if (!d || d.source !== "lovable-select" || d.v !== 1) return;
  if (d.type === "enable") enable();
  else if (d.type === "disable") disable();
});

// Handshake: announce ready on load and any subsequent DOM-content event.
const announceReady = () => send("ready");
if (document.readyState === "complete" || document.readyState === "interactive") {
  announceReady();
} else {
  document.addEventListener("DOMContentLoaded", announceReady, { once: true });
}
window.addEventListener("load", announceReady);
`,
  "/public/index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      body {
        font-family: 'Inter', sans-serif;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`,
  "/package.json": `{
  "name": "lovable-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "framer-motion": "^11.0.8",
    "lucide-react": "^0.344.0",
    "date-fns": "^3.6.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.1.4"
  }
}`,
  "/src/index.tsx": `import "./__lovable_select_runtime";
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);`,
  "/src/styles.css": `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;

    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;

    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;

    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;

    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;

    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;

    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;

    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;

    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;

    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;

    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;

    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;

    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;

    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;

    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;

    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;

    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;

    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}`,
  "/src/lib/utils.ts": `import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}`,
  "/src/App.tsx": `import React from 'react';
import { Sparkles } from 'lucide-react';

export default function App() {
  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center p-4 bg-purple-500/10 rounded-full mb-4">
          <Sparkles className="w-12 h-12 text-purple-400" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">Your Empty Canvas</h1>
        <p className="text-lg text-neutral-400">
          Describe what you want to build in the chat, and I'll generate the code for you.
        </p>
      </div>
    </div>
  );
}`
};
