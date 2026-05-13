import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Guardrail: dev-auth must remain the single import point for Clerk symbols
// across the frontend. If anyone imports `@clerk/nextjs` directly from a
// regular component, the dev-bypass shim is silently skipped and localhost
// dev breaks with 401s on /api/* (see lib/dev-auth.tsx). Only the dev-auth
// shim itself, the dedicated sign-in/sign-up pages (which need the real
// hosted Clerk widget), and the edge middleware are allowed to import it.
const noDirectClerkImport = {
  files: ["**/*.ts", "**/*.tsx"],
  ignores: [
    "lib/dev-auth.tsx",
    "app/sign-in/**",
    "app/sign-up/**",
    "middleware.ts",
    "proxy.ts",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@clerk/nextjs",
            message:
              "Import Clerk symbols from '@/lib/dev-auth' instead, so the dev-bypass shim stays consistent across the app.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  noDirectClerkImport,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
