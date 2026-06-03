"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/dev-auth";
import { WORKER_URL } from "@/lib/constants";

// Builder-local, patched copy of the Pet Concierge embed. Same brain (signed-URL
// ElevenLabs session + all worker/nav/choreography tools + voice) as the shared
// petconcierge.vercel.app/embed.js, plus two additive hooks the docked assistant
// rail needs: it re-emits the transcript ("message" event) and exposes
// PetConcierge.sendText() for type-to-chat. See public/pc-embed.js.
const PET_CONCIERGE_URL = "/pc-embed.js";
const GARY_AGENT_ID = "agent_4101ksg0ad0kf8f8ff7rr2sxqghc";
const GARY_SPRITE = "/pets/juan/spritesheet.webp";
// The embed defaults its signed-URL endpoint + sprite asset-base to the SCRIPT's
// origin. Now that we vendor the script locally (/pc-embed.js → localhost), we
// must pin both back to the Pet Concierge project, exactly as the remote-loaded
// embed resolved them — otherwise the voice session 404s on the Builder origin.
const PC_ORIGIN = "https://petconcierge.vercel.app";

const NAV_MAP: Record<string, string> = {
  home: "/",
  homepage: "/",
  builder: "/",
  "app builder": "/",
  dashboard: "/dashboard",
  projects: "/dashboard",
  "my projects": "/dashboard",
  "my apps": "/dashboard",
  editor: "/editor",
  "code editor": "/editor",
  "app editor": "/editor",
  "sign in": "/sign-in",
  "log in": "/sign-in",
  login: "/sign-in",
  "sign up": "/sign-up",
  register: "/sign-up",
  "create account": "/sign-up",
  // External destinations
  google: "https://google.com",
  search: "https://google.com",
  github: "https://github.com",
  supabase: "https://supabase.com",
  vercel: "https://vercel.com",
  clerk: "https://clerk.com",
  "mission control": "http://localhost:3001",
  localhost: "http://localhost:3015",
  "pet concierge": "https://petconcierge.com",
  docs: "https://nextjs.org/docs",
  documentation: "https://nextjs.org/docs",
};

const ROUTE_LABELS = [
  { match: /^\//, label: "Home" },
  { match: /^\/dashboard/, label: "Dashboard" },
  { match: /^\/editor\//, label: "App Editor" },
  { match: /^\/sign-in/, label: "Sign In" },
  { match: /^\/sign-up/, label: "Sign Up" },
];

/**
 * Injects the Builder's voice/build buddy. The embed now runs HEADLESS — its
 * own floating chrome is hidden by space-mario-buddy.js — and all visible UI
 * (astronaut + transcript + text composer) lives in <BuddyPanel/>. This
 * component only wires the nav/auth globals and loads the two scripts.
 */
export function PetConcierge() {
  const router = useRouter();
  const { getToken } = useAuth();

  useEffect(() => {
    (window as any).__PetConciergeNav = NAV_MAP;
    (window as any).__PetConciergeRoutes = ROUTE_LABELS;
    (window as any).__PetConciergeNavigate = (path: string) => {
      router.push(path);
    };
    // Shim so embed's read_code_view can call the worker as the signed-in user.
    (window as any).__pcAuthToken = async () => {
      try {
        return await getToken();
      } catch {
        return null;
      }
    };

    const script = document.createElement("script");
    script.src = PET_CONCIERGE_URL;
    script.setAttribute("data-token", GARY_AGENT_ID);
    // ── SELF-HOSTED CUTOVER (2026-06-03) ──────────────────────────────────────
    // Route this pet's voice + brain through OUR GPU box (Chatterbox TTS +
    // faster-whisper + OpenRouter + pgvector RAG) over WebRTC, instead of
    // ElevenLabs. The box is gated by an HMAC session token minted at
    // <connect-url>/api/dev-token (staging). INSTANT ROLLBACK: delete these three
    // lines (or set data-backend to "elevenlabs") → the embed resolves the prod
    // broker + ElevenLabs again, exactly as before. data-pet selects which pet
    // config the box serves (currently "jack" — a builder-specific "spacemario"
    // pet on the box is the next layer).
    script.setAttribute("data-backend", "selfhosted");
    script.setAttribute("data-connect-url", "https://d69w2do40jaobq-7860.proxy.runpod.net");
    script.setAttribute("data-pet", "jack");
    script.setAttribute("data-name", "Space Mario");
    script.setAttribute("data-accent", "#a855f7");
    script.setAttribute("data-sprite-src", GARY_SPRITE);
    script.setAttribute("data-endpoint", `${PC_ORIGIN}/api/voice-session`);
    script.setAttribute("data-asset-base", PC_ORIGIN);
    script.setAttribute("data-worker", WORKER_URL);
    script.setAttribute("data-ambient", "true");
    script.setAttribute("data-wander", "true");
    script.setAttribute(
      "data-greeting",
      "Hey, I'm Space Mario — your build buddy. Want to spin up a new app, or dig into the one you're already in?"
    );
    script.async = true;
    document.body.appendChild(script);

    // Premium astronaut body + the rail's hide-legacy/dock glue. Keeps the
    // voice brain + nav + worker tools intact. Reversible: delete this block +
    // /public/space-mario-buddy.js + /public/space-mario/.
    const spaceMario = document.createElement("script");
    spaceMario.src = "/space-mario-buddy.js";
    spaceMario.async = true;
    document.body.appendChild(spaceMario);

    return () => {
      script.remove();
      spaceMario.remove();
    };
  }, [router, getToken]);

  // Headless — all UI is rendered by <BuddyPanel/>.
  return null;
}
