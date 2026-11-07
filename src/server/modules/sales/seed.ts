import "server-only";
import { pipelineStages, pipelines } from "@/server/db/schema";
import type { Database } from "@/server/db/client";

type Executor = Pick<Database, "insert">;

export const DEFAULT_STAGES = [
  { name: "Qualification", probability: 10, kind: "open" },
  { name: "Discovery", probability: 25, kind: "open" },
  { name: "Proposal", probability: 50, kind: "open" },
  { name: "Negotiation", probability: 75, kind: "open" },
  { name: "Won", probability: 100, kind: "won" },
  { name: "Lost", probability: 0, kind: "lost" },
] as const;

/** Every new organization starts with one sensible, fully editable sales pipeline. */
export async function seedDefaultPipeline(tx: Executor, organizationId: string) {
  const [pipeline] = await tx
    .insert(pipelines)
    .values({ organizationId, name: "Sales pipeline", isDefault: true })
    .returning({ id: pipelines.id });
  await tx.insert(pipelineStages).values(
    DEFAULT_STAGES.map((s, i) => ({
      organizationId,
      pipelineId: pipeline.id,
      name: s.name,
      position: i,
      probability: s.probability,
      kind: s.kind,
    })),
  );
  return pipeline.id;
}
