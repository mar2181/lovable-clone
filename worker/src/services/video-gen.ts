// fal.ai video generation service.
// Replaces FAL_VIDEO[description] placeholders in any file with hosted MP4
// URLs produced by fal-ai/kling-video/v1.6/standard/text-to-video.
//
// Cinematic mode is the primary consumer — the model emits a single
// FAL_VIDEO marker for the hero background video, and the worker resolves
// it after the JSON envelope is parsed.

// Kling text-to-video takes 2-4 min, so the synchronous fal.run wrapper times
// out (server- or client-side) before completion. We use the QUEUE API:
// submit → poll status every few seconds → fetch result when COMPLETED.
const KLING_QUEUE_SUBMIT_URL =
  "https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video";

const VIDEO_PLACEHOLDER_REGEX = /FAL_VIDEO\[([^\]]+)\]/g;

// Caps. Cinematic mode generates at most one hero video per turn, but we
// allow a small bound so a richer page could request multiple short clips.
const MAX_VIDEOS_PER_TURN = 2;

// Per-video cap (covers worst-case Kling latency).
const PER_VIDEO_TIMEOUT_MS = 300_000;

// Global cap across all videos in parallel. Same value because we render
// in parallel anyway.
const GLOBAL_VIDEO_TIMEOUT_MS = 320_000;

// Polling cadence for the queue API. fal expects ~5s between polls.
const POLL_INTERVAL_MS = 5_000;
const SUBMIT_TIMEOUT_MS = 15_000;
const POLL_REQUEST_TIMEOUT_MS = 15_000;

interface FalVideoResult {
  video?: { url?: string; content_type?: string };
}

function promptForCinematicVideo(description: string): string {
  // Cinematic skill house style: golden hour, slow camera push, no text,
  // no people, professional commercial-photography polish. Mirrors the
  // Kling prompt body used in the gold-standard SPI Fun Rentals build.
  const base = description.trim();
  if (/cinematic|dolly|push|golden hour|4k|commercial|editorial/i.test(base)) {
    return base; // Caller already wrote a strong cinematic prompt.
  }
  return [
    base,
    "cinematic slow camera push",
    "late afternoon golden hour light",
    "shallow depth of field",
    "professional commercial photography",
    "4k cinematic",
    "no text",
    "no people",
  ].join(", ");
}

interface FalQueueSubmitResponse {
  status?: string;
  request_id?: string;
  response_url?: string;
  status_url?: string;
}

