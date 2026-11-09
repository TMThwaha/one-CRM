import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/server/platform/config";

export const dynamic = "force-dynamic";

const digest = (v: string) => createHash("sha256").update(v).digest();

/**
 * For hosts that cannot keep a worker process alive (serverless): a scheduler calls this with
 * `Authorization: Bearer $CRON_SECRET` and the queue is drained for up to 20 seconds. With no CRON_SECRET
 * configured the endpoint does not exist (404). GET is accepted because most cron services only issue GET.
 */
async function handle(req: NextRequest) {
  const secret = getConfig().CRON_SECRET;
  if (!secret) return new NextResponse(null, { status: 404 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!timingSafeEqual(digest(given), digest(secret))) return new NextResponse(null, { status: 401 });
  const { drain } = await import("@/server/jobs/worker");
  const result = await drain({ maxMs: 20_000 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
