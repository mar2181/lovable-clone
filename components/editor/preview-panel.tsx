"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Laptop, Smartphone, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview,
} from "@codesandbox/sandpack-react";
import { atomDark } from "@codesandbox/sandpack-themes";
import { SANDPACK_SHADCN_FILES } from "@/lib/sandpack-shadcn";
import { buildInjectedTsconfig, collectAliases } from "@/lib/sandpack-alias";
import { inlineAssets } from "@/lib/sandpack-assets";
import { SelectModeToggle } from "@/components/editor/select-mode-toggle";
import { MapModeToggle } from "@/components/editor/map-mode-toggle";
import { InspectorPanel } from "@/components/editor/inspector-panel";
import { useSelectStore, makeSelection } from "@/lib/select-store";
import { useMapModeStore } from "@/lib/mapmode-store";
import { toast } from "sonner";

interface PreviewPanelProps {
  files: Record<string, string>;
  dependencies?: Record<string, string>;
  projectId?: string;
  onInlineApplied?: (files: Record<string, string>, deps: Record<string, string>) => void;
  onOpenCode?: () => void;
}

// Inline picker script that runs inside the Sandpack iframe. Listens for
// enable/disable from the parent; on enable, hooks pointer events to draw
// a hover/selection outline and posts the clicked element's metadata back.
// Vanilla JS — no React, no bundler steps. Keep it tight.
const SANDPACK_PICKER_SCRIPT = `
(function(){
  var MSG_SRC = "lovable-select";
  var enabled = false;
  var hoverEl = null;
  var hoverBox = null;
  var selectBox = null;

  function ensureBoxes(){
    if (!hoverBox){
      hoverBox = document.createElement("div");
      hoverBox.style.cssText = "position:fixed;pointer-events:none;border:2px solid rgba(59,130,246,0.65);background:rgba(59,130,246,0.10);z-index:2147483646;transition:all 60ms ease-out;border-radius:2px;display:none;";
      document.body.appendChild(hoverBox);
    }
    if (!selectBox){
      selectBox = document.createElement("div");
      selectBox.style.cssText = "position:fixed;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,0.16);z-index:2147483647;border-radius:2px;display:none;";
      document.body.appendChild(selectBox);
    }
  }

  function paintBox(box, el){
    if (!el || !box){ if (box) box.style.display = "none"; return; }
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0){ box.style.display = "none"; return; }
    box.style.display = "block";
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
  }

  function selectorPath(el){
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 8){
      var part = node.tagName.toLowerCase();
      if (node.id){ part += "#" + node.id; parts.unshift(part); break; }
      if (node.className && typeof node.className === "string"){
        var cls = node.className.trim().split(/\\s+/).slice(0,2).join(".");
        if (cls) part += "." + cls;
      }
      var parent = node.parentElement;
      if (parent){
        var sib = Array.prototype.indexOf.call(parent.children, node);
        if (sib > 0) part += ":nth-child(" + (sib + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
      depth++;
    }
    return parts.join(" > ");
  }

  function pickAttrs(el){
    var attrs = {};
    if (!el.attributes) return attrs;
    for (var i = 0; i < el.attributes.length; i++){
      var a = el.attributes[i];
      attrs[a.name] = a.value;
    }
    return attrs;
  }

  function pickStyles(el){
    var cs = getComputedStyle(el);
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      display: cs.display,
    };
  }

  function ancestorContext(el){
    var bits = [];
    var node = el.parentElement;
    var depth = 0;
    while (node && depth < 4){
      bits.unshift(node.tagName.toLowerCase());
      node = node.parentElement;
      depth++;
    }
    return bits.join(" > ");
  }

  function buildPayload(el){
    var r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").slice(0, 400),
      selectorPath: selectorPath(el),
      attributes: pickAttrs(el),
      computedStyles: pickStyles(el),
      outerHTML: (el.outerHTML || "").slice(0, 4000),
      ancestorContext: ancestorContext(el),
      bbox: { x: r.left, y: r.top, width: r.width, height: r.height },
    };
  }

  function sendUp(type, payload){
    try {
      parent.postMessage({ source: MSG_SRC, v: 1, type: type, payload: payload || {} }, "*");
    } catch(e){}
  }

  function onMouseMove(e){
    if (!enabled) return;
    var el = e.target;
    if (!el || el === hoverBox || el === selectBox) return;
    hoverEl = el;
    ensureBoxes();
    paintBox(hoverBox, el);
  }

  function onMouseOut(){
    if (hoverBox) hoverBox.style.display = "none";
  }

  function onClick(e){
    if (!enabled) return;
    var el = e.target;
    if (!el || el === hoverBox || el === selectBox) return;
    e.preventDefault();
    e.stopPropagation();
    ensureBoxes();
    paintBox(selectBox, el);
    sendUp("selected", buildPayload(el));
  }

  function repaint(){
    if (hoverEl) paintBox(hoverBox, hoverEl);
  }

  function enable(){
    if (enabled) return;
    enabled = true;
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseout", onMouseOut, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", repaint, true);
    window.addEventListener("resize", repaint);
  }

  function disable(){
    enabled = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("scroll", repaint, true);
    window.removeEventListener("resize", repaint);
    if (hoverBox) hoverBox.style.display = "none";
    if (selectBox) selectBox.style.display = "none";
  }

  // ===== MAP MODE (numbered command navigation — docs/SOP_MAP_MODE.md) =====
  var mmActive = false;
  var mmReg = {};
  var mmFocused = null;
  var mmOverlay = null;
  var mmRaf = 0;
  var mmOffset = 0;
  var MM_SEL = "a[href],button,input:not([type=hidden]),select,textarea,[contenteditable],[contenteditable=true],[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=radio],[tabindex],[onclick]";

  function mmVisible(el){
    if (!el || el.nodeType !== 1 || el.disabled) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
    var s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || parseFloat(s.opacity) === 0) return false;
    return true;
  }
  function mmTypeable(el){
    var t = el.tagName;
    if (t === "TEXTAREA") return true;
    if (t === "SELECT") return false;
    if (t === "INPUT"){ var ty = (el.type || "text").toLowerCase(); return ["text","search","email","url","tel","password","number","date","time",""].indexOf(ty) !== -1; }
    return el.isContentEditable === true;
  }
  function mmName(el){
    var role = el.getAttribute("role") || el.tagName.toLowerCase();
    if (el.tagName === "INPUT") role = (el.type || "text") + " input";
    var n = el.getAttribute("aria-label") || el.getAttribute("placeholder") || (el.value ? String(el.value).slice(0,20) : "") || (el.textContent || "").trim().slice(0,24) || el.name || "";
    return (role + (n ? (" " + n.trim()) : "")).slice(0,60);
  }
  function mmClickable(el){
    var tag = el.tagName;
    if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
    var role = el.getAttribute("role");
    if (role && "button link tab menuitem menuitemcheckbox menuitemradio option switch checkbox radio".indexOf(role) !== -1) return true;
    return getComputedStyle(el).cursor === "pointer";
  }
  function mmEnumerate(){
    var seen = [], list = [];
    function mmAdd(el){
      if (!el || el.nodeType !== 1) return;
      if (el === mmOverlay || (mmOverlay && mmOverlay.contains(el))) return;
      if (el === hoverBox || el === selectBox) return;
      if (seen.indexOf(el) !== -1) return;
      if (!mmVisible(el)) return;
      seen.push(el); list.push(el);
    }
    var nodes = document.querySelectorAll(MM_SEL);
    for (var i = 0; i < nodes.length; i++) mmAdd(nodes[i]);
    // Styled clickable <div>/components: React uses synthetic events so there is
    // no onclick attribute — detect via cursor:pointer, keeping the outermost of
    // each pointer subtree (cursor inherits) so icon+label collapse to one mark.
    var all = document.body ? document.body.querySelectorAll("*") : [];
    for (var k = 0; k < all.length; k++){
      var e = all[k];
      if (getComputedStyle(e).cursor !== "pointer") continue;
      var pe = e.parentElement;
      if (pe && getComputedStyle(pe).cursor === "pointer") continue;
      mmAdd(e);
    }
    // Drop anything nested inside a clickable ancestor (the ancestor is the target).
    var clk = [];
    for (var a = 0; a < list.length; a++) clk.push(mmClickable(list[a]));
    var filtered = [];
    for (var b = 0; b < list.length; b++){
      var drop = false;
      for (var c = 0; c < list.length; c++){ if (c !== b && clk[c] && list[c].contains(list[b])){ drop = true; break; } }
      if (!drop) filtered.push(list[b]);
    }
    list = filtered;
    list.sort(function(a,b){
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      var x = Math.round(ra.top/24), y = Math.round(rb.top/24);
      if (x !== y) return x - y;
      return ra.left - rb.left;
    });
    mmReg = {};
    var marks = [];
    for (var j = 0; j < list.length; j++){
      var num = mmOffset + j + 1; mmReg[num] = list[j];
      var rr = list[j].getBoundingClientRect();
      marks.push({ num: num, tag: list[j].tagName.toLowerCase(), name: mmName(list[j]), typeable: mmTypeable(list[j]), bbox: { x: rr.left, y: rr.top, width: rr.width, height: rr.height } });
    }
    return marks;
  }
  function mmEnsureOverlay(){
    if (mmOverlay) return;
    mmOverlay = document.createElement("div");
    mmOverlay.style.cssText = "position:fixed;inset:0;z-index:2147483640;pointer-events:none;";
    document.body.appendChild(mmOverlay);
  }
  function mmRender(){
    if (!mmOverlay) return;
    mmOverlay.innerHTML = "";
    for (var n in mmReg){
      var el = mmReg[n]; if (!el) continue;
      var r = el.getBoundingClientRect();
      var foc = el === mmFocused;
      var chip = document.createElement("div");
      chip.textContent = n;
      chip.style.cssText = "position:absolute;left:" + Math.max(0,r.left) + "px;top:" + Math.max(0,r.top) + "px;transform:translate(-2px,-10px);font:700 11px/1.4 ui-monospace,monospace;padding:1px 5px;border-radius:5px;white-space:nowrap;color:#1a1100;background:" + (foc ? "#34d399" : "#facc15") + ";box-shadow:0 1px 3px rgba(0,0,0,.45);border:1px solid rgba(0,0,0,.25);";
      mmOverlay.appendChild(chip);
      if (foc){
        var ring = document.createElement("div");
        ring.style.cssText = "position:absolute;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;border:2px solid #34d399;border-radius:6px;box-sizing:border-box;";
        mmOverlay.appendChild(ring);
      }
    }
  }
  function mmRefresh(){
    if (!mmActive) return;
    var marks = mmEnumerate(); mmRender(); sendUp("mapmode-marks", { marks: marks });
  }
  function mmReposition(){
    if (!mmActive || mmRaf) return;
    mmRaf = requestAnimationFrame(function(){ mmRaf = 0; mmRefresh(); });
  }
  function mmSetVal(el, value){
    var proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function mmTypeInto(el, text, append){
    if (!el) return false;
    if (el.isContentEditable){ el.textContent = append ? ((el.textContent || "") + (el.textContent ? " " : "") + text) : text; el.dispatchEvent(new Event("input", { bubbles: true })); return true; }
    if (!mmTypeable(el)) return false;
    mmSetVal(el, append && el.value ? (el.value + " " + text) : text);
    return true;
  }
  function mmKey(el, key){
    el = el || document.activeElement;
    if (!el) return;
    var kc = key === "Enter" ? 13 : (key === "Tab" ? 9 : 0);
    var o = { key: key, code: key, keyCode: kc, which: kc, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", o));
    el.dispatchEvent(new KeyboardEvent("keyup", o));
    if (key === "Enter" && el.form && el.tagName === "INPUT"){ try { el.form.requestSubmit(); } catch(e){} }
  }
  function mmAct(p){
    p = p || {};
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var kind = p.kind, num = p.num, label = "";
    var el = (num != null) ? mmReg[num] : mmFocused;
    if (kind === "focus"){
      if (!el){ label = "no #" + num; }
      else { mmFocused = el; try { el.focus(); } catch(e){} try { el.scrollIntoView({ block: "center" }); } catch(e){} mmRender(); label = "focus #" + num; }
    } else if (kind === "click"){
      if (!el){ label = "no #" + num; }
      else { mmFocused = el; try { el.focus(); } catch(e){} el.click(); mmRender(); label = "click #" + num; setTimeout(mmRefresh, 60); }
    } else if (kind === "type"){
      label = mmTypeInto(mmFocused, p.text || "", false) ? "type" : "no field";
    } else if (kind === "append"){
      label = mmTypeInto(mmFocused, p.text || "", true) ? "append" : "no field";
    } else if (kind === "clear"){
      if (mmFocused && mmTypeable(mmFocused)){ mmSetVal(mmFocused, ""); label = "clear"; } else label = "no field";
    } else if (kind === "enter"){
      mmKey(mmFocused, "Enter"); label = "enter"; setTimeout(mmRefresh, 60);
    } else if (kind === "tab" || kind === "shift tab"){
      mmKey(mmFocused, "Tab"); label = kind;
    } else if (kind === "scroll"){
      window.scrollBy({ top: (p.text === "up" ? -1 : 1) * Math.round(window.innerHeight * 0.8), behavior: "smooth" }); label = "scroll " + (p.text || "down");
    } else if (kind === "top"){
      window.scrollTo({ top: 0, behavior: "smooth" }); label = "top";
    } else if (kind === "bottom"){
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); label = "bottom";
    } else if (kind === "back"){
      try { history.back(); } catch(e){} label = "back";
    }
    var ms = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
    sendUp("mapmode-acted", { num: (num != null ? num : null), label: label, execMs: Math.round(ms) });
  }
  function mmEnable(){
    if (mmActive) return; mmActive = true;
    mmEnsureOverlay();
    window.addEventListener("scroll", mmReposition, true);
    window.addEventListener("resize", mmReposition);
    mmRefresh();
  }
  function mmDisable(){
    if (!mmActive) return; mmActive = false; mmFocused = null;
    window.removeEventListener("scroll", mmReposition, true);
    window.removeEventListener("resize", mmReposition);
    if (mmOverlay && mmOverlay.parentNode){ mmOverlay.parentNode.removeChild(mmOverlay); }
    mmOverlay = null;
    mmReg = {};
  }

  window.addEventListener("message", function(ev){
    var d = ev.data;
    if (!d || d.source !== MSG_SRC || d.v !== 1) return;
    if (d.type === "enable") enable();
    else if (d.type === "disable") disable();
    else if (d.type === "clear") { if (selectBox) selectBox.style.display = "none"; }
    else if (d.type === "mapmode-enable") { mmOffset = (d.payload && d.payload.offset) || 0; mmEnable(); }
    else if (d.type === "mapmode-disable") mmDisable();
    else if (d.type === "mapmode-refresh") { if (d.payload && typeof d.payload.offset === "number") mmOffset = d.payload.offset; mmRefresh(); }
    else if (d.type === "mapmode-act") mmAct(d.payload);
  });

  // Announce readiness on load — handles re-mounts after Sandpack rebuilds.
  function ready(){ sendUp("ready"); }
  if (document.readyState === "complete") ready();
  else window.addEventListener("load", ready);
})();
`;

