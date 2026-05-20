"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const PET_CONCIERGE_URL = "https://petconcierge.vercel.app/embed.js";

const NAV_MAP: Record<string, string> = {
  home: "/",
  dashboard: "/dashboard",
  projects: "/dashboard",
  "my projects": "/dashboard",
  editor: "/editor",
  "sign in": "/sign-in",
  "sign up": "/sign-up",
  "app builder": "/",
  builder: "/",
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

  useEffect(() => {
    (window as any).__PetConciergeNav = NAV_MAP;
    (window as any).__PetConciergeRoutes = ROUTE_LABELS;
    (window as any).__PetConciergeNavigate = (path: string) => {
      router.push(path);
    };

    const script = document.createElement("script");
    script.src = PET_CONCIERGE_URL;
    script.setAttribute("data-token", "lovable-clone");
    script.setAttribute("data-name", "Concierge");
    script.setAttribute("data-accent", "#a855f7");
    script.setAttribute("data-glyph", "🤖");
    script.setAttribute("data-sprite-src", "none");
    script.setAttribute(
      "data-greeting",
      "Hi! I'm your AI App Builder concierge. Ask me anything about building apps here."
    );
    script.async = true;
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, [router]);

  return null;
}
