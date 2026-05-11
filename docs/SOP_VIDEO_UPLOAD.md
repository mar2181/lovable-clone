# FEATURE SOP + BUILD HANDOFF DOCUMENT
## Video Upload & Attachment for Lovable Clone

**Version:** 1.0
**Author:** Mario (Quarterback) → Claude (Implementing Agent)
**Repo:** `mar2181/lovable-clone`
**Local path:** `C:\Users\mario\Projects\lovable-clone\`
**Live dev URL:** `http://localhost:3015/editor/<projectId>`
**Status:** Ready for build
**Estimated build effort:** 1 working day (~6 focused hours)

---

## 1. Executive Summary

### What this feature is
A new "attach video" capability inside the chat panel of the Lovable Clone editor. Today the paperclip button only accepts images and the file is shoved through the chat as base64. We're replacing that pipeline with a real **upload-to-storage → return-URL → inject-URL-into-prompt** flow that works for **both images and videos** (and any future media).

### Why we are adding it
Right now Mario can't tell the editor "add this video to the hero section" because the file picker rejects mp4/webm/mov, and even if it accepted them, the chat backend was wired to push the bytes into a vision LLM that can't watch video. The user's actual goal isn't "let the AI see the video" — it's "let the AI embed the video on the generated site." That's a storage problem, not an LLM problem.

### Who will use it
- **Primary:** Mario (the operator), shipping landing pages for his 8 marketing-agency clients via Lovable Clone.
- **Secondary:** Any other authenticated Clerk user of the platform (the worker is already multi-tenant by `userId`).

### What problem it solves
1. **The paperclip is hard-locked to images** (`accept="image/*"`) — videos can't even be picked.
2. **The current attachment data path is base64-over-SSE** — fine for a 200KB JPEG, fatal for a 20MB mp4 (Cloudflare Workers cap request bodies at 100MB but the AI SDK and OpenRouter both reject huge multipart payloads, and SSE streaming would choke).
3. **The chat forces `VISION_MODEL` whenever an attachment exists** — that's wrong for video. Video should stay on whatever model the user selected; only the URL needs to reach the model.

### What business value it creates
- Unblocks "add video to client website" requests for Sugar Shack, Custom Designs TX, SPI Fun Rentals, Juan Elizondo etc. — all 8 clients.
- Replaces a fragile base64-in-JSON pattern with a clean signed-URL pattern that scales to any future media type (PDF, audio, anything).
- Saves money: large attachments stop getting forwarded to a vision LLM that can't use them.
- One step closer to feature parity with Lovable.dev.

### What the final result looks like
1. User clicks the paperclip in `chat-panel.tsx`.
2. File picker opens with images **and** videos enabled (mp4, webm, mov, m4v).
3. User picks an mp4 (up to 100MB).
4. UI shows a small upload progress bar, then a video thumbnail preview with an X to remove it.
5. User types: *"Add this as a hero video, autoplay muted loop."*
6. Hits send. Chat sends the prompt + the attachment URL to the worker.
7. Worker injects a structured attachment block into the system prompt: *"User has attached a video at `https://r2.../abc123.mp4` (mime: `video/mp4`, duration unknown). Embed it where requested."*
8. AI returns code with `<video src="https://r2.../abc123.mp4" autoPlay muted loop playsInline className="..." />`.
9. Live Sandpack preview plays the video.
10. The generated site, when exported via `/api/export` or pushed via `/api/github`, retains the absolute URL — no broken links.

---

## 2. Feature Goal

The goal of this feature is to allow authenticated users to attach **video files (mp4, webm, mov, m4v) and image files (jpg, png, webp, gif)** to a chat message so the AI agent can **embed the asset into the generated website** by referencing its public URL — without needing the LLM to "see" or analyze the file's contents.

### Success outcomes
- User can successfully select a video file from the paperclip menu.
- User can successfully upload a video up to **100MB** to Cloudflare R2.
- System returns a stable public URL within ~10s for a 50MB file on a normal connection.
- The AI receives the attachment URL as text and embeds it correctly in JSX (e.g. `<video src="..." />`).
- Existing image-attachment flow continues to work (vision-model auto-switch retained for images only).
- Data is saved correctly in R2 under `attachments/{userId}/{projectId}/{nanoid}.{ext}` and indexed in KV.
- Attachments persist across sessions — re-opening a project shows the prior uploads in a small "recent attachments" tray (Phase 4 nice-to-have).
- Errors (oversize, wrong type, network failure, R2 failure) show clear messages and never silently swallow.
- Feature works on desktop and mobile (file input is a standard HTML element).
- Feature does not break the existing chat, project, or export workflows.

---

## 3. User Types and Permissions

| User Type | Can View | Can Create | Can Edit | Can Delete | Special Permissions |
|---|---|---|---|---|---|
| Authenticated Clerk user (owner of project) | Their own attachments only | Yes | N/A (immutable blobs) | Yes (their own) | Standard |
| Authenticated Clerk user (NOT owner of project) | No | No | No | No | Blocked at worker — `projectExists` check already in place |
| MCP service user (`X-API-Key` bypass) | All attachments under a given userId via `X-User-Id` header | Yes | N/A | Yes | Used by automated MCP tools / scripts only |
| Anonymous / unauthenticated | No | No | No | No | Blocked at Clerk middleware |

**Recommendation:** Stick with the existing `userId`-scoped pattern from `routes/projects.ts`. No new role tier needed. The R2 keys MUST include the `userId` so a future bug can never leak one user's video to another's account.

---

## 4. Full User Workflow

### Workflow A: Attach a Video to a New Chat Message (Main Flow)

1. User is on `/editor/<projectId>` with the chat panel visible (right side or bottom — depends on layout state).
2. User clicks the **Paperclip** button in `components/editor/chat-panel.tsx` (currently line ~366).
3. Native OS file picker opens with filter `image/*,video/mp4,video/webm,video/quicktime,video/x-m4v`.
4. User selects a `hero.mp4` file (45MB).
5. Frontend immediately validates client-side:
   - Type: must match allowed list. If not → toast `"Unsupported file type. We accept JPG, PNG, WebP, GIF, MP4, WebM, MOV, M4V."` and abort.
   - Size: must be ≤ 100MB. If not → toast `"File too large (X MB). Max is 100MB."` and abort.
6. Frontend shows a small inline upload card with the filename and a progress bar (0%).
7. Frontend POSTs to `POST /api/attachments` (worker route, see §10):
   - Multipart `FormData` with field `file` and field `projectId`.
   - `Authorization: Bearer <clerk-jwt>`.
8. Worker `attachments.ts` route:
   - Verifies Clerk JWT via existing `authMiddleware`.
   - Confirms `projectId` belongs to `userId` (re-using the `kv.get("user:${userId}:project:${projectId}")` pattern).
   - Generates `attachmentId = nanoid(12)`, sniffs MIME, validates extension.
   - Streams the file body to R2 at `attachments/${userId}/${projectId}/${attachmentId}.${ext}` with proper `httpMetadata.contentType`.
   - Indexes the record in KV at `project:${projectId}:attachment:${attachmentId}` (json: id, filename, mimeType, sizeBytes, kind ("image"|"video"), publicUrl, uploadedAt).
   - Also indexes a "recent attachments" list at `project:${projectId}:attachments` (array of ids, capped at 20).
   - Returns `{ id, url, kind, mimeType, sizeBytes, filename }`.
