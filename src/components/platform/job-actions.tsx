"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, useToast } from "@/components/ui";
import { ApiError, post } from "@/lib/api";

/** Retry a dead job, or cancel one that has not started. */
export function JobActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const act = async (what: "retry" | "cancel") => {
    setBusy(true);
    try {
      await post(`/platform/jobs/${id}/${what}`);
      toast(what === "retry" ? "Job queued again" : "Job cancelled", "success");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not update the job", "danger");
    } finally {
      setBusy(false);
    }
  };
  if (status === "dead") return <Button size="sm" loading={busy} onClick={() => act("retry")}>Retry</Button>;
  if (status === "queued") return <Button size="sm" variant="ghost" loading={busy} onClick={() => act("cancel")}>Cancel</Button>;
  return null;
}
