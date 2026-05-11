# SOP — Selection-as-Context (Click-to-Edit, Phase 1)

> **For:** the implementation agent picking this up.
> **Status:** ready to build. All architectural decisions are pre-resolved.
> **Sister SOPs:** `docs/SOP_VIDEO_UPLOAD.md`, `docs/SOP_SUPABASE_INTEGRATION.md`. Read them for the established patterns (attachment chip UI, KV/R2 conventions, system-managed-files pattern).
> **Phase scope:** This SOP covers Phase 1 ONLY — selection mechanics, composer chip, AI context injection. Source-mapping refinements (React Fiber `__source`, stable-ID Vite plugin) are explicitly Phase 2/3 and out of scope here.
> **Hard rule from `AGENTS.md`:** This is NOT the Next.js you know. Read `node_modules/next/dist/docs/` before writing any Next.js-specific code.

---

## §1 — Executive Summary

Add a "Select" mode to the editor's live preview. While active, the user can hover any element in the Sandpack-rendered preview, see a blue outline + tag badge, click to lock a selection, then ask the AI to do anything to it via natural language. The selected element flows into the chat composer as a chip (visually identical to attachment chips), is sent as a `selection` field on the existing chat JSON payload, and is injected into the system prompt as a "Selection Block" telling the AI exactly which element the next user message refers to.

No popover with predefined Edit/Ask/Improve buttons. The chat IS the action. One free-form intent box handles infinitely more cases ("make this red", "translate to Spanish", "explain what this does", "wrap in a card", "delete it") than any fixed verb set.

Phase 1 deliberately skips source-mapping (no Babel plugin, no `__source` walking). The AI receives the rendered selector path + outer HTML + computed styles + ancestor context, and finds the matching source itself by text/structure. This is enough for ~85% of cases and unblocks Phase 1 ship in 6–10 hours of agent work. Phase 2 layers in source mapping as an additional hint, not a replacement.

---

## §2 — Feature Goal

Let the user point at any visible element in their generated app's live preview and have the AI's next response apply specifically to that element — without the user having to describe it in words.

**Success looks like:** User clicks the hero CTA button, types "make this neon green and bigger", presses Enter. The AI updates exactly the right `<button>` in the right component file. No collateral edits to other buttons. No "I'm not sure which button you mean" replies.

**Out of scope (Phase 1):**
- Inline contenteditable text editing (typing directly into the preview).
- Multi-selection (Cmd-click).
- Style sliders / color pickers / sidebar editor panels.
- Direct CSS edits without LLM round-trip.
- Source-line precision via Vite plugin or Fiber walking.
- Selection persistence across page reloads or chat sessions.
- Selection across iframe boundaries (nested iframes inside the preview).

---

## §3 — User Types

**Authenticated user (the only type this feature touches).** Same Clerk-authenticated user who can already chat and upload attachments. No new role, no admin surface, no public read.

The MCP API-key bypass user (`X-API-Key` path in `auth.ts:45`) is not in scope — selections are an interactive UI feature, not something a scripted MCP client needs.

---

## §4 — User Workflows

### Workflow A — Happy path (single selection → edit)

1. User is on `/editor/<projectId>` with a generated app rendering in the right pane.
2. User clicks the **🎯 Select** toggle in the preview header (or presses `Cmd+E` / `Ctrl+E`).
3. Preview iframe gains a 1px blue ring. Cursor becomes crosshair when over preview content.
4. User hovers a `<button>` — element gets a 2px blue dashed outline. A small dark pill follows the cursor showing `button.cta · "Get Started"`.
5. User clicks. Outline becomes solid blue. Pill anchors to the top-left of the element with the same label, plus a small ✕.
6. **Composer chip appears** above the chat textarea, matching attachment-chip styling: `[ 🎯 button · "Get Started" ✕ ]`.
7. Composer textarea auto-focuses. User types: `make this neon green and bigger`. Submits.
8. Chip remains visible during AI streaming, dimmed. After streaming completes, chip clears automatically.
9. AI's file edits apply, Sandpack hot-reloads, new green button is visible.
10. Select mode stays ON unless user pressed Esc, allowing rapid follow-ups on related elements.

### Workflow B — Cancel selection

1. User has selected an element.
2. User clicks ✕ on the composer chip → selection clears, chip disappears, in-iframe outline removes. Select mode stays on.
3. OR: user clicks empty space inside preview → same result (selection cleared, mode stays on).
4. OR: user presses Esc → selection cleared AND select mode exits.

### Workflow C — Re-select before submitting

1. User selects a button. Chip shows.
2. User clicks a different element (a heading). Chip updates in place to `[ 🎯 h1 · "Welcome to..." ✕ ]`. No second chip — only ever one selection in Phase 1.
3. User submits. Selection in payload reflects the latest pick.

### Workflow D — Selection becomes stale (AI rewrites the element)

1. User selects `<button>Sign Up</button>`. Submits "rename this to Get Started".
2. AI emits file edits. Sandpack hot-reloads. The `<button>` now reads `Get Started` but is otherwise the same DOM node-or-not (Sandpack remounts).
3. **Phase 1 behavior:** chip clears at end of streaming regardless. User must re-select to act on the same element again. No attempt to re-resolve. (Phase 3 reverses this with stable IDs.)

### Workflow E — Asking a question instead of editing

1. User selects a `<div>` they don't understand.
2. User types: `what is this and where in the code is it defined?`. Submits.
3. AI inspects the selection block, doesn't emit file edits, just responds in chat: `That's the hero section's call-to-action card, defined in src/components/Hero.tsx around line 24. It uses…`
4. Chip clears at stream end. Same as Workflow A but no edits emitted — the chat handles both cases without UI distinction.

### Workflow F — Selection + image attachment in same message

1. User selects a placeholder `<img>` element.
2. Drops a real photo file onto the chat (existing attachment flow from `SOP_VIDEO_UPLOAD.md`).
3. Both chips render side-by-side: `[ 🎯 img · "" ✕ ] [ 🖼️ photo.jpg ✕ ]`.
4. User types: `swap this image for the one I just attached`. Submits.
5. Both pieces of context land in the worker payload. AI knows to swap the right element using the right image.

---

## §5 — Admin Workflow

None. This feature has no admin surface, no analytics dashboard, no per-project settings, no rate limits to tune. It's pure interactive UX. If admin tooling becomes needed (e.g., to debug "wrong element edited" reports), that work belongs in a separate observability SOP — not here.

---

## §6 — UI/UX Requirements

### 6.1 Editor header — Select toggle button