9. Frontend updates the chat panel state:
   - `attachedMedia: { id, url, kind: "video", mimeType, filename, sizeBytes }`.
   - For images: data-URL preview (existing pattern).
   - For videos: render an HTML5 `<video>` thumbnail at 64px height with the first frame, controls hidden.
10. User types prompt: *"Drop this in as a full-bleed hero video, autoplay muted loop."*
11. User clicks **Send** (paper-plane icon).
12. Frontend calls existing `POST /api/chat/:projectId` SSE endpoint with body:
    ```json
    {
      "prompt": "Drop this in as a full-bleed hero video, autoplay muted loop.",
      "model": "<currently-selected-model>",
      "contextFiles": { ... },
      "attachments": [
        {
          "id": "abc123",
          "url": "https://<r2-public-domain>/attachments/<userId>/<projectId>/abc123.mp4",
          "kind": "video",
          "mimeType": "video/mp4",
          "filename": "hero.mp4",
          "sizeBytes": 47185920
        }
      ]
    }
    ```
13. Worker `chat.ts` deprecates `imageBase64` (still accepted for one release for backwards compat, but new code uses `attachments`). Branches:
    - **No attachments** → existing flow.
    - **Image attachment(s)** → optionally fetch image from R2 → push as `{ type: "image", image: binary, mimeType }` to AI SDK (preserves vision-model auto-switch). Cheaper alternative: pass URL as text and let model load via tool; only do this if a vision model selected.
    - **Video attachment(s)** → DO NOT auto-switch model. Inject a clear text block into `userContent`:
      ```
      The user has attached the following media. Use the URL directly in src attributes — do not attempt to base64-encode or describe the contents.

      Attachment 1:
      - kind: video
      - mimeType: video/mp4
      - url: https://<r2-public-domain>/attachments/.../abc123.mp4
      - filename: hero.mp4

      When embedding video, use HTML5 <video> with src set to the URL above. Default to autoPlay muted loop playsInline unless the user requests otherwise.
      ```
14. AI streams JSON files back including the new `<video>` JSX.
15. Sandpack preview re-renders, the video loads from R2, plays.
16. User sees success summary in chat ("Updated `/src/components/Hero.tsx` — 1 file changed").
17. Attachment URL is now permanently embedded in the project source. If the user runs `/api/export` or pushes via `/api/github`, the URL is part of the code.

### Empty State
- No attachment selected → paperclip button shows default styling, no preview card. (Same as today.)

### Loading State
- During upload → upload card with filename, progress bar (0–100%), spinner. Send button is **disabled** while upload is in flight.
- During AI generation → existing `Loader2` + `statusMessage` already covers it.

### Success State
- Upload complete → upload card replaces progress bar with a small green check + filename + size badge. Preview thumbnail visible. Send button re-enabled.

### Error States
- Wrong type → toast (red) + abort, no upload attempted.
- Oversize → toast (red) + abort.
- 401 (auth lapse) → toast `"Session expired. Please refresh and log in again."` + redirect to sign-in after 3s.
- 403 (project ownership mismatch) → toast `"You don't have access to this project."` (extremely rare).
- 5xx from worker → toast `"Upload failed. Please try again."` + keep the file selected so user can retry without re-picking.
- Network drop mid-upload → axios/fetch abort error → same retry message.
- R2 returns no URL (unexpected) → log to console + Sentry-like, toast `"Upload finished but no URL returned. Contact support."`.

### Permission-Denied States
- See 403 above.

### Mobile Behavior
- File input on mobile triggers the OS picker (camera roll on iOS, gallery+files on Android). Standard `<input type="file" accept="...">` handles this natively, no extra work.
- Preview card constrains width to `100%` and respects max height of 96px.
- Long filenames truncate with ellipsis.

### What happens if the user exits halfway
- Upload in flight + user closes tab → worker request is cancelled. R2 object may or may not have been written depending on how far the streaming PUT got. Stale R2 objects without a KV index entry are garbage-collected by a daily cron (Phase 3).
- AI generation in flight + user closes tab → existing behavior preserved (worker keeps streaming, frontend just disconnects). Attachment URL is already in R2.

### What happens if required data is missing
- No `projectId` → 400 from worker.
- No `file` field in FormData → 400.
- File but zero bytes → 400.

---

## 5. Admin Workflow

This feature does not require a separate admin workflow in v1. The platform is single-operator (Mario) with multi-user Clerk auth scaffolding for future use. **Recommended Phase 5 admin views (out of scope for this build):**
- A `/dashboard/admin/storage` page that lists total bytes, top users by storage, recent uploads.
- An ability to delete any attachment (overrides ownership check) for moderation/storage cleanup.

For now: storage cleanup happens via a daily cron job (§11). No human admin intervention needed.

---

## 6. UI/UX Requirements

### Screen/Component: Chat Panel — Paperclip Trigger

**Purpose:** Single button that opens the OS file picker for both images and videos.

**Location:** `components/editor/chat-panel.tsx`, the existing button at ~line 366 wrapping the `<Paperclip />` icon.

**Required changes:**
- The hidden `<input type="file" />` at ~line 354 must change `accept` from `image/*` to:
  ```
  image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/x-m4v
  ```
- Tooltip on hover: `"Attach image or video"`.

**Behavior:**
- Click → opens picker.
- File chosen → fires `handleAttachmentUpload(file)` (renamed from `handleImageUpload`).

---

### Screen/Component: Chat Panel — Attachment Preview Card

**Purpose:** Show the user that a file is queued for the next message.

**Location:** Same row as today's image preview (~line 335 of `chat-panel.tsx`). Replaces the current `attachedImage` block.

**Required elements:**
- For an **image** attachment: `<img>` thumbnail, height 64px, rounded.
- For a **video** attachment: `<video>` element with `src={url}`, `muted`, `playsInline`, `preload="metadata"`, **no controls**, height 64px, rounded. (The first frame renders as the poster.)
- Filename label (truncated, max-width 200px).
- Size label (e.g. `"45.0 MB"` — formatted with a tiny `formatBytes()` helper).
- Kind icon (small lucide `<ImageIcon>` for images, `<Video>` for videos) in the top-left of the thumb.
- Remove button (`<X>` in a circle, same as today) at top-right.
- Optional: small "Vision model active" badge if image triggers auto-switch (existing behavior — keep it for images, hide for videos).

**Behavior:**
- Clicking remove → calls `removeAttachment()` → clears state, restores prior model if vision was auto-switched.
- Hovering shows a tooltip with the full filename + size.

---

### Screen/Component: Chat Panel — Upload Progress Card

**Purpose:** Tell the user a file is uploading and how far along it is.

**Location:** Same slot as the preview card. Shown while upload is in flight; replaced by the preview card on success.

