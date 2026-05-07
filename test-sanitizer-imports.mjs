// Reproduces the two crash classes the user hit on project IB_y3p01aA:
//   1) Services.tsx references `Home` icon but doesn't import it.
//   2) Contact.tsx + Footer.tsx import { PHONE } from constants, which
//      doesn't export PHONE.
// Run with: node --experimental-strip-types test-sanitizer-imports.mjs

import { sanitizeGeneratedCode } from "./worker/src/ai/code-sanitizer.ts";

const input = {
  "/src/components/Services.tsx": `
import { Sun, Building2, PaintBucket } from 'lucide-react';

const services = [
  { icon: Home, title: 'Residential' },
  { icon: Sun, title: 'Outdoor' },
  { icon: Building2, title: 'Commercial' },
  { icon: PaintBucket, title: 'Custom' },
];

export default function Services() {
  return (
    <section>
      {services.map((s) => (
        <div key={s.title}>
          <s.icon />
          <span>{s.title}</span>
        </div>
      ))}
    </section>
  );
}
`,
  "/src/components/Contact.tsx": `
import { Phone, Mail, MapPin } from 'lucide-react';
import { PHONE, PHONE_HREF, EMAIL, ADDRESS, HOURS } from '../lib/constants';

export default function Contact() {
  return (
    <section>
      <a href={PHONE_HREF}><Phone /> {PHONE}</a>
      <a href={\`mailto:\${EMAIL}\`}><Mail /> {EMAIL}</a>
      <p><MapPin /> {ADDRESS}</p>
      <p>{HOURS}</p>
    </section>
  );
}
`,
  "/src/components/Footer.tsx": `
import { COMPANY_NAME, PHONE, PHONE_HREF, EMAIL, ADDRESS } from '../lib/constants';

export default function Footer() {
  return (
    <footer>
      <h3>{COMPANY_NAME}</h3>
      <a href={PHONE_HREF}>{PHONE}</a>
      <a>{EMAIL}</a>
      <p>{ADDRESS}</p>
    </footer>
  );
}
`,
  "/src/lib/constants.ts": `
export const COMPANY_NAME = 'Acme Painting';
export const PHONE_HREF = 'tel:+19565550199';
export const EMAIL = 'hello@acme.com';
export const ADDRESS = '123 Main St, McAllen TX';
export const HOURS = 'Mon–Fri 8am–6pm';
`,
};

const out2 = sanitizeGeneratedCode(input);

let failures = 0;
const assert = (label, cond, detail = "") => {
  if (cond) {
    console.log("PASS  " + label);
  } else {
    console.log("FAIL  " + label + (detail ? "\n      " + detail : ""));
    failures++;
  }
};

const services = out2["/src/components/Services.tsx"];
assert(
  "Services.tsx — Home is now imported from lucide-react",
  /import\s*\{[^}]*\bHome\b[^}]*\}\s*from\s*['"]lucide-react['"]/.test(services),
  services.split("\n").slice(0, 4).join("\n"),
);
assert(
  "Services.tsx — original safe icons still present",
  /\bSun\b/.test(services) && /\bBuilding2\b/.test(services) && /\bPaintBucket\b/.test(services),
);

const constants = out2["/src/lib/constants.ts"];
assert(
  "constants.ts — PHONE auto-stubbed",
  /export\s+const\s+PHONE\s*=/.test(constants),
);
assert(
  "constants.ts — original COMPANY_NAME preserved",
  /export\s+const\s+COMPANY_NAME\s*=\s*'Acme Painting'/.test(constants),
);
assert(
  "constants.ts — does NOT re-stub already-exported EMAIL",
  (constants.match(/export\s+const\s+EMAIL\s*=/g) || []).length === 1,
);

const contact = out2["/src/components/Contact.tsx"];
assert(
  "Contact.tsx — import line for ../lib/constants is unchanged (still imports PHONE)",
  /import\s*\{[^}]*\bPHONE\b[^}]*\}\s*from\s*['"]\.\.\/lib\/constants['"]/.test(contact),
);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll sanitizer fixes verified.");
