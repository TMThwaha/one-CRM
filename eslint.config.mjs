import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Tenant data must only be reached through withTenant(). The owning (RLS-bypassing)
  // connection is confined to the identity module, the platform-admin module (Super Admin: it works
  // ABOVE every tenant by design and is reachable only through the platform resolver), the db layer,
  // and the health check.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/server/modules/identity/**",
      "src/server/modules/platform-admin/**",
      "src/server/dev/**", // development-only seed; refuses to run in production
      "src/server/db/**",
      "src/server/platform/rate-limit.ts",
      "src/app/api/v1/health/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/server/db/client",
              importNames: ["getDatabase"],
              message: "Use withTenant() from @/server/db/tenant. The owning connection bypasses row-level security.",
            },
          ],
        },
      ],
    },
  },
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