**Required elements:**
- Filename (truncated).
- Progress bar (`<div>` with width animated 0–100%). Use Tailwind `bg-primary` for the fill, `bg-zinc-800` for the track.
- Percentage text on the right.
- Spinner (lucide `<Loader2 className="animate-spin" />`).
- Cancel button (`<X>` — calls `xhr.abort()` or `AbortController.abort()`).

**Behavior:**
- Send button disabled while progress < 100%.
- On error: card stays, replaces spinner with `<AlertTriangle>` and shows error text. "Retry" button re-attempts the upload.

---

### Screen/Component: Toasts (already in repo via `sonner`)

**Required toasts:**
- `"Unsupported file type. We accept JPG, PNG, WebP, GIF, MP4, WebM, MOV, M4V."` — red
- `"File too large ({X} MB). Max is 100 MB."` — red
- `"Upload failed. Please try again."` — red, with a dismiss button
- `"Session expired. Please log in again."` — red, with a "Sign in" action
- `"Attachment ready."` — green, optional (auto-dismiss 1.5s) — only fired on >5MB uploads

---

### Screen/Component: Chat Panel — Recent Attachments Tray (Phase 4, OPTIONAL)

**Purpose:** Let user re-attach a previously uploaded asset without re-uploading.

**Location:** Below the textarea, a horizontally-scrolling row of 32px thumbs of the last 10 attachments for this project.

**Behavior:**
- Click a thumb → adds it back to the pending attachment slot.
- Click trash icon on a thumb → calls `DELETE /api/attachments/:id`.

**Mark as P2 — do not block initial release.**

---

## 7. Data Requirements

| Data Field | Type | Required? | Source | Example | Notes |
|---|---|---|---|---|---|
| `id` | string (nanoid 12) | Yes | Server | `aB3kL9zQrp01` | Primary key |
| `userId` | string | Yes | Clerk JWT | `user_2abc...` | Owner |
| `projectId` | string | Yes | Request body | `lhbY6xPIo9` | Foreign key to project |
| `filename` | string | Yes | Upload | `hero.mp4` | Sanitized server-side |
| `mimeType` | string | Yes | Upload + sniff | `video/mp4` | Validated against allowlist |
| `kind` | enum | Yes | Derived | `image` \| `video` | Derived from mimeType |
| `sizeBytes` | number | Yes | Server | `47185920` | Validated ≤ 100MB |
| `r2Key` | string | Yes | Server | `attachments/user_X/lhbY.../aB3k.mp4` | R2 object key |
| `publicUrl` | string | Yes | Server | `https://<r2-public-domain>/attachments/...` | Stable URL |
| `uploadedAt` | ISO 8601 | Yes | Server | `2026-05-04T19:23:01.000Z` | |
| `width` | number | No | (optional, image only) | `1920` | Skip in v1 |
| `height` | number | No | (optional, image only) | `1080` | Skip in v1 |
| `durationSec` | number | No | (optional, video only) | `12.5` | Skip in v1 |

### Storage layout

#### R2 bucket: `lovable-projects` (existing)

New key prefix:
```
attachments/{userId}/{projectId}/{attachmentId}.{ext}
```
- `httpMetadata.contentType` set on PUT.
- `customMetadata` includes `userId`, `projectId`, `attachmentId`, `filename` for forensic recovery.

#### KV namespace: `KV_METADATA` (existing)

Two new key shapes:

**Per-attachment record:**
```
KEY:   project:{projectId}:attachment:{attachmentId}
VALUE: JSON.stringify({ id, userId, projectId, filename, mimeType, kind, sizeBytes, r2Key, publicUrl, uploadedAt })
```

**Per-project list (capped to 20 most recent):**
```
KEY:   project:{projectId}:attachments
VALUE: JSON.stringify({ ids: ["abc123", "def456", ...] })
```

**Garbage-collection candidate set (Phase 3):**
```
KEY:   gc:attachment:{attachmentId}
VALUE: JSON.stringify({ deletedAt: "...", r2Key: "..." })
```

### Why no Supabase / no SQL table?
- Lovable Clone has zero relational data today. Everything is KV + R2.
- Adding Supabase for one feature would require a new dependency, env vars, migrations, and a runtime client in the worker.
- KV + R2 are sufficient for attachment metadata at any reasonable scale (<100k attachments per project).
- If/when we add a "connect Supabase" feature for **generated apps**, that's a separate SOP. This feature does not touch it.

---

## 8. Functional Requirements

### FR-001: Validate Attachment Client-Side Before Upload
The system must validate file type and size **before** any network call.

**Acceptance:**
- Unsupported type → toast, abort.
- Oversize → toast, abort.
- No network request fires.

### FR-002: Upload Attachment to R2 via Worker
The system must accept a multipart upload at `POST /api/attachments` and stream the body to R2.

**Acceptance:**
- Authenticated requests succeed.
- Unauthenticated requests return 401.
- Project ownership is verified.
- File is written to R2 with correct content-type.
- KV record is written.
- Response returns full attachment metadata including `publicUrl`.

### FR-003: Server-Side Validation
The worker must re-validate type and size — never trust the client.

**Acceptance:**
- Disallowed MIME → 415 Unsupported Media Type.
- Oversize → 413 Payload Too Large.
- Missing fields → 400 Bad Request.

### FR-004: Public Read Access via Stable URL
Each attachment must be retrievable at a stable HTTPS URL without auth (the R2 bucket is configured for public read on the `attachments/` prefix; alternative: use signed URLs with 1y expiry).

**Acceptance:**
- `curl <publicUrl>` returns the file with correct content-type.
- The URL is the same one returned in the upload response.
- The URL is the one referenced in generated code.

### FR-005: Inject Attachment URLs Into AI Prompt
When the chat request includes `attachments: []`, the worker must format and inject a structured block into `userContent` that gives the AI the URL, kind, and embedding guidance.

**Acceptance:**
- Block is emitted exactly once per request.
- For videos: model is **NOT** auto-switched.
- For images: existing vision auto-switch behavior preserved (or sent as `{ type: "image" }` directly when small enough).

### FR-006: Display Preview of Pending Attachment
The chat panel must show a thumbnail (image or first-frame video) with filename, size, and remove button.

**Acceptance:**
- Image preview renders.
- Video preview renders the first frame.
- Remove button clears state.

### FR-007: Persist Attachment Records Per-Project
KV must list attachments per project, capped at 20 most recent.

**Acceptance:**
- New attachment appears in `project:{id}:attachments`.
- Oldest is evicted when count exceeds 20 (and that R2 object is queued for GC, not deleted immediately).

### FR-008: List Attachments
A new endpoint `GET /api/attachments?projectId=xxx` returns the recent attachments for the project (used by Phase 4 tray).

**Acceptance:**
- Returns array of attachment records sorted desc by `uploadedAt`.
- Returns 403 if user doesn't own project.

### FR-009: Delete Attachment
Endpoint `DELETE /api/attachments/:id` removes both KV record and R2 object.

