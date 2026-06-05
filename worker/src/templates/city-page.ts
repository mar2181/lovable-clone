// ─────────────────────────────────────────────────────────────────────────────
// Local-SEO city/service landing-page generator.
//
// Pure string generator (no imports, no deps): given a service + city + state +
// firm identity, returns the SOURCE of a self-contained React + TypeScript (Vite)
// page component as a string. The caller writes the returned string to a file
// like `/src/pages/seo/{slug}.tsx` and the project's existing Vite build picks it
// up. The component is default-exported, takes no props, and renders:
//   • an SEO H1 "{service} in {city}, {state}"
//   • a 2-3 paragraph localized intro
//   • a services blurb
//   • a prominent tel: call-to-action button
//   • an internal link back to "/" (or a caller-supplied homePath)
//   • a LocalBusiness schema.org JSON-LD block
//
// Everything is inline-styled so the page renders correctly regardless of the
// host project's CSS setup.
// ─────────────────────────────────────────────────────────────────────────────

export interface CityServicePageOptions {
  service: string;
  city: string;
  state: string;
  firmName: string;
  phone: string;
  homePath?: string;
}

// Escape a value for safe embedding inside a JS single-quoted string literal in
// the generated source (the strings we emit are wrapped in single quotes).
function jsString(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, " ")
    .trim();
}

// Escape a value for safe embedding as literal JSX text (between tags).
function jsxText(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .trim();
}

// Strip everything but digits + leading '+' so tel: hrefs dial cleanly.
function telDigits(phone: string): string {
  const trimmed = String(phone ?? "").trim();
  if (!trimmed) return "";
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d]/g, "");
}

// A PascalCase, identifier-safe component name derived from service + city.
function componentName(service: string, city: string): string {
  const raw = `${service} ${city} Page`;
  const camel = raw
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join("");
  const safe = camel.replace(/[^a-zA-Z0-9]/g, "");
  // Component identifiers must start with a letter.
  return /^[A-Za-z]/.test(safe) ? safe : `Seo${safe || "CityPage"}`;
}

export function cityServicePage(opts: CityServicePageOptions): string {
  const service = String(opts?.service ?? "").trim() || "Our Services";
  const city = String(opts?.city ?? "").trim() || "Your City";
  const state = String(opts?.state ?? "").trim();
  const firmName = String(opts?.firmName ?? "").trim() || "Our Firm";
  const phone = String(opts?.phone ?? "").trim();
  const homePath = String(opts?.homePath ?? "/").trim() || "/";

  const cityState = state ? `${city}, ${state}` : city;
  const headline = `${service} in ${cityState}`;
  const tel = telDigits(phone);
  const compName = componentName(service, city);

  // JSON-LD LocalBusiness — built as an object, embedded via JSON.stringify in
  // the generated source so it is always valid JSON in the rendered <script>.
  const schemaObject: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: firmName,
    description: headline,
    areaServed: cityState,
    ...(phone ? { telephone: phone } : {}),
    address: {
      "@type": "PostalAddress",
      addressLocality: city,
      ...(state ? { addressRegion: state } : {}),
    },
  };
  // Embed the schema as a JS object literal (via JSON) so the generated file
  // computes the JSON-LD string at render time — no fragile manual escaping.
  const schemaLiteral = JSON.stringify(schemaObject);

  // The three localized intro paragraphs (emitted as JSX-escaped text).
  const p1 = jsxText(
    `When you need ${service.toLowerCase()} in ${cityState}, ${firmName} is here to help. ` +
      `We proudly serve ${city} and the surrounding communities with dependable, locally focused service you can trust.`,
  );
  const p2 = jsxText(
    `Our team understands the unique needs of ${city} residents and businesses. ` +
      `From your first call to the final result, we treat every ${cityState} client with the attention and care they deserve.`,
  );
  const p3 = jsxText(
    `Looking for ${service.toLowerCase()} near you? Reach out to ${firmName} today and discover why so many people across ${cityState} choose us first.`,
  );
  const servicesBlurb = jsxText(
    `${firmName} delivers ${service.toLowerCase()} backed by years of experience, transparent communication, and a commitment to doing right by every client in ${cityState}.`,
  );

  const ctaLabel = jsxText(phone ? `Call ${phone}` : `Contact ${firmName}`);
  const h1Text = jsxText(headline);
  const firmNameText = jsxText(firmName);
  const servicesHeading = jsxText(`Our ${service} Services in ${city}`);

  // Build the tel button as JSX. When there's no phone, fall back to the home
  // path so the CTA still links somewhere useful.
  const ctaHref = tel ? `tel:${tel}` : jsString(homePath);

  return `import { useEffect } from "react";

// Auto-generated local-SEO landing page for "${jsString(service)}" in ${jsString(cityState)}.
// Generated by the seo-pages route. Safe to edit, but re-running SEO generation
// will overwrite files at this path.

const LOCAL_BUSINESS_SCHEMA = ${schemaLiteral};

export default function ${compName}() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = ${"`"}${jsString(headline)} | ${jsString(firmName)}${"`"};
    return () => {
      document.title = prevTitle;
    };
  }, []);

  return (
    <main
      style={{
        maxWidth: "880px",
        margin: "0 auto",
        padding: "48px 20px 64px",
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#1a1a1a",
        lineHeight: 1.6,
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(LOCAL_BUSINESS_SCHEMA) }}
      />

      <header style={{ marginBottom: "8px" }}>
        <p
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: "13px",
            fontWeight: 600,
            color: "#6b7280",
            margin: 0,
          }}
        >
          ${firmNameText}
        </p>
      </header>

      <h1 style={{ fontSize: "2.25rem", fontWeight: 800, margin: "8px 0 24px", lineHeight: 1.15 }}>
        ${h1Text}
      </h1>

      <section aria-label="Introduction" style={{ fontSize: "1.05rem" }}>
        <p>${p1}</p>
        <p>${p2}</p>
        <p>${p3}</p>
      </section>

      <section
        aria-label="Services"
        style={{
          marginTop: "32px",
          padding: "24px",
          background: "#f8fafc",
          borderRadius: "12px",
          border: "1px solid #e5e7eb",
        }}
      >
        <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginTop: 0, marginBottom: "12px" }}>
          ${servicesHeading}
        </h2>
        <p style={{ margin: 0 }}>${servicesBlurb}</p>
      </section>

      <section
        aria-label="Call to action"
        style={{ marginTop: "40px", textAlign: "center" }}
      >
        <a
          href=${JSON.stringify(ctaHref)}
          style={{
            display: "inline-block",
            background: "#1d4ed8",
            color: "#ffffff",
            fontSize: "1.15rem",
            fontWeight: 700,
            textDecoration: "none",
            padding: "16px 36px",
            borderRadius: "9999px",
            boxShadow: "0 8px 24px rgba(29,78,216,0.25)",
          }}
        >
          ${ctaLabel}
        </a>
      </section>

      <nav style={{ marginTop: "40px", textAlign: "center" }}>
        <a
          href=${JSON.stringify(homePath)}
          style={{ color: "#1d4ed8", fontWeight: 600, textDecoration: "none" }}
        >
          &larr; Back to Home
        </a>
      </nav>
    </main>
  );
}
`;
}
