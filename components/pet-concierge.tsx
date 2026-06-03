"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MoveLeft, MoveRight } from "lucide-react";
import { useAuth } from "@/lib/dev-auth";
import { WORKER_URL } from "@/lib/constants";

const PET_CONCIERGE_URL = "https://petconcierge.vercel.app/embed.js";
const GARY_AGENT_ID = "agent_4101ksg0ad0kf8f8ff7rr2sxqghc";
const GARY_SPRITE = "/pets/juan/spritesheet.webp";

// Which screen corner the build-helper widget sits in. Default is "right";
// the embed itself always paints bottom-right, so "left" is an override.
const SIDE_KEY = "petconcierge.side";

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

export function PetConcierge() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [side, setSide] = useState<"left" | "right">("right");
  // True once the embed has built its .pc-overlay element in the DOM.
  const [widgetReady, setWidgetReady] = useState(false);

  // Restore the saved side before the widget appears
  useEffect(() => {
    try {
      if (localStorage.getItem(SIDE_KEY) === "left") setSide("left");
    } catch {}
  }, []);

  // Load the external build-helper embed
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
    script.setAttribute("data-name", "Gary");
    script.setAttribute("data-accent", "#a855f7");
    script.setAttribute("data-sprite-src", GARY_SPRITE);
    script.setAttribute("data-worker", WORKER_URL);
    script.setAttribute("data-ambient", "true");
    script.setAttribute("data-wander", "true");
    script.setAttribute(
      "data-greeting",
      "Hi! I'm Gary, your build buddy. Want to spin up a new app, or shall we dig into the one you're already in?"
    );
    script.async = true;
    document.body.appendChild(script);

    // Swap Gary's chibi body for the premium Space Mario astronaut. Keeps the
    // voice brain + nav + worker tools intact; hides embed.js's .pc-sprite and
    // mounts the frame-sequence engine, bridging body tools into clientTools.
    // Reversible: delete this block + /public/space-mario-buddy.js + /public/space-mario/.
    const spaceMario = document.createElement("script");
    spaceMario.src = "/space-mario-buddy.js";
    spaceMario.async = true;
    document.body.appendChild(spaceMario);

    return () => {
      script.remove();
      spaceMario.remove();
    };
  }, [router, getToken]);

  // Inject the left-side override once. The embed positions .pc-overlay with
  // an inline `right` offset; an !important rule wins over that inline style.
  useEffect(() => {
    const STYLE_ID = "pc-side-override";
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .pc-overlay.pc-side-left {
        right: auto !important;
        left: 24px !important;
        align-items: flex-start !important;
      }
      .pc-overlay.pc-side-left .pc-bubble::after { right: auto; left: 18px; }
    `;
    document.head.appendChild(style);
  }, []);

  // The embed builds .pc-overlay asynchronously. Poll for it, then keep its
  // side class in sync with `side`.
  useEffect(() => {
    let cancelled = false;

    const apply = () => {
      const overlay = document.querySelector(".pc-overlay");
      if (!overlay) return false;
      overlay.classList.toggle("pc-side-left", side === "left");
      if (!cancelled) setWidgetReady(true);
      return true;
    };

    if (apply()) return;
    const iv = setInterval(() => {
      if (apply()) clearInterval(iv);
    }, 300);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [side]);

  const toggleSide = useCallback(() => {
    setSide((prev) => {
      const next = prev === "right" ? "left" : "right";
      try {
        localStorage.setItem(SIDE_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  if (!widgetReady) return null;

  return (
    <button
      type="button"
      onClick={toggleSide}
      aria-label={side === "right" ? "Move concierge to the left side" : "Move concierge to the right side"}
      title={side === "right" ? "Move concierge to the left side" : "Move concierge to the right side"}
      style={{
        position: "fixed",
        bottom: 40,
        [side === "right" ? "right" : "left"]: 122,
        zIndex: 2147483601,
      }}
      className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-900/90 border border-white/15 text-zinc-400 shadow-lg backdrop-blur-sm opacity-60 transition-all hover:opacity-100 hover:text-white hover:border-sky-500/60 hover:bg-sky-500/20"
    >
      {side === "right" ? <MoveLeft className="w-4 h-4" /> : <MoveRight className="w-4 h-4" />}
    </button>
  );
}
