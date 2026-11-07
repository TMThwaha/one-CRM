"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn, useToast } from "@/components/ui";
import { ApiError, patch } from "@/lib/api";

/** Completes (or reopens) a task. Works from any list; refreshes server and client data. */
export function TaskCheck({ id, done, title }: { id: string; done: boolean; title: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => patch(`/tasks/${id}`, { status: done ? "open" : "done" }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      router.refresh();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not update the task", "danger"),
  });
  return (
    <button
      role="checkbox"
      aria-checked={done}
      aria-label={`${done ? "Reopen" : "Complete"} task: ${title}`}
      disabled={m.isPending}
      onClick={() => m.mutate()}
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50",
        done ? "border-success bg-success text-white" : "border-border-strong hover:border-accent",
      )}
    >
      {done && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  );
}
