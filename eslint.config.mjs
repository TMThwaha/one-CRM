import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Tenant data must only be reached through withTenant(). The owning (RLS-bypassing)
  // connection is confined to the identity module, the db layer, and the health check.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/server/modules/identity/**",
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