**Acceptance:**
- Owner can delete.
- Non-owner gets 403.
- KV record gone, R2 object deleted, attachment removed from `project:{id}:attachments` list.

### FR-010: Backwards Compatibility for `imageBase64`
The `chat.ts` worker must continue to accept the legacy `imageBase64` field for one release cycle so older clients don't break mid-deploy.

**Acceptance:**
- A request with only `imageBase64` works as before.
- A request with `attachments` works.
- A request with both: `attachments` wins, `imageBase64` is ignored, log a warning.

### FR-011: Error Logging
All worker errors during upload, validation, or KV writes must `console.error` with enough context (userId, projectId, attachmentId, error.message, error.stack) to debug from Cloudflare logs.

**Acceptance:**
- `wrangler tail` shows clear lines on every failure.

### FR-012: Mobile Compatibility
File picker, preview, and progress card must render correctly on viewports down to 360px wide.

**Acceptance:**
- No horizontal scroll on iPhone SE.
- All controls reachable via touch.

---

## 9. Non-Functional Requirements

- **Performance:**
  - Upload progress UI updates ≥ every 250ms.
  - Worker must stream the upload body directly to R2 (no full-buffer-in-memory before write). Cloudflare Worker bodies arrive as a `ReadableStream`; pass it straight to `R2_PROJECTS.put()`.
  - 50MB upload from a healthy Wi-Fi connection completes in ≤ 15s.
- **Security:**
  - All routes behind `authMiddleware`.
  - R2 keys include `userId` so a path-traversal can't leak across users.
  - No client-supplied paths used in R2 keys (server constructs the key from server-trusted IDs).
  - File extension is derived from validated MIME, not from the user-supplied filename.
- **Privacy:** Attachments are public URLs (read-only). The generated site embeds them anyway, so signed URLs would defeat the purpose. Document this clearly so users don't upload private content.
- **Reliability:**
  - On R2 PUT failure, no KV record is written (atomic semantics: write to R2 first, then KV).
  - On KV failure after R2 PUT, the orphan is logged for the GC cron.
- **Mobile responsiveness:** Full support down to 360px width.
- **Accessibility:**
  - Paperclip button has `aria-label="Attach image or video"`.
  - Upload progress card has `role="status"` + `aria-live="polite"`.
  - Remove button has `aria-label="Remove attachment"`.
- **Scalability:** R2 has no real ceiling at expected volume. KV capped at 25MB per value — the per-attachment record is < 1KB so no concern.
- **Browser support:** Chrome, Edge, Firefox, Safari (latest two majors). No IE.
- **Error handling:** Every fetch wraps in try/catch + user-visible message.
- **Logging:** See FR-011.
- **Maintainability:**
  - One new worker route file (`worker/src/routes/attachments.ts`).
  - One new shared type (`worker/src/types/attachment.ts`) imported by both worker and frontend (or duplicated — frontend doesn't import worker types today).
  - Frontend changes contained to `chat-panel.tsx` + one new helper file.

---

## 10. Integrations and Dependencies

| Integration | Purpose | Data Sent | Data Received | Failure Handling |
|---|---|---|---|---|
| Cloudflare R2 (`R2_PROJECTS` binding) | Store the file blob | Multipart body, contentType, customMetadata | R2 object reference + ETag | Return 502 to client, log to wrangler tail, no KV write |
| Cloudflare KV (`KV_METADATA` binding) | Store metadata | JSON record | OK / null | If write fails after R2 PUT, queue R2 key in `gc:attachment:*` for cleanup |
| Clerk JWT (existing JWKS verify) | Auth | Bearer token | userId | Return 401, frontend redirects to sign-in |
| OpenRouter via AI SDK (existing) | Generate code | System prompt + user prompt + attachments block (text) | Streaming tokens | Existing error path in `chat.ts` |
| **No Supabase** | — | — | — | Not used in this feature |
| **No external CDN** | — | — | — | R2 has its own public domain |

### R2 Public Access Setup
- The R2 bucket `lovable-projects` must have a public custom domain configured (e.g. `assets.<domain>`) OR the route must use the R2-managed `r2.dev` URL pattern.
- **DECISION (assumption):** Use the existing R2 public domain if one is set; otherwise generate signed URLs with 1-year expiry. Document in §22.

---

## 11. Automation and Background Jobs

### Automation: Orphan-Attachment Garbage Collection (Phase 3)

**Trigger:** Cloudflare Cron Trigger, daily at 03:00 UTC.

**Purpose:**
- Walk `gc:attachment:*` keys → delete R2 object + KV gc record.
- Walk `attachments/*` R2 prefix → for any object older than 30 days with no matching KV record, delete it.

**Failure handling:** Log per-object errors; cron retries next day. Set up a Slack/Telegram webhook to ping Mario if cron fails 3 days in a row.

**Cron config (add to `worker/wrangler.toml`):**
```toml
[triggers]
crons = ["0 3 * * *"]
```

### Automation: Attachment Cleanup on Project Delete

**Trigger:** When `DELETE /api/projects/:id` runs (existing route in `worker/src/routes/projects.ts`).

**Purpose:** Cascade-delete all attachments belonging to that project.

**Implementation:** In the project delete handler, list `project:{id}:attachment:*` KV keys → delete R2 objects → delete KV records. Wrap in try/catch — if any fails, queue the rest for GC.

---

## 12. Error Handling Plan

| Error Scenario | User Message | System Behavior | Log Required? |
|---|---|---|---|
| Wrong file type (client) | "Unsupported file type. We accept JPG, PNG, WebP, GIF, MP4, WebM, MOV, M4V." | Abort, no upload | No |
| Oversize file (client) | "File too large ({X} MB). Max is 100 MB." | Abort, no upload | No |
| Wrong type (server) | "Unsupported file type." | 415 response | Yes (someone bypassed client validation) |
| Oversize (server) | "File exceeds 100 MB limit." | 413 response | Yes |
| 401 expired Clerk JWT | "Session expired. Please log in again." | Redirect to /sign-in after 3s | No |
| 403 not project owner | "You don't have access to this project." | Abort | Yes |
| Network error during upload | "Upload failed. Please try again." | Retry button | Yes (console.warn) |
| R2 PUT failure | "Upload failed (storage error). Please try again." | 502 response | Yes (console.error + stack) |
| KV write failure post-R2 | "Upload partially succeeded — please retry." | 500 response, queue R2 key for GC | Yes (critical) |
| AI received URL but model 404'd it | (Best-effort detection: model output references the URL but doesn't render) | None — silent | No |
| Public R2 URL returns 404 (rare) | "Asset is no longer available." | Toast on chat send if validation enabled | Yes |
| Disk full / quota | "Storage quota exceeded — contact support." | 507 response | Yes (Mario alerted via Telegram) |
| Unknown crash | "Something went wrong. Please try again." | 500 response | Yes (full stack) |

---

## 13. Notifications and Alerts

