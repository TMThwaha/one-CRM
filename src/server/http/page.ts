import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "@/server/platform/errors";

/** Runs a page loader; a missing or unauthorized record renders the 404 page (no existence leak). */
export async function orNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AppError && (e.code === "not_found" || e.code === "forbidden" || e.code === "validation_failed")) notFound();
    throw e;
  }
}