// Clean HTML template — Tailwind is loaded via Sandpack's externalResources, NOT here
const SANDPACK_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>${SANDPACK_PICKER_SCRIPT}</script>
</body>
</html>`;

const DEFAULT_APP_CODE = `export default function App() {
  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111827', marginBottom: '0.5rem' }}>Preview Ready</h1>
        <p style={{ color: '#6b7280' }}>Describe your app in the chat to get started.</p>
      </div>
    </div>
  );
}`;

// Icons that DO NOT exist in lucide-react but AI models keep trying to use
const FORBIDDEN_ICONS = [
  "Facebook", "Instagram", "Twitter", "Linkedin", "Youtube", "Github",
  "Dribbble", "Figma", "Slack", "Discord", "TikTok", "Pinterest",
  "Snapchat", "WhatsApp", "Telegram", "Reddit", "Medium", "Twitch",
  "Spotify", "LinkedIn", "YouTube", "GitHub",
];

// Only these names are safe to auto-import from lucide-react when the AI
// references them in JSX but forgot the import. Any other PascalCase name
// is a local component and must NOT be added to a lucide-react import.
const SAFE_LUCIDE_ICONS = new Set([
  "Phone", "Mail", "MapPin", "Menu", "X",
  "ChevronRight", "ChevronDown", "ChevronUp",
  "ArrowRight", "ArrowUp", "ArrowLeft",
  "Star", "Heart", "Clock", "Calendar",
  "User", "Users", "Home", "Building", "Building2",
  "Wrench", "Hammer", "PaintBucket", "Ruler",
  "Shield", "ShieldCheck", "CheckCircle", "Check",
  "ExternalLink", "Globe", "Send", "Search",
  "Plus", "Minus", "Eye", "EyeOff",
  "Camera", "Image", "Award", "Target", "TrendingUp", "DollarSign",
  "Loader2", "Settings", "LogOut", "Trash2", "Edit", "Copy",
  "Download", "Upload", "Share2", "Filter", "SlidersHorizontal",
  "BarChart3", "PieChart", "Zap", "Sparkles", "Sun", "Moon",
  "AlertCircle", "Info", "HelpCircle", "MessageCircle", "MessageSquare",
  "Bookmark", "Tag", "Link", "Palette", "Layers", "Grid", "List",
  "MoreHorizontal", "MoreVertical", "Play", "Pause",
  "SquareIcon", "CircleIcon", "Triangle", "Hexagon",
  "Move", "Maximize2", "Minimize2",
]);

function sanitizeIcons(code: string): string {
  // Step 1: Clean up forbidden icon imports and replace with Globe
  code = code.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g,
    (_match: string, imports: string) => {
      const iconList = imports.split(",").map((s: string) => s.trim()).filter(Boolean);
      const cleaned = iconList.filter((icon: string) => !FORBIDDEN_ICONS.includes(icon));
      const hadForbidden = cleaned.length < iconList.length;
      if (hadForbidden && !cleaned.includes("Globe")) cleaned.push("Globe");
      if (cleaned.length === 0) return `import { Globe } from 'lucide-react'`;
      return `import { ${cleaned.join(", ")} } from 'lucide-react'`;
    }
  );

  // Step 2: Replace forbidden icon JSX usage with Globe
  for (const icon of FORBIDDEN_ICONS) {
    code = code.replace(new RegExp(`<${icon}(\\s[^>]*?)\\s*\\/>`, "g"), `<Globe$1 />`);
    code = code.replace(new RegExp(`<${icon}(\\s[^>]*)?>`, "g"), `<Globe$1>`);
    code = code.replace(new RegExp(`<\\/${icon}>`, "g"), `</Globe>`);
  }

  // Step 3: Replace react-icons and heroicons with lucide Globe
  code = code.replace(/import\s*\{[^}]+\}\s*from\s*['"]react-icons\/[^'"]+['"]\s*;?/g, `import { Globe } from 'lucide-react';`);
  code = code.replace(/import\s*\{[^}]+\}\s*from\s*['"]@heroicons\/[^'"]+['"]\s*;?/g, `import { Globe } from 'lucide-react';`);

  // Step 4: Auto-fix missing lucide-react icon imports
  const existingImportMatch = code.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/);
  const importedIcons = new Set<string>();
  if (existingImportMatch) {
    existingImportMatch[1].split(",").map(s => s.trim()).filter(Boolean).forEach(icon => importedIcons.add(icon));
  }

  // Collect locally declared names
  const localDeclarations = new Set<string>();
  const declRegex = /(?:const|let|var|function|class)\s+([A-Z][a-zA-Z0-9]*)/g;
  let declMatch;
  while ((declMatch = declRegex.exec(code)) !== null) {
    localDeclarations.add(declMatch[1]);
  }
  const exportDeclRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class)\s+([A-Z][a-zA-Z0-9]*)/g;
  while ((declMatch = exportDeclRegex.exec(code)) !== null) {
    localDeclarations.add(declMatch[1]);
  }

  // Collect all names imported from ANY module (named + default imports)
  const allImportedNames = new Set<string>();
  // Named imports: import { Foo, Bar } from '...'
  const namedImportRegex = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g;
  let impMatch;
  while ((impMatch = namedImportRegex.exec(code)) !== null) {
    impMatch[1].split(",").map(s => s.trim()).filter(Boolean).forEach(name => {
      const parts = name.split(/\s+as\s+/);
      allImportedNames.add(parts[parts.length - 1].trim());
    });
  }
  // Default imports: import Foo from '...'  or  import Foo, { Bar } from '...'
  const defaultImportRegex = /import\s+([A-Z][a-zA-Z0-9]*)\s*(?:,|\s+from)/g;
  let defMatch;
  while ((defMatch = defaultImportRegex.exec(code)) !== null) {
    allImportedNames.add(defMatch[1]);
  }

  // Find PascalCase names used as JSX self-closing: <Name ... />
  // Only auto-import names that are KNOWN lucide-react icons — everything
  // else is a local component and must not be added to a lucide import.
  const jsxIconUsages = new Set<string>();
  const jsxRegex = /<([A-Z][a-zA-Z0-9]+)\s[^>]*?\/>/g;
  let jsxMatch;
  while ((jsxMatch = jsxRegex.exec(code)) !== null) {
    const name = jsxMatch[1];
    if (
      SAFE_LUCIDE_ICONS.has(name) &&
      !importedIcons.has(name) &&
      !localDeclarations.has(name) &&
      !allImportedNames.has(name) &&
      !FORBIDDEN_ICONS.includes(name)
    ) {
      jsxIconUsages.add(name);
    }
  }

  // Add missing icons to the lucide-react import
  if (jsxIconUsages.size > 0 && existingImportMatch) {
    const allIcons = [...importedIcons, ...jsxIconUsages];
    const newImport = `import { ${allIcons.join(", ")} } from 'lucide-react'`;
    code = code.replace(/import\s*\{[^}]+\}\s*from\s*['"]lucide-react['"]/, newImport);
  } else if (jsxIconUsages.size > 0 && !existingImportMatch) {
    const newImport = `import { ${[...jsxIconUsages].join(", ")} } from 'lucide-react';`;
    code = code.replace(/(import\s+.+\n)/, `$1${newImport}\n`);
  }

  return code;
}

/**
 * Prepare files for Sandpack's react-ts template.
 * Strips /src/ prefix since Sandpack uses flat paths (/App.tsx not /src/App.tsx).
 */
function isValidSandpackPath(p: string): boolean {
  if (!p || typeof p !== "string") return false;
  // Must start with "/" and not contain traversal or null bytes
  if (!p.startsWith("/")) return false;
  if (p.includes("..")) return false;
  if (p.includes("\0")) return false;
  // Must not be the root path itself
  if (p === "/") return false;
  // Must contain at least one real character after the leading /
  return p.length > 1;
}

function prepareFilesForSandpack(files: Record<string, string>): Record<string, string> {
  const prepared: Record<string, string> = {};

  const SKIP_PATHS = new Set([
    "/public/index.html",
    "/package.json",
    "/src/index.tsx", "/src/main.tsx",
    "/src/index.ts", "/src/main.ts",
    "/src/styles.css", "/src/index.css",
    "/index.tsx", "/main.tsx", "/index.ts", "/main.ts",
  ]);

  for (const [path, content] of Object.entries(files)) {
    if (SKIP_PATHS.has(path)) continue;
    if (!isValidSandpackPath(path)) continue;

    let sandpackPath = path;
    if (path.startsWith("/src/")) {
      sandpackPath = "/" + path.slice(5);
    }

    // Re-validate after transformation
    if (!isValidSandpackPath(sandpackPath)) continue;

    if (sandpackPath.match(/\.(tsx?|jsx?|js)$/)) {
      prepared[sandpackPath] = sanitizeIcons(content);
    } else {
      prepared[sandpackPath] = content;
    }
  }

  if (!prepared["/App.tsx"] && !prepared["/App.jsx"] && !prepared["/App.js"]) {
    prepared["/App.tsx"] = DEFAULT_APP_CODE;
  }

  // Inline image assets (data-URI rasters captured at import + SVG text) into
  // the source that references them, and drop the raw raster files Sandpack's
  // static bundler can't treat as modules. Resolves specifiers through the same
  // relative + path-alias logic the code uses, so an imported repo's images
  // render in the preview exactly as they do in the repo.
  const aliases = collectAliases(files);
  const withAssets = inlineAssets(prepared, aliases);

  // Teach Sandpack's static bundler how to resolve the project's path aliases
  // (@/, ~/, or any custom alias declared in the repo's tsconfig/vite config).
  // sandpack-core reads compilerOptions.paths but ONLY when baseUrl is set, and
  // resolves targets at the flat root — which is exactly where the /src/ strip
  // above puts the files. Without this, imported repos fail with "module not
  // found" on every aliased import. Overrides any tsconfig the repo shipped.
  withAssets["/tsconfig.json"] = buildInjectedTsconfig(files);

  return withAssets;
}

export function PreviewPanel({ files, dependencies = {}, projectId, onInlineApplied, onOpenCode }: PreviewPanelProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [key, setKey] = useState(0);

  // ── Selection mode ──────────────────────────────────────────────
  const isModeActive = useSelectStore((s) => s.isModeActive);
  const setModeActive = useSelectStore((s) => s.setModeActive);
  const setSelection = useSelectStore((s) => s.setSelection);
  const clearSelection = useSelectStore((s) => s.clear);
  const exitSelectMode = useSelectStore((s) => s.exit);
  const sandpackWrapperRef = useRef<HTMLDivElement | null>(null);
  const enableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expectedOriginRef = useRef<string | null>(null);
  const [showNewTooltip, setShowNewTooltip] = useState(false);

  // First-time tooltip
  useEffect(() => {
    const seen = localStorage.getItem("lovable.selectMode.seen");
    if (!seen) setShowNewTooltip(true);
    const timer = setTimeout(() => {
      setShowNewTooltip(false);
      if (!seen) localStorage.setItem("lovable.selectMode.seen", "1");
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  const getIframe = useCallback((): HTMLIFrameElement | null => {
    return sandpackWrapperRef.current?.querySelector("iframe") ?? null;
  }, []);

  const sendToIframe = useCallback((type: string, payload: unknown = {}) => {
    const iframe = getIframe();
    if (!iframe?.contentWindow) return;
    try {
      const origin = expectedOriginRef.current || "*";
      iframe.contentWindow.postMessage(
        { source: "lovable-select", v: 1, type, payload },
        origin,
      );
    } catch {
      // cross-origin — ignore
    }
  }, [getIframe]);

  // Send enable/disable when mode toggles
  useEffect(() => {
    const iframe = getIframe();
    if (!iframe) return;

    try {
      expectedOriginRef.current = new URL(iframe.src).origin;
    } catch {
      expectedOriginRef.current = null;
    }

    if (isModeActive) {
      // Clear any stale enable timeout
      if (enableTimerRef.current) clearTimeout(enableTimerRef.current);

      enableTimerRef.current = setTimeout(() => {
        // If the iframe never acknowledged ready, show toast and exit
        if (isModeActive) {
          toast.error("Preview not ready — try again in a moment");
          exitSelectMode();
        }
      }, 1500);

      sendToIframe("enable");
    } else {
      if (enableTimerRef.current) clearTimeout(enableTimerRef.current);
      clearSelection();
      sendToIframe("disable");
    }

    return () => {
      if (enableTimerRef.current) clearTimeout(enableTimerRef.current);
    };
  }, [isModeActive]);

  // Listen for messages from the iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const d = event.data;
      if (!d || d.source !== "lovable-select" || d.v !== 1) return;

      // Validate origin when possible
      const iframe = getIframe();
      if (iframe && expectedOriginRef.current && event.origin !== expectedOriginRef.current) return;

      if (d.type === "selected") {
        if (enableTimerRef.current) clearTimeout(enableTimerRef.current);
        setSelection(makeSelection(d.payload));
      } else if (d.type === "cleared") {
        clearSelection();
      } else if (d.type === "mapmode-marks") {
        useMapModeStore.getState().setMarks(d.payload?.marks || []);
      } else if (d.type === "mapmode-acted") {
        useMapModeStore.getState().pushActed(d.payload || { num: null, label: "", execMs: 0 });
      } else if (d.type === "ready") {
        if (enableTimerRef.current) clearTimeout(enableTimerRef.current);
        // Re-send enable if a mode is active (handles Sandpack remount)
        if (useSelectStore.getState().isModeActive) {
          sendToIframe("enable");
        }
        if (useMapModeStore.getState().isMapMode) {
          sendToIframe("mapmode-enable", { offset: useMapModeStore.getState().previewOffset });
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [setSelection, clearSelection, sendToIframe, getIframe]);
  // ── End selection mode ──────────────────────────────────────────

  // ── Map mode ─────────────────────────────────────────────────────
  // MapModeController orchestrates enable/disable: it numbers the chrome first,
  // then enables the iframe with the right offset. This panel only exposes the
  // iframe bridge (so the controller can post commands) and relays the iframe's
  // marks/acted messages (see the message handler above + "ready" re-enable).
  useEffect(() => {
    useMapModeStore.getState().setSender(sendToIframe);
    try {
      const iframe = getIframe();
      if (iframe) expectedOriginRef.current = new URL(iframe.src).origin;
    } catch {
      expectedOriginRef.current = null;
    }
  }, [sendToIframe, getIframe]);
  // ── End map mode ─────────────────────────────────────────────────

  const handleRefresh = () => {
    setKey(prev => prev + 1);
  };

  const filesFingerprint = useMemo(() => {
    const appContent = files["/src/App.tsx"] || files["/App.tsx"] || "";
    return appContent.length.toString() + "_" + Object.keys(files).length.toString();
  }, [files]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setKey(prev => prev + 1);
    }, 800);
    return () => clearTimeout(timer);
  }, [filesFingerprint]);

  const sandpackFiles = Object.keys(files).length > 0
    ? prepareFilesForSandpack(files)
    : { "/App.tsx": DEFAULT_APP_CODE };

  const activeFiles: Record<string, string> = {
    "/public/index.html": SANDPACK_INDEX_HTML,
    // Always inject shadcn/ui components as base — AI files override if present
    ...SANDPACK_SHADCN_FILES,
    ...sandpackFiles,
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="h-12 border-b border-white/5 bg-zinc-950/50 flex items-center justify-between px-4 shrink-0 z-20 relative">
        <div className="flex bg-zinc-900 rounded-lg p-1 border border-white/5">
          <SelectModeToggle />
          <MapModeToggle />
          {showNewTooltip && (
            <div
              className="absolute top-full left-0 mt-2 z-50 bg-blue-600 text-white text-xs px-3 py-2 rounded-lg shadow-lg max-w-[260px] animate-in fade-in slide-in-from-top-1"
              onClick={() => { setShowNewTooltip(false); localStorage.setItem("lovable.selectMode.seen", "1"); }}
            >
              <button
                className="absolute top-1 right-1.5 text-blue-200 hover:text-white"
                onClick={() => { setShowNewTooltip(false); localStorage.setItem("lovable.selectMode.seen", "1"); }}
              >
                ×
              </button>
              New: click any element in the preview to edit it.
            </div>
          )}
          <div className="w-px bg-white/10 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDevice("desktop")}
            className={cn(
              "h-7 px-3 text-xs rounded-md",
              device === "desktop"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
            )}
          >
            <Laptop className="w-3.5 h-3.5 mr-1.5" />
            Desktop
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDevice("mobile")}
            className={cn(
              "h-7 px-3 text-xs rounded-md",
              device === "mobile"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
            )}
          >
            <Smartphone className="w-3.5 h-3.5 mr-1.5" />
            Mobile
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-400 hover:text-white"
            onClick={handleRefresh}
            title="Force refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white">
            <ExternalLink className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Force Sandpack internals to fill 100% height */}
      <style dangerouslySetInnerHTML={{ __html: `
        .sp-wrapper { height: 100% !important; }
        .sp-layout { height: 100% !important; border: none !important; }
        .sp-preview { height: 100% !important; }
        .sp-preview-container { height: 100% !important; }
        .sp-preview iframe { height: 100% !important; }
      ` }} />

      <div className={cn(
        "flex-1 bg-zinc-950 flex items-center justify-center overflow-hidden relative",
        device === "desktop" ? "p-0" : "p-4 sm:p-8 overflow-auto"
      )}>
        {device !== "desktop" && (
          <div
            className="absolute inset-0 z-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(#4f4f5c 1px, transparent 1px)",
              backgroundSize: "20px 20px"
            }}
          />
        )}

        <div
          ref={sandpackWrapperRef}
          className={cn(
            "relative z-10 transition-all duration-300 ease-in-out overflow-hidden",
            device === "desktop"
              ? "w-full h-full"
              : "w-[375px] h-[812px] bg-white rounded-xl shadow-2xl ring-1 ring-white/10"
          )}
        >
          <SandpackProvider
            key={key}
            template="react-ts"
            theme={atomDark}
            files={activeFiles}
            customSetup={{
              dependencies: {
                "lucide-react": "1.7.0",
                "react-router-dom": "^6.20.0",
                "date-fns": "latest",
                "framer-motion": "^10.16.0",
                "clsx": "^2.1.0",
                "tailwind-merge": "^2.2.1",
                ...dependencies
              }
            }}
            options={{
              externalResources: [
                "https://cdn.tailwindcss.com",
                "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"
              ],
              classes: {
                "sp-wrapper": "custom-wrapper h-full",
                "sp-layout": "custom-layout h-full border-none bg-transparent",
                "sp-preview": "custom-preview h-full bg-white",
              }
            }}
          >
            <SandpackLayout className="h-full border-none overflow-hidden">
              <SandpackPreview
                showOpenInCodeSandbox={false}
                showRefreshButton={false}
                className="h-full bg-white text-black border-none"
              />
            </SandpackLayout>
          </SandpackProvider>

          {projectId && onInlineApplied && (
            <InspectorPanel
              projectId={projectId}
              onApplied={onInlineApplied}
              onOpenCode={onOpenCode}
            />
          )}
        </div>
      </div>
    </div>
  );
}