- **In-app toasts:** All user-facing errors above use `sonner` toasts (already installed, see `package.json`).
- **Email:** None in v1.
- **Admin alerts (Phase 3):** Telegram `notify_mario()` (Mario already has a bot — see `CLAUDE.md`) on the following events:
  - Cron fails 3 days in a row.
  - Storage quota >80% on R2.
  - >100 GC orphans accumulate.
- **Status badges:** None in v1.
- **Dashboard warnings:** None in v1.

---

## 14. Logging and Audit Trail

Every mutating attachment operation logs a line to Cloudflare Workers logs (`wrangler tail`).

### Log line format
```
[Attachments] action={action} userId={userId} projectId={projectId} attachmentId={id} status={ok|fail} mime={mimeType} size={bytes} durationMs={n} err={message?}
```

### Audit log structure (KV)

For Phase 3, store an audit entry on every action:

| Field | Description |
|---|---|
| `id` | nanoid(12) — log entry id |
| `userId` | Clerk user who performed the action |
| `actionType` | `create` \| `delete` \| `view-list` |
| `targetType` | `attachment` |
| `targetId` | Attachment id |
| `projectId` | Owning project |
| `metadata` | `{ filename, mimeType, sizeBytes }` |
| `status` | `success` \| `failure` |
| `errorMessage` | If failure |
| `createdAt` | ISO timestamp |
| `ip` | Optional, from CF-Connecting-IP header |

KV key: `audit:attachment:{actionType}:{ts}:{logId}`

**This is Phase 3.** Don't block v1 on audit logs. Phase 1/2 logs go to wrangler tail only.

---

## 15. Security Requirements

- **Authentication:** Every route uses `authMiddleware`. No exceptions.
- **Authorization:** Project ownership re-checked on every attachment operation against `kv.get("user:${userId}:project:${projectId}")`.
- **API key protection:** R2 + KV bindings are server-only. No frontend code touches them.
- **Input validation:**
  - MIME type validated against allowlist on both client and server.
  - File extension derived from validated MIME, not user-supplied filename.
  - Filename sanitized: strip path separators, control chars, limit to 200 chars.
  - Project ID format validated: `^[A-Za-z0-9_-]{6,16}$` (matches existing nanoid pattern).
- **File upload security:**
  - Size capped at 100MB.
  - Body streamed (not buffered) — protects worker memory.
  - Reject content-types not in allowlist even if extension matches.
- **Rate limiting:** Add a lightweight rate limiter — `userId`-keyed, max 30 uploads per 10 minutes. Use KV with an expiry-based counter (cheap; not strictly atomic but good enough).
- **Data privacy:**
  - **Document explicitly that attachments are publicly accessible by URL.**
  - Add a tooltip on the paperclip: `"Public assets — anyone with the URL can view"`.
- **Avoid exposure:**
  - Never echo the R2 access keys in logs.
  - Never include `customMetadata` in the public response (it has `userId`).
- **Server-side validation:** Mandatory; client-side is for UX only.

### Things that must never happen:
- A user uploading and getting an R2 URL that contains another user's `userId`.
- A user reading another user's attachment list.
- A request without a valid Clerk JWT successfully writing to R2.
- A 200MB file landing in R2.
- Filename `../../etc/passwd` ending up as the R2 key.

---

## 16. Build Phases

### Phase 1: Foundation (worker + storage)

**Goal:** A working `POST /api/attachments` route that writes to R2 and KV.

**Tasks:**
1. Create `worker/src/routes/attachments.ts`. Mount in `worker/src/index.ts` at `/api/attachments`.
2. Implement `POST /` handler — auth, validate, stream body to R2, write KV record, return JSON.
3. Implement `GET /?projectId=xxx` handler — auth, ownership check, return list.
4. Implement `DELETE /:id` handler — auth, ownership check, delete R2 + KV.
5. Add server-side allowlist of MIME types in `worker/src/services/attachments.ts`.
6. Add a `formatBytes()` and a `safeFilename()` helper.
7. Curl-test all three endpoints manually using a real Clerk JWT pulled from the browser.
8. Confirm R2 public URL works (`curl <publicUrl>` returns 200 with correct content-type).

**Completion criteria:**
- All three endpoints respond 200 for valid auth + valid input.
- 401 for missing token, 403 for wrong owner, 415 for wrong MIME, 413 for oversize.
- File visible in `wrangler r2 object list lovable-projects --prefix attachments/`.

---

### Phase 2: Frontend (chat panel)

**Goal:** Paperclip accepts video, shows preview, uploads, sends URL to chat.

**Tasks:**
1. Rename state in `chat-panel.tsx`: `attachedImage` → `attachedMedia` (object, not string).
2. Update `<input>` accept attribute.
3. Replace `handleImageUpload` → `handleAttachmentUpload(file)`. Inside:
   - Validate type + size.
   - Build FormData, POST to `${WORKER_URL}/api/attachments`.
   - Update progress via `XMLHttpRequest` (fetch lacks progress events, XHR is cleaner here) OR use `axios` with `onUploadProgress`.
   - On success: set `attachedMedia` state to the response.
4. Build `AttachmentPreview` component (new file: `components/editor/attachment-preview.tsx`).
5. Build `UploadProgress` component (same file or sibling).
6. Update `handleSubmit` body — replace `imageBase64` with `attachments: [attachedMedia]`.
7. Update worker `chat.ts`:
   - Accept `attachments` array in body.
   - Build the structured text block (FR-005).
   - For images, retain vision auto-switch (read R2 object → push as binary).
   - For videos, do NOT switch model.
   - Keep `imageBase64` accepted for one release for compat (FR-010).
8. Update system prompt (`SCAFFOLD_PROMPT` and `ITERATION_PROMPT`) to include a brief note: *"If the user provides an attachment URL, embed it via the appropriate HTML element — never base64-encode."*
9. Manual test: attach an mp4, send "make this a hero video", confirm Sandpack renders it.

**Completion criteria:**
- Clicking paperclip + picking mp4 shows progress, then preview.
- Sending a chat with an attached video produces JSX with the correct `<video src="https://...">`.
- Existing image attachment flow still works.

---

### Phase 3: Reliability & GC

**Goal:** Production-grade error handling, cleanup, and observability.

**Tasks:**
1. Add cron trigger to `wrangler.toml` (`0 3 * * *`).
2. Implement scheduled handler in `worker/src/index.ts` (`export default { fetch, scheduled }`).
3. Walk `gc:attachment:*` keys, delete R2 objects + KV records.
4. Walk R2 `attachments/` prefix, delete orphans older than 30 days.
5. Add cascade-delete in project delete handler.
6. Add rate limiter middleware on attachment routes (30 / 10min per userId).
7. Add Telegram notify on cron failures.

**Completion criteria:**
- `wrangler tail` shows clean cron runs.
- Manually orphaned R2 object gets cleaned up.
- Deleting a project cascades to its attachments.

---

### Phase 4: Polish & UX (stretch)

**Goal:** Make it feel finished.

**Tasks:**
1. Recent attachments tray (per-project, last 10).
2. Drag-and-drop into chat panel.
3. Multiple-file selection (queue 2-3 files at once).
4. Optional thumbnail generation for videos (capture first frame as poster JPG, upload alongside).
5. Lighthouse / a11y pass.

