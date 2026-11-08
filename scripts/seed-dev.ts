/**
 * DEVELOPMENT ONLY: creates the dummy "Nexora Technologies" company and its Company Admin.
 *
 *   SEED_ADMIN_PASSWORD='<password>' npm run seed:dev
 *
 * Idempotent, refuses to run in production, and the password is supplied at run time: it is never
 * stored in this repository. STOP the dev server first when using the embedded database (PGlite is
 * single-process; two processes on one data directory can corrupt it).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true);

async function main() {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    console.error("Set SEED_ADMIN_PASSWORD (at least 10 characters). It is never read from, or written to, source control.");
    process.exit(1);
  }
  const { seedDevCompany, NEXORA } = await import("@/server/dev/seed-dev-company");
  const { getDatabase } = await import("@/server/db/client");
  try {
    const r = await seedDevCompany({ company: NEXORA, password });
    console.log(JSON.stringify(r, null, 2));
    console.log(
      r.company.created || r.admin.userCreated || r.admin.membershipCreated
        ? "\nSeed applied."
        : "\nAlready seeded: nothing changed (existing records and passwords were left alone).",
    );
  } finally {
    await (await getDatabase()).close();
  }
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