interface FalQueueStatusResponse {
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  request_id?: string;
  response_url?: string;
  logs?: Array<{ message?: string }> | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function generateKlingVideo(
  falKey: string,
  description: string,
): Promise<string | null> {
  // 1. Submit to queue.
  let submit: FalQueueSubmitResponse;
  try {
    const res = await fetchWithTimeout(
      KLING_QUEUE_SUBMIT_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${falKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: promptForCinematicVideo(description),
          duration: "5",
          aspect_ratio: "16:9",
        }),
      },
      SUBMIT_TIMEOUT_MS,
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        "fal.ai Kling queue submit failed:",
        res.status,
        res.statusText,
        text.slice(0, 400),
      );
      return null;
    }

    submit = (await res.json()) as FalQueueSubmitResponse;
  } catch (err: any) {
    console.error("fal.ai Kling queue submit threw:", err?.message || err);
    return null;
  }

  const statusUrl = submit.status_url;
  const responseUrl = submit.response_url;
  if (!statusUrl || !responseUrl) {
    console.error(
      "fal.ai Kling queue submit returned no status_url / response_url:",
      submit,
    );
    return null;
  }

  // 2. Poll status until COMPLETED / FAILED / timeout.
  const deadline = Date.now() + PER_VIDEO_TIMEOUT_MS;
  let lastStatus = "IN_QUEUE";
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    let statusJson: FalQueueStatusResponse;
    try {
      const statusRes = await fetchWithTimeout(
        statusUrl,
        { headers: { Authorization: `Key ${falKey}` } },
        POLL_REQUEST_TIMEOUT_MS,
      );
      if (!statusRes.ok) {
        // Transient 5xx — log and keep polling.
        console.warn(
          "fal.ai Kling status poll non-OK:",
          statusRes.status,
          statusRes.statusText,
        );
        continue;
      }
      statusJson = (await statusRes.json()) as FalQueueStatusResponse;
    } catch (err: any) {
      console.warn(
        "fal.ai Kling status poll threw (will retry):",
        err?.message || err,
      );
      continue;
    }

    const status = statusJson.status || "UNKNOWN";
    if (status !== lastStatus) {
      console.log(`fal.ai Kling: status → ${status}`);
      lastStatus = status;
    }

    if (status === "COMPLETED") {
      // 3. Fetch the result.
      try {
        const resultRes = await fetchWithTimeout(
          responseUrl,
          { headers: { Authorization: `Key ${falKey}` } },
          POLL_REQUEST_TIMEOUT_MS,
        );
        if (!resultRes.ok) {
          const text = await resultRes.text().catch(() => "");
          console.error(
            "fal.ai Kling result fetch failed:",
            resultRes.status,
            text.slice(0, 400),
          );
          return null;
        }
        const data = (await resultRes.json()) as FalVideoResult;
        const url = data.video?.url || null;
        if (!url) {
          console.error(
            "fal.ai Kling COMPLETED but no video.url in payload:",
            JSON.stringify(data).slice(0, 400),
          );
        }
        return url;
      } catch (err: any) {
        console.error(
          "fal.ai Kling result fetch threw:",
          err?.message || err,
        );
        return null;
      }
    }

    if (status === "FAILED") {
      console.error(
        "fal.ai Kling reported FAILED. Logs:",
        JSON.stringify(statusJson.logs || []).slice(0, 600),
      );
      return null;
    }
  }

  console.error(
    `fal.ai Kling timed out after ${PER_VIDEO_TIMEOUT_MS}ms (last status: ${lastStatus})`,
  );
  return null;
}

/**
 * Scans all files for FAL_VIDEO[description] markers, generates real
 * videos via fal Kling text-to-video, and substitutes the resulting MP4
 * URLs. Markers that fail to resolve are left as a visible placeholder
 * poster so the failure is obvious in Sandpack.
 */
export async function replaceVideoPlaceholders(
  files: Record<string, string>,
  falKey: string,
): Promise<Record<string, string>> {
  if (!falKey) return files;

  const placeholders = new Map<string, string>();
  for (const content of Object.values(files)) {
    const regex = new RegExp(VIDEO_PLACEHOLDER_REGEX.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      placeholders.set(match[0], match[1]);
      if (placeholders.size >= MAX_VIDEOS_PER_TURN) break;
    }
    if (placeholders.size >= MAX_VIDEOS_PER_TURN) break;
  }

  if (placeholders.size === 0) return files;

  console.log(
    `Generating ${placeholders.size} video(s) via fal Kling text-to-video...`,
  );

  const videoResults = new Map<string, string>();
  const entries = Array.from(placeholders.entries());

  try {
    const globalTimeout = new Promise<void>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Global video generation timeout (${GLOBAL_VIDEO_TIMEOUT_MS}ms)`,
            ),
          ),
        GLOBAL_VIDEO_TIMEOUT_MS,
      ),
    );

    const work = Promise.allSettled(
      entries.map(async ([marker, description]) => {
        const url = await generateKlingVideo(falKey, description);
        if (url) videoResults.set(marker, url);
      }),
    );

    await Promise.race([work, globalTimeout]);
  } catch (err) {
    console.error("Video generation timed out or failed:", err);
  }

  const FALLBACK_POSTER =
    "https://placehold.co/1280x720/0a0e14/f59e0b?text=Hero+Video+Pending";

  const updated: Record<string, string> = {};
  for (const [filename, content] of Object.entries(files)) {
    let next = content;
    for (const [marker] of placeholders.entries()) {
      const url = videoResults.get(marker) || FALLBACK_POSTER;
      next = next.replaceAll(marker, url);
    }
    updated[filename] = next;
  }

  console.log(
    `Generated ${videoResults.size}/${placeholders.size} videos successfully`,
  );
  return updated;
}
