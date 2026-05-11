# SOP Video Upload — Implementer Notes
# Build date: 2026-05-04

## Decisions & Assumptions Made

### A1: R2 Public Domain (R2_PUBLIC_DOMAIN)
The `R2_PUBLIC_DOMAIN` env var must be set before deployment. Without it, attachment uploads return 500 with "Storage not fully configured — R2_PUBLIC_DOMAIN is missing."
To configure:
1. Go to Cloudflare Dashboard → R2 → lovable-projects → Settings → Public Access → Custom Domain
2. Set the domain (e.g. `assets.lovable.yourdomain.com`)
3. Add `R2_PUBLIC_DOMAIN` to Cloudflare Worker secrets: `wrangler secret put R2_PUBLIC_DOMAIN`
4. For local dev: add to `worker/.dev.vars`

### A2: Worker Export Format Changed
Changed from `export default app` to `export default { fetch: app.fetch, scheduled }` to support the GC cron. The `app.fetch` method is Hono's built-in fetch handler; this is the standard Cloudflare Workers pattern for Hono apps with cron triggers.

### A3: Image Binary Fetch from R2
For image attachments, the chat worker fetches the image bytes directly from R2 via the binding (no HTTP round-trip needed). This preserves the vision-model binary injection pattern that existed for `imageBase64`.

### A4: Video Attachments — No Model Auto-Switch
Video attachments always go through as text-only (URL injected into system prompt). The model is never auto-switched for video-only attachments.

### A5: Legacy `imageBase64` Preserved
The chat worker still accepts the old `imageBase64` field. If both `attachments` and `imageBase64` are present, `attachments` takes priority (imageBase64 is silently ignored).

### A6: Rate Limiter
Implemented via KV `ratelimit:upload:{userId}` with 600s TTL. Not strictly atomic — two concurrent uploads might both pass at exactly 29 → 30. Acceptable for v1 per SOP.

### A7: Cascade Delete on Project Delete
Project deletion now cascades to: all attachment KV records, all attachment R2 objects, and all version R2 objects. Individual failures queue orphaned objects under `gc:attachment:*` for the daily cron.

### A8: Single-Attachment Only (Frontend)
The frontend currently supports one attachment at a time. The worker already supports arrays for future multi-file. Phase 4 would add the multi-select UI.

### A9: No R2 Key Derivation from URL
The frontend sends `r2Key` directly to the chat worker rather than the worker deriving it from the public URL. This avoids fragile string parsing.

## Files Changed

### Created
- `worker/src/routes/attachments.ts` — POST upload, GET list, DELETE one
- `worker/src/services/attachments.ts` — validation, helpers, prompt block builder
- `worker/src/types/attachment.ts` — shared types + constants
- `components/editor/attachment-preview.tsx` — image/video preview card
- `components/editor/upload-progress.tsx` — upload progress card
- `lib/upload.ts` — XHR upload helper with progress
- `lib/format.ts` — `formatBytes()` utility
- `docs/SOP_VIDEO_UPLOAD_NOTES.md` — this file

### Modified
- `worker/src/index.ts` — added attachments router, R2_PUBLIC_DOMAIN binding, scheduled handler
- `worker/src/routes/chat.ts` — accept attachments, build prompt block, preserve imageBase64
- `worker/src/routes/projects.ts` — cascade-delete attachments on project delete
- `worker/src/ai/system-prompt.ts` — attachment URL embedding rules
- `worker/wrangler.toml` — R2_PUBLIC_DOMAIN var, cron trigger
- `components/editor/chat-panel.tsx` — full attachment pipeline (validate → upload → preview → send)
- `next.config.ts` — removed deprecated `turbopackPersistentCaching` field (pre-existing build error)

## What Still Needs Manual Setup

1. **R2 Public Domain** — configure in Cloudflare Dashboard → R2 → lovable-projects → Settings
2. **`R2_PUBLIC_DOMAIN` secret** — `wrangler secret put R2_PUBLIC_DOMAIN` for production
3. **Worker deploy** — `cd worker && npm run deploy`
4. **Clerk CORS origins** — if using a custom R2 domain, add it to the CORS origins in index.ts if needed
5. **Test with real Clerk JWT** — curl the endpoints with a valid token from browser devtools