---

## 17. Developer Task List

### Frontend Tasks (Next.js app)
- [ ] Update `components/editor/chat-panel.tsx` — rename state, broaden `accept`, swap handler.
- [ ] Create `components/editor/attachment-preview.tsx`.
- [ ] Create `components/editor/upload-progress.tsx`.
- [ ] Add `lib/upload.ts` — XHR-based upload with progress.
- [ ] Add `lib/format.ts` — `formatBytes()`.
- [ ] Update `lib/models.ts` — no change needed; vision auto-switch stays for images only (logic moves to worker).
- [ ] Update `WORKER_URL` usage as-is (already in `lib/constants.ts`).
- [ ] Add lucide imports: `Video`, `ImageIcon`, `AlertTriangle`.
- [ ] Mobile testing in Chrome devtools (iPhone SE viewport).
- [ ] Verify Sandpack preview plays the video (it should — it's just plain HTML).

### Backend Tasks (Cloudflare Worker)
- [ ] Create `worker/src/routes/attachments.ts`.
- [ ] Create `worker/src/services/attachments.ts` (validation, R2 helpers).
- [ ] Mount router in `worker/src/index.ts`.
- [ ] Update `worker/src/routes/chat.ts`:
  - [ ] Accept `attachments` array.
  - [ ] Build text block.
  - [ ] Image fetch + binary inject for vision (re-using existing pattern).
  - [ ] Video → text-only.
  - [ ] Keep `imageBase64` working for one release.
- [ ] Update `worker/src/routes/projects.ts` — cascade-delete on project delete.
- [ ] Update `worker/src/ai/system-prompt.ts` — note about attachment URLs.
- [ ] Add scheduled handler for GC.
- [ ] Add rate limiter helper.
- [ ] Update `worker/wrangler.toml` — add cron trigger.

### Integration Tasks
- [ ] Confirm R2 public domain or signed-URL strategy (see §22 Q1).
- [ ] If public domain, ensure `lovable-projects` bucket has it set in Cloudflare dashboard.
- [ ] If signed URLs, write `getSignedUrl()` helper using R2 S3-compatible API.

### QA Tasks
- [ ] Test happy path: image upload → chat → AI uses it.
- [ ] Test happy path: video upload → chat → `<video src="...">` rendered.
- [ ] Test wrong file type → blocked client-side.
- [ ] Test oversize → blocked client-side.
- [ ] Test bypass-client (curl directly with bad MIME) → blocked server-side.
- [ ] Test non-owner upload → 403.
- [ ] Test no auth → 401.
- [ ] Test cancel mid-upload → no orphans (or cleanly orphaned for GC).
- [ ] Test mobile viewport → preview & progress fit.
- [ ] Test with Claude Sonnet 4.6, GPT-5.4, and Kimi K2.6 → all embed URL correctly.
- [ ] Test with image attachment + non-vision model → auto-switches as today.
- [ ] Test with video + non-vision model → does **not** auto-switch.
- [ ] Test public URL renders in Sandpack preview.
- [ ] Test export project → URL preserved in exported zip.

---

## 18. Acceptance Criteria

The feature is complete when:
- [ ] User can pick a video from the paperclip and see a preview thumbnail.
- [ ] Upload to R2 completes within 15s for a 50MB file.
- [ ] Server validates MIME and size and rejects bad inputs.
- [ ] AI receives attachment URL as text and embeds it via `<video>` or `<img>`.
- [ ] Sandpack live preview plays the video.
- [ ] Existing image attachment flow continues to work.
- [ ] Vision model auto-switch fires for images only, never for videos.
- [ ] Backwards-compat field `imageBase64` still works.
- [ ] Worker logs show successful uploads with `[Attachments]` prefix.
- [ ] Public R2 URL renders correctly when curled.
- [ ] All errors show clean toasts with actionable copy.
- [ ] Mobile viewport (360px) works.
- [ ] No regression in `/api/chat`, `/api/projects`, `/api/export`, `/api/github`.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes for both Next app and worker.
- [ ] Manual QA cases above all pass.
- [ ] At least one cron run executes cleanly (Phase 3 only).

---

## 19. Testing Plan

### Manual Testing

| Test Case | Steps | Expected Result |
|---|---|---|
| Image happy path | Open editor, click paperclip, pick `test.jpg`, type "use this as logo", send. | AI generates code with `<img src="https://...">` referencing the R2 URL. Preview renders. |
| Video happy path | Same as above with `test.mp4`. | AI generates `<video src="..." autoPlay muted loop playsInline>`. Preview plays. |
| Bad type | Pick `test.pdf`. | Toast: "Unsupported file type..." Nothing uploaded. |
| Oversize | Pick a 150MB mp4. | Toast: "File too large (150 MB). Max is 100 MB." Nothing uploaded. |
| No auth | In devtools, drop the Authorization header from the upload request. | 401, toast: "Session expired..." |
| Wrong owner | Forge a request with another user's `projectId`. | 403, toast: "You don't have access to this project." |
| Network drop | Pull network mid-upload. | Toast: "Upload failed. Please try again." Retry works. |
| Cancel | Click X during upload. | XHR aborts, no preview, no R2 object remains. |
| Mobile | Chrome devtools 360px width. | Picker opens, preview fits, send works. |
| Sandpack render | After successful video chat, look at preview iframe. | Video plays, no CORS error in console. |
| Export | After uploading + chatting, click Export. | Zip contains code referencing the absolute R2 URL. |
| GitHub push | Push project via `/api/github`. | Pushed code references absolute R2 URL. |
| Vision auto-switch | Upload an image with a non-vision model selected. | Worker auto-switches to VISION_MODEL (existing behavior). |
| Video — no auto-switch | Upload a video with Kimi K2.6 selected. | Stays on Kimi K2.6. |
| Backwards compat | Send a chat with old `imageBase64` payload (no `attachments` key). | Works as before. |
| Both fields | Send chat with both `imageBase64` and `attachments`. | `attachments` wins. Warning logged. |
| Cascade delete | Delete a project that has 3 attachments. | All R2 objects + KV records gone. |
| Cron GC | Manually create an orphan; wait for cron or trigger via `wrangler dev --test-scheduled`. | Orphan cleaned up. |

### Automated Testing Recommendations

- **Unit tests (vitest in worker):**
  - `validateMimeType()` — accepts allowed, rejects others.
  - `safeFilename()` — strips bad chars.
  - `buildAttachmentPromptBlock()` — formats correctly for image/video/mixed.
- **Worker integration tests (`wrangler dev` + supertest-like):**
  - POST upload → returns metadata.
  - POST oversize → 413.
  - POST without auth → 401.
  - DELETE non-owner → 403.
- **Frontend component tests (Vitest + React Testing Library):**
  - `<AttachmentPreview>` renders for image, video, missing kind.
  - `<UploadProgress>` updates width on progress events.
  - `<ChatPanel>` calls upload helper on file pick.
- **E2E (Playwright — Mario already uses Playwright in `tools/execution/`):**
  - Full happy path: log in via Clerk test user, attach mp4, chat, assert generated code, assert preview plays.

---

## 20. Edge Cases

| Edge Case | Expected Behavior |
|---|---|
| User has no projects yet | Shouldn't reach the chat panel. If they do, attachment endpoints return 404. |
| User loses connection mid-upload | XHR abort fires; toast shown; partial R2 object queued for GC. |
| AI returns code that references a non-existent attachment URL | Sandpack shows broken video icon. Acceptable in v1; document. |
| Duplicate filename on the same project | Server uses `attachmentId` as the key; collisions impossible. |
| User uploads then deletes attachment, then chats with old reference | Generated code already has the URL — it 404s in preview. Document; not blocking. |
| User refreshes during upload | XHR cancels. Same as connection-drop. |
| Background job (cron) fails | Logs error; ping Mario via Telegram; retries next day. |
| Conflicting MIME (file says `.mp4` but bytes are PNG) | Server detects content-type from a sniff library OR trusts client `Content-Type` from form data — easier path is allowlist enforcement on the multipart `Content-Type` header. Acceptable risk in v1. |
| Mobile user with very small screen (<360px) | Preview thumbnail shrinks to 48px; filename truncates aggressively. |
| Two users from same Clerk org | Each scoped by `userId`. Cross-user access blocked by ownership check. |
| Public R2 URL hot-linked from elsewhere | Acceptable — these are intentionally public. Future: add `Referrer-Policy: no-referrer-when-downgrade` and Cloudflare hotlink protection if abuse appears. |
| Worker cold-start during upload | First-byte may be slow (~500ms) but body still streams to R2 normally. |
| User uploads same video twice | Two separate R2 objects + KV records. Acceptable — dedupe is a Phase 4 nice-to-have. |
| AI hallucinates a different URL than the one provided | System prompt update (FR-005) explicitly says "use the URL exactly". Sandpack will 404 if it doesn't. Re-prompt by user resolves it. |
| KV write succeeds but R2 PUT fails (impossible because order is reversed, but just in case) | Caller gets 502; nothing persisted; user retries. |
| Daily cron deletes an attachment that's still referenced in code | GC only deletes objects whose KV record is missing — it can't delete a live attachment. Safe. |

---

## 21. Documentation for Future Agents

You are now responsible for building this feature. Before editing code, **inspect the existing app structure, routes, components, database schema, environment variables, and current patterns**. Do not blindly create duplicate systems. Reuse existing components and conventions where possible.

### First, do this:
1. Open `C:\Users\mario\Projects\lovable-clone\` and read these files top-to-bottom:
   - `worker/src/index.ts` — see how routers mount and what bindings exist.
   - `worker/src/routes/projects.ts` — copy this as your scaffolding pattern (auth, KV, R2 usage).
   - `worker/src/routes/chat.ts` — understand the streaming SSE pattern and where you'll inject the attachment block.
   - `worker/src/middleware/auth.ts` — do not write a new auth path; mount `authMiddleware` and move on.
   - `worker/wrangler.toml` — confirm `R2_PROJECTS` and `KV_METADATA` bindings.
   - `components/editor/chat-panel.tsx` — read fully before changing anything.
   - `lib/constants.ts` and `lib/models.ts` — `WORKER_URL` and `VISION_MODEL` live here.
   - `middleware.ts` — confirms which Next routes are public.

### Then verify:
- Confirm Clerk JWT works by hitting `GET /api/projects` with a real bearer token from the browser devtools (Application → Cookies → `__session` is the Clerk JWT — copy from network tab on any authed request).
- Confirm R2 bucket name: `lovable-projects`. If a public domain is set, find it in Cloudflare dashboard → R2 → bucket → Settings → Public access. If not, configure one BEFORE writing the upload route, or default to signed URLs.
- Confirm the Next dev server runs at `http://localhost:3015` (not 3000) — Mario has it pinned.
- Confirm worker dev runs at `http://localhost:8788`.

### Patterns to follow (do not invent new ones):
- Hono router per file (`new Hono<{ Bindings; Variables }>()`).
- `chatRouter.use("*", authMiddleware)` at top of every route file.
- KV keys use `:` as separator and the structure `<scope>:<id>:<subscope>:<id>`.
- nanoid lengths: 10 for projects, 12 for attachments (so they sort apart).
- Errors → `c.json({ error: "..." }, status)`.
- Successes → `c.json({ ...data })` (no envelope).
- `console.log` / `console.error` are the logging primitives.

### Do not:
- Add Supabase, Drizzle, Prisma, or any other ORM. KV + R2 only.
- Add a new auth mechanism. Use `authMiddleware`.
- Add a new state library. The chat panel is `useState` only — keep it that way.
- Stream files into memory before writing to R2 — use the streaming pattern.
- Trust the client's `Content-Type` exclusively — re-validate against the allowlist server-side.
- Break the existing `imageBase64` flow during this release.

### Make a short plan first, then build:
1. Open a new branch: `git checkout -b feat/attachments`.
2. Phase 1 first (worker routes + R2 + KV). Manually curl-test before touching the frontend.
3. Phase 2 (frontend). Test in a browser with the dev tools network tab open.
4. Phase 3 (cron + GC) only after Phases 1 and 2 are merged or at least working.
5. Commit in small chunks. Push only when Mario explicitly says so (per `CLAUDE.md` global push-confirmation rule).

### Document any assumptions you make in `/docs/SOP_VIDEO_UPLOAD_NOTES.md`.

---

## 22. Open Questions and Assumptions

### Assumptions
- **A1:** R2 bucket `lovable-projects` has (or will be configured with) a public custom domain. If not, we'll fall back to signed URLs with 1-year expiry.
- **A2:** 100MB cap is acceptable. If Mario needs larger, we'll switch to a multipart-upload + presigned-URL pattern (~3 extra hours).
- **A3:** Public read access on attachments is acceptable. The generated site embeds the URL anyway; making them private would require signed-URL rotation and break Sandpack/exported sites.
- **A4:** AI SDK v6 + OpenRouter handle a structured text block with embedded URLs correctly across all 21 listed models. Verified during Phase 2 testing.
- **A5:** Sandpack preview can load `https://` video URLs without extra config. (It's plain HTML — no reason it can't.)
- **A6:** No need for thumbnail generation in v1. Browser renders first frame as poster.
- **A7:** No need for transcoding. Browsers play mp4/webm/mov natively in 2026.
- **A8:** No CDN in front of R2 for v1. R2's free egress is sufficient at expected scale.
- **A9:** Rate limit of 30 uploads / 10 min per user is generous enough. Tighten if abuse appears.
- **A10:** `imageBase64` stays in worker for one release cycle (≈ 2 weeks), then removed in v1.1.

### Questions to confirm later
- **Q1:** What is the R2 public domain (if one is already configured)? `assets.<something>` — Mario to confirm.
- **Q2:** Should we capture analytics on attachment usage (count, total bytes)? Recommend yes in Phase 3 but not v1.
- **Q3:** Should we add HEIC/AVIF support for iPhone images? Yes, in Phase 4.
- **Q4:** Should we strip EXIF metadata from images? Recommend yes — small privacy win, ~10 LOC. Add in Phase 4.
- **Q5:** Should the live preview Sandpack iframe set `Content-Security-Policy` with `media-src https://<r2-domain>`? Test first; if Sandpack iframes have CSP that blocks R2, configure `media-src *` in Sandpack options.
- **Q6:** Does Cloudflare R2's free tier cover expected egress, or do we need to add a CDN? Mario to monitor in dashboard.

---

## 23. Final Output Notes (for the next agent)

- This SOP is the source of truth. If anything inside it conflicts with what you find in the repo, **trust the repo and update this SOP**.
- Build in phases. Don't try to ship Phase 4 polish in the v1 PR.
- When in doubt, copy the structure of `worker/src/routes/projects.ts` — it's the cleanest existing example.
- Do **not** open a PR until at least the Phase 1 + Phase 2 acceptance criteria pass locally.
- After verifying locally, ask Mario which deploy targets to push to (per global `CLAUDE.md` rule).
- File the verification screenshots / curl outputs in `docs/verification/SOP_VIDEO_UPLOAD/`.

---

## Appendix A: File-Level Change Inventory

| File | Action | Notes |
|---|---|---|
| `worker/src/routes/attachments.ts` | **CREATE** | New route: POST upload, GET list, DELETE one |
| `worker/src/services/attachments.ts` | **CREATE** | Validation + R2 helpers |
| `worker/src/types/attachment.ts` | **CREATE** | Shared types |
| `worker/src/index.ts` | **EDIT** | Mount `/api/attachments` router; add scheduled handler (Phase 3) |
| `worker/src/routes/chat.ts` | **EDIT** | Accept `attachments`; build text block; preserve image vision flow; keep `imageBase64` for one release |
| `worker/src/routes/projects.ts` | **EDIT** | Cascade-delete attachments on project delete (Phase 3) |
| `worker/src/ai/system-prompt.ts` | **EDIT** | Add attachment-URL note |
| `worker/wrangler.toml` | **EDIT** | Add cron trigger (Phase 3) |
| `components/editor/chat-panel.tsx` | **EDIT** | Rename state, update accept, swap handler, swap preview, swap submit body |
| `components/editor/attachment-preview.tsx` | **CREATE** | Image/video preview card |
| `components/editor/upload-progress.tsx` | **CREATE** | Progress card |
| `lib/upload.ts` | **CREATE** | XHR upload helper with progress |
| `lib/format.ts` | **CREATE** | `formatBytes()` |
| `docs/SOP_VIDEO_UPLOAD.md` | **THIS FILE** | The SOP |
| `docs/SOP_VIDEO_UPLOAD_NOTES.md` | **CREATE during build** | Implementer's notes & assumption log |
| `docs/verification/SOP_VIDEO_UPLOAD/` | **CREATE during QA** | Screenshots + curl logs |

---

## Appendix B: Concrete Code Snippet — Worker Upload Route Skeleton

```ts
// worker/src/routes/attachments.ts
import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { nanoid } from "nanoid";

const ALLOWED = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime", "video/x-m4v",
]);
const MAX_BYTES = 100 * 1024 * 1024;

const attachmentsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();
attachmentsRouter.use("*", authMiddleware);

attachmentsRouter.post("/", async (c) => {
  const userId = c.get("userId");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  const projectId = form.get("projectId") as string | null;

  if (!file || !projectId) return c.json({ error: "Missing file or projectId" }, 400);
  if (!ALLOWED.has(file.type)) return c.json({ error: "Unsupported file type" }, 415);
  if (file.size > MAX_BYTES) return c.json({ error: "File too large" }, 413);

  // Ownership check
  const projStr = await kv.get(`user:${userId}:project:${projectId}`);
  if (!projStr) return c.json({ error: "Project not found" }, 404);

  const id = nanoid(12);
  const ext = file.type.split("/")[1].replace("quicktime", "mov").replace("x-m4v", "m4v");
  const r2Key = `attachments/${userId}/${projectId}/${id}.${ext}`;
  const kind = file.type.startsWith("video/") ? "video" : "image";

  // Stream to R2
  await r2.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { userId, projectId, attachmentId: id, filename: safeName(file.name) },
  });

  // Build public URL — adjust for your bucket's public domain
  const publicUrl = `${c.env.R2_PUBLIC_DOMAIN || ""}/${r2Key}`;

  const record = {
    id, userId, projectId,
    filename: safeName(file.name),
    mimeType: file.type,
    kind,
    sizeBytes: file.size,
    r2Key,
    publicUrl,
    uploadedAt: new Date().toISOString(),
  };

  // Index
  await kv.put(`project:${projectId}:attachment:${id}`, JSON.stringify(record));
  // (Update the per-project list — read, push, cap to 20, write back.)

  console.log(`[Attachments] action=create userId=${userId} projectId=${projectId} attachmentId=${id} status=ok mime=${file.type} size=${file.size}`);
  return c.json(record);
});

// GET / DELETE handlers similar pattern...

export default attachmentsRouter;

function safeName(n: string): string {
  return n.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}
```

(This is reference, not final. The implementing agent should adapt to current TypeScript strictness, error envelope conventions, and any worker-internal helpers I've missed.)

---

## Appendix C: Concrete Code Snippet — Frontend Upload Helper Skeleton

```ts
// lib/upload.ts
import { WORKER_URL } from "./constants";

export interface AttachmentRecord {
  id: string;
  url: string;
  kind: "image" | "video";
  mimeType: string;
  filename: string;
  sizeBytes: number;
}

export function uploadAttachment(
  file: File,
  projectId: string,
  token: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<AttachmentRecord> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("projectId", projectId);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error("Bad response")); }
      } else {
        let msg = "Upload failed";
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        reject(new Error(`${xhr.status}: ${msg}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Aborted")));
    if (signal) signal.addEventListener("abort", () => xhr.abort());

    xhr.open("POST", `${WORKER_URL}/api/attachments`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(form);
  });
}
```

---

## Appendix D: AI Prompt Block Format

The exact text the worker injects into `userContent` for each attachment. Keep wording stable across models.

```
The user has attached the following media to this message. Use each URL EXACTLY as provided in the appropriate HTML element's src attribute. Do NOT base64-encode, transcode, or describe the contents — these are real assets the user wants embedded in the generated site.

Attachment {n}:
- kind: {image|video}
- mimeType: {mimeType}
- url: {publicUrl}
- filename: {filename}

Embedding rules:
- For kind=image: use <img src="..." alt="..."> with a meaningful alt derived from the user's prompt or filename.
- For kind=video: use <video src="..." autoPlay muted loop playsInline className="..."> unless the user requests otherwise (e.g. "with controls", "no autoplay").
- Always preserve aspect ratio with object-fit: cover unless user requests otherwise.
- If the user's prompt is silent on placement, place the asset prominently (hero / section header / card image).
```

---

**END OF SOP — hand off to implementing agent.**
