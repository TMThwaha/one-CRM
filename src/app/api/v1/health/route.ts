import { NextResponse } from "next/server";
import { getDatabase } from "@/server/db/client";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    const { db, kind } = await getDatabase();
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", database: kind });
  } catch (e) {
    console.error("[health] database check failed", e);
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