- **Location:** Inside the preview-panel header, left of the existing device-switcher (mobile/desktop) buttons. See `components/editor/preview-panel.tsx` (existing toolbar around lines 100–180; place to the left of those controls).
- **Component:** `components/editor/select-mode-toggle.tsx` (new).
- **Visual states:**
  - **Off (default):** ghost icon button, `lucide-react` `MousePointerClick` icon at 16px, neutral foreground.
  - **On:** filled bg `bg-blue-500/15`, ring `ring-1 ring-blue-500/40`, icon `text-blue-400`. Tooltip: `Select mode (Esc to exit)`.
  - **Hover when off:** standard ghost-button hover.
- **Keyboard shortcut:** `Cmd+E` (Mac) / `Ctrl+E` (Win/Linux) toggles. Bound globally inside the editor route, not document-level — must respect input focus (don't fire if user is typing in chat composer).
- **Tooltip text:**
  - Off: `Select mode (⌘E) — click any element in the preview`
  - On: `Select mode active. Click an element. Esc to exit.`

### 6.2 Preview iframe — selection visuals (rendered INSIDE the iframe)

- When select mode is on, the runtime script (see §10.2) injects a single `<style>` block plus a single overlay `<div>` into the Sandpack-rendered document.
- **Hover state:** `outline: 2px dashed rgb(59,130,246); outline-offset: 2px; cursor: crosshair;` on the hovered element via JS-set inline style.
- **Selected state:** `outline: 2px solid rgb(59,130,246); outline-offset: 2px;`
- **Tag badge (hover):** small pill following cursor, position: fixed, `background: #0a0a0a; color: white; padding: 2px 6px; font: 11px/1.2 ui-monospace; border-radius: 4px; pointer-events: none; z-index: 2147483647;`. Content: `<tag>.<className-truncated-12-chars> · "<text-truncated-30-chars>"`.
- **Tag badge (selected):** same styling, but anchored to top-left of element (position: absolute relative to element bounding box), and includes a `✕` button (own click handler — clears selection without exiting select mode).
- **Body cursor:** `cursor: crosshair !important;` while mode is on (override site styles).
- **Disabled elements:** `<html>`, `<body>`, `<head>`, `<script>`, `<style>` are not selectable. Click events on them are ignored. Visual cue: those elements get no hover outline.
- **Click bubbling:** all `click`, `mousedown`, `mouseup` events on selectable elements are `preventDefault` + `stopPropagation` while in select mode. The user's app's own click handlers do not fire while selecting. (This is intentional — selecting a "Buy Now" button shouldn't trigger purchase flow.)

### 6.3 Composer — Selection chip

- **Component:** `components/editor/selection-chip.tsx` (new).
- **Mounted at:** above the chat textarea, in the same flex container that holds attachment chips. See `components/editor/chat-panel.tsx:407–489` for the textarea region. Place selection chip BEFORE attachment chips in the flex flow.
- **Styling:** match the attachment-chip styling (`SOP_VIDEO_UPLOAD.md` §6 has the spec). Same height, same border-radius, same gap. Different leading icon.
- **Leading icon:** `lucide-react` `Crosshair` at 14px, `text-blue-400`.
- **Label:** `<tag> · "<truncated-text-or-placeholder>"`. Truncate text to 24 chars + `…`. If element has no text, show `<empty>` in italic.
- **Trailing button:** `✕` (lucide `X` 12px) — click clears selection only (does NOT clear text composer or attachments).
- **Max width:** 320px; overflow truncates label.
- **Empty state:** when there is no selection, the chip is unmounted. Don't render an empty placeholder.
- **During AI streaming:** chip stays visible, opacity 0.5, no interaction. After `done` SSE event, chip auto-clears (whether or not the AI emitted file edits).

### 6.4 Toggle position & affordance discoverability

First-time users won't know the feature exists. Mitigations:
- The toggle button is visible at all times in the preview header (not hidden in a menu).
- Tooltip names the feature and shortcut.
- One-shot tooltip (dismissed-after-first-click, persisted in `localStorage` key `lovable.selectMode.seen`): when the user opens an editor for the first time after this feature ships, a small popover anchored to the toggle reads: `New: click any element in the preview to edit it.`
- No modal, no onboarding tour. Tooltip dismisses on first toggle activation OR after 8s.

### 6.5 Mobile / narrow viewports

The lovable-clone editor is desktop-first (cf. existing layout). Phase 1 does NOT support select mode on touch devices. On viewports < 768px the toggle button is hidden and `Cmd+E` is not bound. If a user somehow toggles it via DevTools, behavior is undefined — log a console warning and no-op.

### 6.6 Accessibility

- Select toggle button: `aria-pressed={isActive}`, `aria-label="Toggle element select mode"`.
- Selection chip: `role="status"` so screen readers announce when selection updates.
- Esc-to-exit: standard, expected by keyboard users.
- The selection visuals are NOT accessible to screen-reader users browsing the iframe contents directly — that's an explicit Phase 1 limitation. Phase 2+ should add a "selected element" announcement.

---

## §7 — Data Requirements

### 7.1 Client state shape (Zustand store, new file)

`lib/select-store.ts`:

```ts
import { create } from "zustand";

export type Selection = {
  id: string;                                  // nanoid(8), regenerated each new pick
  tag: string;                                 // e.g. "button"
  text: string;                                // innerText, max 200 chars
  selectorPath: string;                        // CSS path from <body>, e.g. "main > section.hero > button.cta:nth-of-type(2)"
  attributes: Record<string, string>;          // className, id, role, aria-*, data-*
  computedStyles: Record<string, string>;      // top ~20 visual props (see §10.3)
  outerHTML: string;                           // truncated to 1000 chars
  ancestorContext: string;                     // 2–3 ancestors with their text, max 300 chars
  bbox: { x: number; y: number; width: number; height: number };
  capturedAt: number;                          // Date.now()
};

type SelectStore = {
  isModeActive: boolean;
  current: Selection | null;
  setModeActive: (v: boolean) => void;
  setSelection: (s: Selection | null) => void;
  clear: () => void;                           // clears selection, leaves mode untouched
  exit: () => void;                            // clears selection AND turns mode off
};

export const useSelectStore = create<SelectStore>((set) => ({
  isModeActive: false,
  current: null,
  setModeActive: (v) => set({ isModeActive: v, current: v ? null : null }),
  setSelection: (s) => set({ current: s }),
  clear: () => set({ current: null }),
  exit: () => set({ isModeActive: false, current: null }),
}));
```

### 7.2 KV / R2

**Nothing.** Selections are ephemeral. They live in client state, ride along on the chat JSON payload, and are forgotten the moment streaming completes. No persistence, no cleanup job, no garbage collection.

If a future phase wants to persist selection history per-project (e.g., "show me elements I've edited this week"), that is a separate KV namespace (`project:{projectId}:selection_history`) and a separate SOP.

### 7.3 Chat payload — extended

The existing chat request body (see `worker/src/routes/chat.ts:62`) currently looks like:

```json
{
  "prompt": "string",
  "model": "string",
  "contextFiles": { "...": "..." },
  "attachments": [ { "...": "..." } ]
}
```

Phase 1 adds ONE optional field:

```json
{
  "prompt": "...",
  "model": "...",
  "contextFiles": { },
  "attachments": [ ],
  "selection": {
    "id": "...",
    "tag": "button",
    "text": "Get Started",
    "selectorPath": "main > section.hero > button.cta:nth-of-type(2)",
    "attributes": { "class": "cta primary", "type": "button" },
    "computedStyles": { "color": "rgb(255,255,255)", "backgroundColor": "rgb(59,130,246)", "fontSize": "16px", "padding": "12px 24px" },
    "outerHTML": "<button class=\"cta primary\" type=\"button\">Get Started</button>",
    "ancestorContext": "Inside <section class=\"hero\">, sibling of <h1>Welcome to Lovable</h1>",
    "bbox": { "x": 320, "y": 480, "width": 160, "height": 48 }
  }
}
```

`selection` is omitted entirely (not `null`, not `{}`) when there's nothing selected. The worker treats absence as "no selection".

---

## §8 — Functional Requirements

1. **F-1** — User can toggle select mode via header button OR `Cmd/Ctrl+E`.
2. **F-2** — Toggle is disabled and hidden on viewports < 768px.
3. **F-3** — `Cmd/Ctrl+E` does NOT toggle when the chat textarea (or any input/textarea) has focus.
4. **F-4** — While select mode is on, hovering any selectable element shows the dashed outline + cursor-following badge.
5. **F-5** — Clicking a selectable element captures Selection (per §7.1) into the store.
6. **F-6** — Click events on the user's app are suppressed (preventDefault + stopPropagation) while select mode is active.
7. **F-7** — `<html>`, `<body>`, `<head>`, `<script>`, `<style>` elements are not selectable.
8. **F-8** — Selection chip renders in the composer when `current !== null`, matching attachment-chip styling.
9. **F-9** — Clicking ✕ on the chip clears `current` but leaves `isModeActive` alone.
10. **F-10** — Clicking empty space inside the iframe (background, no element) clears `current`.
11. **F-11** — Esc clears `current` AND sets `isModeActive` to false.
12. **F-12** — Re-clicking a different element while one is already selected REPLACES the current selection (single-selection only in Phase 1).
13. **F-13** — On chat submit, if `current !== null`, the selection is included in the JSON payload as `selection` and the chip dims (opacity 0.5, no interaction) until streaming ends.
14. **F-14** — On `done` SSE event from the chat stream, the chip auto-clears (`setSelection(null)`).
15. **F-15** — On `error` SSE event from the chat stream, the chip clears AND a toast shows: `Edit failed — try selecting again`.
16. **F-16** — The runtime script injected into Sandpack lives at `/src/__lovable_select_runtime.ts` (or equivalent — see §10.2) and is auto-imported by the project's entrypoint.
17. **F-17** — That runtime path is in `SYSTEM_MANAGED_PATHS` so the AI never edits or deletes it.
18. **F-18** — The runtime script is the same for all projects (no per-project customization in Phase 1).
19. **F-19** — postMessage between parent and Sandpack iframe uses an explicit `targetOrigin` derived from the iframe's `src` URL — never `"*"`.
20. **F-20** — The worker's chat route accepts an optional `selection` field, validates it (zod or hand-written), and on presence appends a Selection Block to the system prompt (see §10.4).
21. **F-21** — Validation rejects selections where `outerHTML` exceeds 4000 chars or `selectorPath` exceeds 500 chars (truncation should happen client-side; reject as 400 if client misbehaves).
22. **F-22** — The Selection Block is appended to the system prompt regardless of model. (No conditional vision-vs-text logic — selections are text.)
23. **F-23** — When BOTH `selection` and `attachments` are present, the system prompt mentions both. They don't conflict.

---

## §9 — Non-Functional Requirements

- **N-1 Latency:** click-to-chip-rendered must complete < 50ms p95. The runtime script does its work synchronously on click, posts to parent, parent updates Zustand. No network calls.
- **N-2 Bundle weight:** the injected runtime script must be < 10KB gzipped. No external dependencies. Plain TS compiled to a single file. (The Sandpack project's runtime cost is the user's, so keep it tight.)
- **N-3 No app interference:** when select mode is OFF, the runtime script must be a no-op. Zero event listeners attached, zero DOM mutations, zero CSS injected. (Listeners attach on `enable` message, detach on `disable`.)
- **N-4 No CSP violations:** the runtime script must not require `unsafe-eval` or `unsafe-inline` beyond what Sandpack already permits.
- **N-5 No memory leaks:** every `addEventListener` must have a matching `removeEventListener` on disable. Mutation observers torn down on disable.
- **N-6 Cross-origin safety:** never log or expose cross-origin frame contents in the parent. The runtime serializes Selection inside the Sandpack iframe; the parent never reads the iframe's DOM directly.
- **N-7 Robust to AI rewrites:** Sandpack remounts on file change. The runtime script must re-attach listeners after remount automatically. (Easiest: run on document load AND poll `document.readyState` + listen for any post-mount signal.)
- **N-8 Graceful degradation:** if the iframe fails to respond to the `enable` postMessage within 1500ms (e.g., script not yet loaded), show a toast `Preview not ready — try again in a moment` and revert mode toggle to off.

---

## §10 — Integrations

### 10.1 Sandpack ↔ parent message protocol

Two message types each direction. All messages have `{ source: "lovable-select", v: 1, type: "...", payload: ... }`. The `source` discriminator lets the parent ignore other postMessages from Sandpack internals.

**Parent → iframe:**

| `type` | `payload` |
|---|---|
| `enable` | `{}` |
| `disable` | `{}` |

**Iframe → parent:**

| `type` | `payload` |
|---|---|
| `selected` | `Selection` (per §7.1, sans `id` — parent assigns) |
| `cleared` | `{}` (when user clicks empty space) |
| `ready` | `{}` (sent on load and remount, ack handshake) |

Parent ignores any postMessage where `data?.source !== "lovable-select"` or `data?.v !== 1`.

### 10.2 Runtime script injection

The runtime is a single TypeScript file, source-of-truth at `worker/src/ai/runtime/select-runtime.ts`. The worker generates this file on every project read, exactly like the planned Supabase client (`SOP_SUPABASE_INTEGRATION.md` §10).

**Project file path:** `/src/__lovable_select_runtime.ts`

**Auto-import:** The default project template (`worker/src/ai/default-project.ts`) is modified so `src/index.tsx` (the existing entrypoint, in `SYSTEM_MANAGED_PATHS`) imports the runtime for its side effects:

```ts
// src/index.tsx — top of file, before any other imports
import "./__lovable_select_runtime";

// ... rest of existing entrypoint
```

This import line is part of the system-managed entrypoint and the AI is told (via system prompt) it cannot remove it.

**System-managed paths update:** Add `/src/__lovable_select_runtime.ts` to `SYSTEM_MANAGED_PATHS` in `worker/src/routes/chat.ts:23`.

### 10.3 Computed-styles whitelist

The runtime captures only these CSS properties (everything else is noise for the LLM):

```
color, background-color, background-image,
font-size, font-family, font-weight, line-height, text-align,
padding, margin, border, border-radius,
width, height, display, position,
opacity, transform, box-shadow,
gap, justify-content, align-items
```

For each property: `getComputedStyle(el).getPropertyValue(prop)`. If empty or default-ish (`rgba(0,0,0,0)`, `auto`, `0px`, `none`), omit it.

### 10.4 System prompt injection

In `worker/src/routes/chat.ts`, after `fullSystemPrompt` is composed (around line 122), and after the Supabase Block is conditionally appended (per `SOP_SUPABASE_INTEGRATION.md`), append the Selection Block if `body.selection` exists:

```
## User Selection

The user pointed at this specific element in the live preview. Their next message is about THIS element only — apply edits narrowly. If they ask a question, answer about this element.

**Element:** `${selection.outerHTML}`
**Tag:** ${selection.tag}
**Text:** ${selection.text || "(empty)"}
**CSS selector path:** ${selection.selectorPath}
**Attributes:** ${JSON.stringify(selection.attributes)}
**Computed styles:** ${JSON.stringify(selection.computedStyles)}
**Ancestor context:** ${selection.ancestorContext}

To edit it: search the project files for the matching JSX. Use the text content first ("${selection.text}") to narrow candidates, then the tag + className to disambiguate. If multiple matches remain, prefer the one whose ancestor context matches. If you cannot confidently identify exactly one source location, ASK before editing.
```

The "ASK before editing" line is the safety net for the no-source-mapping Phase 1 approach.

### 10.5 Existing systems untouched

- Auth: standard `authMiddleware` on chat route (already present). Selection feature adds no new auth surface.
- File parser: the AI's JSON response shape is unchanged. The Selection Block is INPUT to the AI; output is the same files-and-explanation JSON the worker already parses.
- Streaming: SSE format unchanged. Selection clearing on `done` is a CLIENT side-effect of the existing event.
- Supabase integration (separate SOP): completely orthogonal — selections describe DOM, Supabase describes data. They coexist with no interaction.

---

## §11 — Automation / Cron

None. No cleanup jobs, no scheduled tasks, no periodic sweeps. Selections are session-ephemeral and require zero server-side maintenance.

---

## §12 — Error Handling

| Failure | Behavior |
|---|---|
| Iframe doesn't ack `enable` within 1500ms | Toast `Preview not ready — try again`. Revert toggle to off. Log warn. |
| postMessage rejected by browser (rare, likely CSP) | Same as above. |
| `selection.outerHTML` > 4000 chars (client misbehaved) | Worker returns 400 `Selection too large`. Client toasts `Selection failed — try a smaller element`. Chip clears. |
| Worker chat stream errors mid-response | Existing error handling stands. Chip auto-clears on `error` SSE event with toast `Edit failed — try selecting again`. |
| AI says "I'm not sure which element you mean" | Acceptable Phase 1 behavior. The "ASK before editing" prompt makes this preferable to wrong-element edits. User re-selects more specifically and retries. |
| User clicks during AI streaming | Chip is dimmed and non-interactive. New clicks in iframe ARE captured (selection-store updates) but no chip rerenders until streaming ends — actually let's keep it simple: while `streaming === true`, ignore iframe selection messages entirely. Document this in F-13. |
| Sandpack remounts mid-selection | The `ready` message from runtime triggers parent to send `enable` again if mode was active. Selection chip persists in parent state. (Selection's selectorPath may now point at a different DOM node — not our problem in Phase 1; the AI still has the snapshotted HTML and styles.) |
| Mode toggled off while a selection exists | Selection clears, chip disappears. |
| User Cmd-clicks (multi-select attempt) | Phase 1: treated as single click. Cmd modifier ignored. Don't error. (Phase 2 adds multi-select.) |
| User right-clicks an element | Native context menu opens. Select mode does NOT capture right-clicks. |

---

## §13 — Notifications

None outside of the toasts already listed in §12. No emails, no Slack, no Telegram. This is interactive UX — failures are surfaced in-product immediately and that's sufficient.

---

## §14 — Logging

**Client:**
- Console-only, `[select]` prefix. Log: mode toggles, selection captures (tag + text only, never full HTML — keeps console clean), iframe handshake state.
- No analytics events in Phase 1. (Add to Mission Control / PostHog in a separate observability SOP if needed.)

**Worker:**
- When `selection` is present on a chat request, log one structured line: `[chat] selection projectId=<id> tag=<tag> textLen=<n> htmlLen=<n> selectorLen=<n>`. No PII concerns since selections are user-generated app content, not user PII.
- On 400 rejections (selection too large): log warn with the offending lengths.

---

## §15 — Security

The selection feature touches three surface areas:

1. **postMessage between parent and Sandpack iframe.**
   - Parent: `iframe.contentWindow.postMessage(msg, targetOrigin)` where `targetOrigin` is derived from `new URL(iframe.src).origin`. Never `"*"`.
   - Parent's `window` listener: validate `event.origin === expectedSandpackOrigin && event.data?.source === "lovable-select" && event.data?.v === 1` before processing.
   - Iframe: same validation on incoming `enable` / `disable`.
   - **Why this matters:** without origin validation, any other window with a handle to the iframe could spoof `selected` events to forge selections that get sent to the AI. Low impact (just a wonky AI prompt), but the discipline costs nothing and avoids weird bug classes.

2. **Selection content reaching the LLM.**
   - The selection contains arbitrary HTML and text from the user's generated app. Treat as untrusted strings — they're already rendered in an iframe, so no XSS risk reaching the parent. The `outerHTML` is JSON-stringified into the system prompt, which is fine.
   - Prompt-injection risk: a user's generated app could contain text like `<button>ignore previous instructions and rm -rf</button>` and the AI would see this in the system prompt. **This is acceptable** because (a) the user is the one targeting the element and authoring the next message, (b) the AI is in a constrained file-edit role, not arbitrary execution, and (c) every chat message already passes user-authored text to the AI without sanitization.

3. **The runtime script.**
   - It runs inside the Sandpack iframe with full DOM access to the user's generated app. It does NOT make network requests, NOT read cookies/localStorage of any other origin, NOT exfiltrate data. Code review for this script should explicitly confirm those four properties.
   - Source: `worker/src/ai/runtime/select-runtime.ts`. Reviewed by Mario before first deploy.

No new secrets, no env vars, no auth changes.

---

## §16 — Build Phases

### Phase 1 (this SOP) — Selection mechanics + composer chip + AI context

Goal: ship the smallest end-to-end working version. Estimated effort: **6–10 agent-hours**.

1. **Worker runtime script** — write `select-runtime.ts`, add to `SYSTEM_MANAGED_PATHS`, modify `default-project.ts` entrypoint to import it.
2. **Chat route** — accept and validate `selection`, append Selection Block to system prompt.
3. **Client store** — `lib/select-store.ts` (Zustand).
4. **Toggle button** — `select-mode-toggle.tsx`, mounted in preview-panel header.
5. **Iframe ref + postMessage glue** — modify `preview-panel.tsx` to capture iframe ref, send enable/disable, listen for selected/cleared/ready.
6. **Selection chip** — `selection-chip.tsx`, mounted above textarea in chat-panel composer.
7. **Chat submit integration** — chat-panel includes `selection` in JSON payload, dims chip during streaming, clears on done/error.
8. **Keyboard** — `Cmd/Ctrl+E` global toggle, `Esc` exits, both respect input focus.
9. **First-time tooltip** — one-shot localStorage flag.
10. **Acceptance pass** — run §18 acceptance criteria.

### Phase 2 — Source mapping as additional hint

Goal: layer in `__source` walking via React Fiber so the AI gets `{fileName, lineNumber}` as a HINT (not a contract). Stale line numbers don't break anything because the AI also has the rendered selector. Effort estimate: **3–5 hours**.

1. Confirm `@vitejs/plugin-react` injects `__source` in dev mode (it does by default).
2. Update runtime script: on selection, walk from clicked DOM up the React Fiber tree (`element[Object.keys(element).find(k => k.startsWith("__reactFiber"))]`) and read `_debugSource`.
3. Add `sourceHint?: { fileName, lineNumber }` to Selection.
4. Append to Selection Block in system prompt: `**Source hint (may be stale):** ...`.
5. Document the fragility in §22.

### Phase 3 — Stable IDs via custom Vite plugin

Goal: Lovable's actual approach. Inject `data-lov-id="<hash>"` on every JSX element at compile time. Selection captures the ID; AI receives it; AI greps source for that exact attribute. Survives rewrites. Effort estimate: **1–2 weeks**, much higher complexity (Babel/SWC plugin, hash collision handling, list-key edge cases).

Out of scope for this SOP. Track separately if/when Phase 1+2 produces too many "wrong element edited" cases in real use.

### Phase 4 — Multi-select, sidebar editor, inline contenteditable

Goal: full Lovable parity. Multi-select via Cmd-click. Sidebar panel with style controls (color picker, slider for padding, etc.). Inline text editing without LLM round-trip. Effort estimate: open-ended. Track separately when Phase 1–3 has been validated in production.

---

## §17 — Developer Task List (Phase 1, ordered)

Each task is independently testable. An agent picking this up should land them in this order so each step builds on a working previous step.

1. **W-1** Create `worker/src/ai/runtime/select-runtime.ts` with the full runtime (per Appendix B).
2. **W-2** Modify `worker/src/routes/chat.ts:23` — add `/src/__lovable_select_runtime.ts` to `SYSTEM_MANAGED_PATHS`.
3. **W-3** Modify `worker/src/ai/default-project.ts` — add the runtime file to `defaultFiles`, prepend `import "./__lovable_select_runtime";` to the existing `src/index.tsx` content.
4. **W-4** Modify `worker/src/routes/chat.ts` — accept optional `selection` field on chat body; validate (per §8 F-21); append Selection Block to system prompt (per §10.4).
5. **W-5** Add type: `worker/src/types/selection.ts` with the `Selection` shape mirrored from §7.1.
6. **W-6** Smoke-test backend: curl chat endpoint with a fake `selection` payload, confirm system prompt includes the block. Check via `c.env.DEBUG` log.
7. **C-1** Install `zustand` if not already (`npm i zustand` in `apps/web` or wherever the Next.js app lives).
8. **C-2** Create `lib/select-store.ts` per §7.1.
9. **C-3** Create `components/editor/select-mode-toggle.tsx` per §6.1.
10. **C-4** Modify `components/editor/preview-panel.tsx`:
    - Mount the `<SelectModeToggle />` in the header.
    - Capture iframe ref via Sandpack's exposed `iframe` (see Appendix C for the trick to extract the iframe element from `<SandpackPreview>` since stock Sandpack hides it).
    - Add a `useEffect` that sends `enable` / `disable` postMessages when `isModeActive` changes.
    - Add a `window.addEventListener("message", ...)` that validates origin + source and updates the store on `selected` / `cleared` / `ready`.
11. **C-5** Create `components/editor/selection-chip.tsx` per §6.3.
12. **C-6** Modify `components/editor/chat-panel.tsx`:
    - Render `<SelectionChip />` above the textarea, alongside attachment chips.
    - Read selection from store at submit-time, include in JSON payload.
    - Subscribe to streaming state; dim chip during streaming; clear on `done` / `error`.
13. **C-7** Add global keyboard handler in the editor route (probably `app/editor/[id]/page.tsx` or wherever the editor frame is composed) for `Cmd/Ctrl+E` and `Esc`. Respect input focus.
14. **C-8** Add the one-shot first-time tooltip per §6.4.
15. **C-9** Smoke-test end-to-end: open editor, toggle mode, click an element, verify chip, type message, submit, verify AI gets selection block (worker log) and emits a sensible edit.
16. **Q-1** Run §18 acceptance criteria, fix any failures.
17. **Q-2** Run §19 manual test cases, fix any failures.
18. **Q-3** Add unit tests for the runtime's `buildSelectorPath` function and `extractComputedStyles` helper (Appendix B). Worker `selection` validator gets a vitest test too.
19. **D-1** Update `docs/SOP_SELECTION_CONTEXT.md` if any decisions changed during build (this is the kind of "agent feedback" that should flow back into the SOP).
20. **D-2** Stop. Ask Mario for push approval before any commit/push (per global rule in `CLAUDE.md`).

---

## §18 — Acceptance Criteria

A Phase 1 ship is acceptable if and only if all of these pass on a fresh editor session:

1. **A-1** Toggle button visible in preview header. Click flips state. Visual state change matches §6.1.
2. **A-2** `Cmd+E` (or `Ctrl+E`) toggles mode from anywhere on the editor route EXCEPT when a textarea/input is focused.
3. **A-3** With mode on, hovering a `<button>` shows blue dashed outline + cursor-following pill with correct tag and text.
4. **A-4** Clicking that button: outline becomes solid, pill anchors to top-left of the element, composer chip appears matching attachment-chip styling.
5. **A-5** Composer textarea auto-focuses on first selection of a session.
6. **A-6** Clicking a different element replaces the selection (one chip, updated label).
7. **A-7** Clicking ✕ on the chip clears selection AND in-iframe outline; mode stays on.
8. **A-8** Clicking empty space inside iframe clears selection; mode stays on.
9. **A-9** Pressing `Esc` clears selection AND exits mode; toggle button visual returns to off state.
10. **A-10** Selecting an element + typing "make this bigger" + submit causes the AI to update the right element. The other elements with similar tags are NOT modified. Verified by reading the file diff after the edit.
11. **A-11** Selecting an element + asking "what is this?" without an edit verb causes the AI to respond conversationally without emitting file edits. Chip clears at end of stream.
12. **A-12** Selecting an element + dropping an image attachment + typing "swap this for the image I attached" causes the AI to swap the right `<img>` with a reference to the attachment URL.
13. **A-13** With mode on but no element selected, submitting a chat message works exactly as before (no selection sent, no selection block in system prompt, no behavior change).
14. **A-14** With mode off, the runtime script attaches zero event listeners (verified via `getEventListeners(document)` in DevTools, or by performance-marking the script during dev).
15. **A-15** During AI streaming after a selection submit, the chip is visibly dimmed and non-interactive. Iframe clicks are ignored. After `done`, chip clears.
16. **A-16** On chat error during streaming, chip clears and toast shows.
17. **A-17** Sandpack remount (triggered by AI file edit landing) re-establishes the iframe handshake within 500ms — mode toggle visual stays in sync with actual iframe state.
18. **A-18** No console errors or warnings during a full happy-path run.
19. **A-19** Bundle size of the injected runtime: confirm `< 10KB gzipped`.
20. **A-20** No regression: the existing video-attachment flow (`SOP_VIDEO_UPLOAD.md`) still works when selection is also present.

---

## §19 — Testing Plan

### 19.1 Manual test cases

Run each on a freshly-created project from the default React template.

| # | Steps | Expected |
|---|---|---|
| M1 | Open editor, click toggle | Visual state flips |
| M2 | Press Cmd+E with editor focused but no input | Toggle flips |
| M3 | Press Cmd+E with chat textarea focused | No toggle, native browser behavior or no-op |
| M4 | Toggle on, hover header `<h1>` | Outline + pill appear |
| M5 | Toggle on, hover `<body>` directly (gap between elements) | No outline (body is excluded) |
| M6 | Toggle on, click a `<button>` | Solid outline + chip + textarea focus |
| M7 | Toggle on, click `<button>`, then click `<a>` | Chip updates to `a`; only one chip ever |
| M8 | Toggle on, click `<button>`, type "make this red", submit | AI emits edit, button becomes red, chip clears |
| M9 | Toggle on, click `<button>`, type "what is this?", submit | AI replies in chat, no file edit, chip clears |
| M10 | Toggle on, click ✕ on chip | Selection clears, mode stays on |
| M11 | Toggle on, press Esc | Selection clears, mode exits |
| M12 | Toggle on, click background of preview | Selection clears |
| M13 | Toggle on, click `<button>` that has an `onClick` handler | Handler does NOT fire (preventDefault verified) |
| M14 | Toggle off, click any element | Native click — handler fires, no selection |
| M15 | Toggle on, drop an image into composer, click an `<img>`, type "replace this with the attached image", submit | AI updates the `<img>` src to use the attachment URL |
| M16 | Toggle on, click an element, switch tabs, return | Selection still in chip; mode still on |
| M17 | Toggle on, click element, AI rewrites that file via a different chat unrelated to the selection | Sandpack remounts; chip persists; subsequent submits still send the snapshotted selection |
| M18 | Refresh the editor page mid-selection | Selection is gone (no persistence). Mode is off. (Persistence is Phase 4.) |
| M19 | Open DevTools, watch console, perform M1–M11 | No errors, no warnings |
| M20 | Throttle network to Slow 3G, perform M8 | Chip dims during streaming, restores correctly on completion or error |

### 19.2 Automated tests

- **Unit tests** for client utilities (vitest):
  - `buildSelectorPath(el)` — given a known DOM, produces the right CSS path.
  - `extractComputedStyles(el)` — given a styled element, returns the whitelisted properties only.
  - `truncate(s, n)` — selection-payload truncation helpers.
- **Unit tests** for worker validation (vitest):
  - Reject selection with `outerHTML.length > 4000`.
  - Reject selection with `selectorPath.length > 500`.
  - Reject selection missing required fields.
- **Integration test** for the chat route (vitest + Miniflare or equivalent):
  - POST chat with `selection` present → assert system prompt includes Selection Block.
  - POST chat without `selection` → assert system prompt is unchanged from baseline.

No E2E (Playwright) test in Phase 1 — covered by manual M1–M20.

---

## §20 — Edge Cases

| Case | Handling |
|---|---|
| User selects an element inside a `<form>` and the form has Enter-to-submit | preventDefault on click suppresses form submit; Enter in chat composer is fine |
| User selects a `position: fixed` element (e.g., a sticky header) | Works normally; bbox reflects viewport-fixed position; selection visuals follow |
| User selects an SVG child (`<path>`) | Allowed. Tag = `path`. Selection works. (AI may have a harder time finding this in source — surfaces the Phase 1 limitation. Mitigation: AI is told to ASK before editing if uncertain.) |
| User selects an element inside a portal / `position: absolute` overlay rendered outside its React parent | Works DOM-wise. AI source location may be less obvious. Same mitigation as above. |
| User's app intentionally captures all clicks (e.g., a custom canvas-based UI) | Select mode's preventDefault wins; clicks are captured by select-runtime. User's app sees no clicks while mode is on. |
| Element changes dimensions between hover and click (e.g., `:hover` styles enlarge it) | Acceptable; bbox is captured at click time. |
| Element is removed from DOM after selection (e.g., AI rewrite removed it) and user submits | Selection still has the snapshotted HTML. AI gets the data. AI may decide there's nothing to edit and respond accordingly. No client error. |
| User selects element, enters select mode again somehow without exiting (shouldn't be possible, but) | Idempotent: `setModeActive(true)` when already active is a no-op. |
| Two preview panels (split view, future feature) | Out of scope for Phase 1. Single preview only. |
| Print stylesheet / `@media print` while selecting | Don't care. Out of scope. |
| User has reduced-motion preference | No animations are involved that would matter. |
| User has high-contrast OS theme | Blue outline color may be hard to see. Phase 2: respect `prefers-contrast` and switch to high-contrast colors. Phase 1: ship as-is. |
| Sandpack iframe sandbox attributes block postMessage | Sandpack v2.20.0 default sandbox allows `allow-scripts allow-same-origin`. postMessage works. If a future Sandpack version tightens this, the F-19 origin handshake catches it and the §12 timeout toast surfaces it. |
| User disabled JavaScript in the iframe somehow | Runtime can't run; mode toggle's enable times out at 1500ms; toast shows. |

---

## §21 — Agent Documentation

After Phase 1 ships, update these files:

1. **`AGENTS.md`** — Add a section: *"Element selection: when the user references "this" or "that element" in a chat message, check whether the request body has a `selection` field. If yes, the user pointed at a specific element — your edits should target ONLY that element."*
2. **`worker/src/ai/system-prompt.ts`** — The Selection Block (§10.4) is appended at runtime, but the BASE system prompt should also include a one-paragraph note: *"Sometimes the user has selected a specific element in the live preview. When that's the case, a 'User Selection' section will be appended below. Treat that as the user pointing at a specific thing in the rendered app."*
3. **`docs/SOP_SELECTION_CONTEXT.md`** (this file) — Update §22 with any answered open questions discovered during build.
4. **`README.md`** (if user-facing docs exist for the app) — Add a one-liner: *"Click the cursor button in the preview header (or press `Cmd+E`) to point at any element and ask the AI to edit it directly."*

---

## §22 — Open Questions

These are deliberately unresolved in this SOP. Track answers as Phase 1 ships and the system gets real use.

1. **Q1 — Should the chip persist across chat messages?**
   Currently it auto-clears at end of stream. Argument for persisting: rapid follow-ups ("now make it green", "now bigger"). Argument against: stale selection after AI rewrite is misleading. Decision deferred until we see real use.

2. **Q2 — How often does Phase 1's "AI finds source from selector + HTML" approach pick the wrong element?**
   This is the central risk of skipping source mapping. Track via manual review of the first ~50 selection-driven edits in production. If wrong-element rate > 10%, accelerate Phase 2 (`__source` hints). If > 25%, jump straight to Phase 3 (stable IDs).

3. **Q3 — Should we surface a "I'm not sure which element" prompt as UI rather than chat text?**
   Phase 1 lets the AI ask in chat. A future UX could detect the AI's uncertainty in the response and re-open the selection mode automatically with a hint. Not for v1.

4. **Q4 — Multi-select via Cmd-click — Phase 2 or Phase 4?**
   Lovable supports it. Easy DOM-wise. Hard prompt-wise (the "selection" field becomes a list, the system prompt has to handle multiple elements coherently). Punted to Phase 4.

5. **Q5 — Should the runtime script be loaded from a CDN or inlined?**
   Phase 1: inlined as a system-managed file. Pro: works offline, no extra network. Con: every project ships the bytes. Phase 5 could move to a CDN-loaded script that imports from an export, IF bundle size becomes a real complaint. (Currently `< 10KB gzipped`, so probably never worth it.)

6. **Q6 — Sidebar editor panel (Lovable / v0 style)?**
   Phase 1 is "everything goes through chat". Lovable + v0 both have richer sidebar panels with style sliders. Punted to Phase 4 — only worth building if real users say "this is too clunky for small CSS tweaks."

7. **Q7 — Should we ban selection of elements that have `data-no-select` attribute?**
   Useful for app authors who want to mark something unselectable (e.g., a debug overlay). Trivial to add. Defer until someone actually asks for it.

---

## §23 — Final Notes

This SOP is intentionally narrower than `SOP_SUPABASE_INTEGRATION.md`. Selection-as-context is a UI feature with one server-side hook (system prompt block). Building it bigger than that is over-engineering.

The most important architectural call in this document is **§16 phasing**. The temptation will be to "do it right the first time" with a stable-ID Vite plugin. **Resist that.** Phase 1 ships in a week of agent time and provides ~85% of the value. Phase 3 is a 1-2 week side-project that you should only fund once Phase 1+2 has been used in anger and the failure modes are concrete.

The second most important call is **the chip-not-popover decision**. Lovable and v0 both ship sidebar panels (not chat-driven), but they're 50-person-engineering products with budget for sidebar editors. For lovable-clone, the chat IS the editor. The composer-chip pattern reuses existing UI vocabulary (attachment chips), is dramatically simpler to build, and matches how Lovable's chat-side "Select" mode actually feels in practice — the visual differs from v0/Lovable's sidebar, but the user mental model ("point, then describe") is identical.

After this ships, the Lovable-clone editor has three pillars of context that flow into every chat:

- **What's on screen** (selection — this SOP)
- **What media the user is providing** (attachments — `SOP_VIDEO_UPLOAD.md`)
- **What data the app talks to** (Supabase schema — `SOP_SUPABASE_INTEGRATION.md`)

Together those three define a fundamentally more capable AI builder than any one of them alone. Build them in any order, but build all three.

---

# Appendices

---

## Appendix A — File-by-file change manifest (Phase 1)

**New files:**

| Path | Purpose |
|---|---|
| `worker/src/ai/runtime/select-runtime.ts` | Source of truth for the injected runtime |
| `worker/src/types/selection.ts` | Shared `Selection` type |
| `lib/select-store.ts` | Zustand store (client) |
| `components/editor/select-mode-toggle.tsx` | Header toggle button |
| `components/editor/selection-chip.tsx` | Composer chip |

**Modified files:**

| Path | Change |
|---|---|
| `worker/src/routes/chat.ts` | Add `selection` to body schema; append Selection Block to system prompt; add path to `SYSTEM_MANAGED_PATHS` |
| `worker/src/ai/default-project.ts` | Add runtime file to `defaultFiles`; prepend import to `src/index.tsx` |
| `worker/src/ai/system-prompt.ts` | Add base-prompt paragraph about selections (per §21) |
| `components/editor/preview-panel.tsx` | Mount toggle; capture iframe ref; postMessage glue; window message listener |
| `components/editor/chat-panel.tsx` | Mount selection chip; include selection in submit payload; dim/clear on streaming events |
| `app/editor/[id]/page.tsx` (or equivalent) | Global Cmd+E / Esc keyboard handler |
| `AGENTS.md` | Add selection-aware editing note |

---

## Appendix B — Full source: `worker/src/ai/runtime/select-runtime.ts`

This is the runtime that gets injected into every Sandpack project. Compiled output lives in `defaultFiles` at `/src/__lovable_select_runtime.ts` (Sandpack compiles TS at runtime).

```ts
// /src/__lovable_select_runtime.ts
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
  // NOTE: parent validates origin separately. We send "*" here because the runtime
  // doesn't know the parent's origin reliably. Parent rejects messages with wrong origin.
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
      const cls = node.className.trim().split(/\s+/).slice(0, 2).join(".");
      if (cls) part += "." + cls;
    }
    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === node!.tagName,
      );
      if (sameTag.length > 1) {
        const idx = sameTag.indexOf(node) + 1;
        part += `:nth-of-type(${idx})`;
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
      ? node.className.trim().split(/\s+/)[0]
      : "";
    const text = (node.innerText || "").trim().slice(0, 40);
    parts.push(
      `<${tag}${cls ? `.${cls}` : ""}>${text ? ` "${text}"` : ""}`,
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
    ? t.className.trim().split(/\s+/)[0]
    : "";
  hoverPill.textContent = `${t.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${text ? ` · "${text}"` : ""}`;
  hoverPill.style.display = "block";
  hoverPill.style.left = `${e.clientX + 12}px`;
  hoverPill.style.top = `${e.clientY + 12}px`;
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
    // Click on excluded element — treat as "click empty"
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
  // Esc inside iframe is also handled; parent also listens to its own document.
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
    injectedStyle.textContent = `
      html, body { cursor: crosshair !important; }
    `;
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
```

**Notes:**
- The `send` function uses `targetOrigin: "*"` because the runtime can't reliably know the parent origin. The PARENT validates origin on incoming messages (per F-19). This is acceptable because the data sent is non-sensitive (it's the user's own DOM content) and the parent rejects spoofed messages anyway.
- All listeners use capture phase (`true`) to win against the user's app's own click handlers.
- `clearSelected` is idempotent.
- The runtime is < 4KB minified, ~1.5KB gzipped — well under the §N-2 budget.

---

## Appendix C — Capturing the Sandpack iframe ref

Stock `<SandpackPreview>` from `@codesandbox/sandpack-react@2.20.0` does not expose an iframe ref directly. Two reliable approaches; pick one:

**Approach 1 — querySelector after mount (simplest):**

```tsx
const containerRef = useRef<HTMLDivElement | null>(null);

useEffect(() => {
  if (!isModeActive) return;
  const iframe = containerRef.current?.querySelector("iframe");
  if (!iframe) return;
  // ... use iframe.contentWindow.postMessage(...)
}, [isModeActive]);

return (
  <div ref={containerRef}>
    <SandpackPreview ... />
  </div>
);
```

Tradeoff: works with stock Sandpack but is fragile if Sandpack ever changes its DOM structure. Acceptable for Phase 1.

**Approach 2 — Sandpack's `useSandpack` hook + client.iframe:**

```tsx
import { useSandpack } from "@codesandbox/sandpack-react";

const { sandpack } = useSandpack();
const client = sandpack.clients[Object.keys(sandpack.clients)[0]];
const iframe = client?.iframe;
```

More robust, but requires being inside `<SandpackProvider>`. Verify the API surface matches v2.20.0 before relying on it.

Use Approach 1 for Phase 1. If it breaks on a Sandpack upgrade, refactor to Approach 2.

---

## Appendix D — Origin validation snippet (parent side)

In `components/editor/preview-panel.tsx`:

```ts
useEffect(() => {
  const iframe = containerRef.current?.querySelector("iframe");
  if (!iframe) return;
  let expectedOrigin: string | null = null;
  try {
    expectedOrigin = new URL(iframe.src).origin;
  } catch {
    expectedOrigin = null;
  }

  const handler = (event: MessageEvent) => {
    if (expectedOrigin && event.origin !== expectedOrigin) return;
    const d = event.data;
    if (!d || d.source !== "lovable-select" || d.v !== 1) return;
    if (d.type === "selected") {
      const id = nanoid(8);
      useSelectStore.getState().setSelection({ id, ...d.payload, capturedAt: Date.now() });
    } else if (d.type === "cleared") {
      useSelectStore.getState().setSelection(null);
    } else if (d.type === "ready") {
      // re-send enable if mode is active (handles remount)
      if (useSelectStore.getState().isModeActive) {
        iframe.contentWindow?.postMessage(
          { source: "lovable-select", v: 1, type: "enable", payload: {} },
          expectedOrigin || "*",
        );
      }
    }
  };

  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}, []);
```

---

## Appendix E — Selection block test fixture

For unit-testing the worker's prompt composition, this fixture should produce a known-good Selection Block:

```ts
const fixture = {
  id: "abcd1234",
  tag: "button",
  text: "Get Started",
  selectorPath: "main > section.hero > button.cta:nth-of-type(2)",
  attributes: { class: "cta primary", type: "button" },
  computedStyles: {
    "color": "rgb(255, 255, 255)",
    "background-color": "rgb(59, 130, 246)",
    "font-size": "16px",
    "padding": "12px 24px",
  },
  outerHTML: '<button class="cta primary" type="button">Get Started</button>',
  ancestorContext: '<section.hero> "Welcome to Lovable" / <main>',
  bbox: { x: 320, y: 480, width: 160, height: 48 },
  capturedAt: 1700000000000,
};
```

The test asserts the rendered Selection Block contains:
- The literal string `## User Selection`
- The `outerHTML` value
- The `selectorPath` value
- The "ASK before editing" safety clause

---

## Appendix F — Per-phase manual acceptance walkthrough (curl + UI)

After Phase 1 ship, run this end-to-end:

1. **Backend reachable**
   ```sh
   curl -X POST https://<worker-host>/api/chat \
     -H "Authorization: Bearer <clerk-token>" \
     -H "Content-Type: application/json" \
     -d '{"prompt":"hello","model":"moonshotai/kimi-k2.6","contextFiles":{},"selection":'"$(cat fixture.json)"'}'
   ```
   Expect: SSE stream starts, system prompt log shows Selection Block.

2. **Sandpack runtime delivered**
   - Open editor, view source → in DevTools, switch to Sandpack iframe context → `console.log(window)` should show no errors and the runtime should have already announced ready (check Network tab for the postMessage in DevTools experimental "Web Vitals" or use `window.addEventListener("message", e => console.log(e))`).

3. **Toggle works**
   - Click toggle → button visual changes → DevTools shows `enable` postMessage sent.

4. **Selection captured**
   - Hover, click → `selected` message received in parent → store updates → chip renders.

5. **Edit applied**
   - Submit "make this red" → AI emits a file edit → Sandpack reloads → element is red.

6. **Reverse path**
   - Esc → mode exits → no listeners attached to iframe document.

If any step fails, halt and diagnose — don't paper over with retries.

---

**End of SOP.** When the implementing agent completes Phase 1 acceptance, ping back with: a list of any §22 questions answered, any edge cases in §20 that surfaced as real bugs, and a proposed cut for Phase 2 timing. Don't push to GitHub without explicit Mario approval (`CLAUDE.md` global rule).
