/**
 * Path-alias resolution for the Sandpack preview.
 *
 * WHY THIS EXISTS
 * ---------------
 * The preview runs on Sandpack's static `react-ts` bundler (`sandpack-core`),
 * which does NOT execute `vite.config.ts`. Real-world imported projects use a
 * path alias — `@/…`, `~/…`, or a custom one — that maps to the project's
 * `src/` directory. With no vite/webpack step, that alias never resolves and
 * the preview dies with "module not found". This is the #1 thing that breaks
 * when importing an existing GitHub repo (vs. a builder-generated project,
 * which only ever uses relative imports).
 *
 * THE FIX
 * -------
 * `sandpack-core` DOES honor `compilerOptions.paths` from a `/tsconfig.json`
 * in the files map — but ONLY when `compilerOptions.baseUrl` is also present
 * (without baseUrl, `paths` is silently ignored). It resolves each target
 * rooted at the bundler filesystem root `/`. So we synthesize a tsconfig that
 * maps every alias the project declares to the flattened root, and inject it.
 *
 * IMPORTANT: `prepareFilesForSandpack()` strips the leading `/src/` from every
 * file (Sandpack uses flat paths: `/App.tsx`, `/components/ui/toaster.tsx`).
 * So an alias whose real target is `./src/*` must resolve to `./*` here, and
 * a sub-dir alias `@ui/* -> ./src/components/ui/*` must resolve to
 * `./components/ui/*`. `collectAliases()` performs that translation.
 *
 * This module is pure (no React/DOM) so it can be unit-tested directly —
 * see qa/test-sandpack-alias.mjs.
 */

export interface AliasEntry {
  /** glob key as it appears in tsconfig paths, e.g. "@/*" */
  key: string;
  /** flattened, root-relative target glob, e.g. "./*" or "./components/*" */
  target: string;
}

/**
 * Parse tsconfig/jsconfig JSON that may contain // and block comments and
 * trailing commas. String-aware: a "//" or "/*" inside a JSON string (e.g. a
 * URL) is preserved, only real comments are stripped.
 */
export function parseJsonc(input: string): Record<string, unknown> | null {
  try {
    let out = "";
    let inStr = false;
    let inLine = false;
    let inBlock = false;
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      const n = input[i + 1];
      if (inLine) {
        if (c === "\n") {
          inLine = false;
          out += c;
        }
        continue;
      }
      if (inBlock) {
        if (c === "*" && n === "/") {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (inStr) {
        out += c;
        if (c === "\\") {
          out += n ?? "";
          i++;
        } else if (c === '"') {
          inStr = false;
        }
        continue;
      }
      if (c === '"') {
        inStr = true;
        out += c;
      } else if (c === "/" && n === "/") {
        inLine = true;
        i++;
      } else if (c === "/" && n === "*") {
        inBlock = true;
        i++;
      } else {
        out += c;
      }
    }
    out = out.replace(/,(\s*[}\]])/g, "$1"); // trailing commas
    return JSON.parse(out) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Mirror prepareFilesForSandpack's `/src/` strip so an alias target lands on
// the same flat root the files actually live at.
function flattenTargetPath(p: string): string {
  let t = p.replace(/^\.\//, "").replace(/^\/+/, ""); // drop leading "./" or "/"
  t = t.replace(/^src\/?/, ""); // drop a leading "src/" (or bare "src")
  t = t.replace(/^\/+/, "");
  return t; // e.g. "*" or "components/ui/*"
}

// tsconfig files sandpack-core (and editors) may read, plus the split-config
// variants the modern Vite template ships (tsconfig.app.json holds the paths).
const CONFIG_FILES = [
  "/tsconfig.json",
  "/tsconfig.app.json",
  "/tsconfig.base.json",
  "/jsconfig.json",
];

/**
 * Read every path alias the project declares (across its tsconfig/jsconfig
 * files) and translate each to a flattened, root-relative target. Always
 * includes the two ubiquitous defaults (`@/`, `~/` -> root) so a project that
 * declares its alias only in vite.config.ts still previews.
 */
export function collectAliases(files: Record<string, string>): AliasEntry[] {
  const map = new Map<string, string>(); // key -> flattened target glob

  for (const cfg of CONFIG_FILES) {
    const raw = files[cfg];
    if (!raw) continue;
    const json = parseJsonc(raw);
    const co = (json?.compilerOptions ?? null) as Record<string, unknown> | null;
    if (!co) continue;
    const baseUrl = typeof co.baseUrl === "string" ? co.baseUrl : ".";
    const paths = co.paths as Record<string, unknown> | undefined;
    if (!paths || typeof paths !== "object") continue;

    for (const [key, val] of Object.entries(paths)) {
      const first = Array.isArray(val) ? val[0] : val;
      if (typeof key !== "string" || typeof first !== "string") continue;
      // Effective filesystem target = baseUrl joined with the path value.
      const joined = (
        baseUrl.replace(/^\.\//, "").replace(/\/+$/, "") +
        "/" +
        first.replace(/^\.\//, "")
      ).replace(/\/{2,}/g, "/");
      const flat = flattenTargetPath(joined);
      if (!map.has(key)) map.set(key, "./" + flat);
    }
  }

  for (const k of ["@/*", "~/*"]) {
    if (!map.has(k)) map.set(k, "./*");
  }

  return [...map.entries()].map(([key, target]) => ({ key, target }));
}

/**
 * Build the `/tsconfig.json` to inject into the Sandpack files map.
 * `baseUrl` is MANDATORY — sandpack-core ignores `paths` without it.
 */
export function buildInjectedTsconfig(files: Record<string, string>): string {
  const aliases = collectAliases(files);
  const paths: Record<string, string[]> = {};
  for (const { key, target } of aliases) paths[key] = [target];
  return JSON.stringify(
    { compilerOptions: { baseUrl: ".", paths } },
    null,
    2,
  );
}

/**
 * Resolve an import specifier through the alias table to the flattened root
 * path sandpack-core would land on, or null if it's relative / a bare package.
 * Used by tests to prove every aliased import points at a real file.
 */
export function resolveAliasSpecifier(
  spec: string,
  aliases: AliasEntry[],
): string | null {
  const globs = aliases
    .filter((a) => a.key.endsWith("/*"))
    .sort((a, b) => b.key.length - a.key.length); // longest/most-specific first

  for (const { key, target } of globs) {
    const prefix = key.slice(0, -1); // "@/* " -> "@/"
    if (spec.startsWith(prefix)) {
      const rest = spec.slice(prefix.length);
      const base = target.replace(/\*$/, "").replace(/^\.\//, ""); // "" or "components/"
      return ("/" + base + rest).replace(/\/{2,}/g, "/");
    }
  }
  return null;
}
