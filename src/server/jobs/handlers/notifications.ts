import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { PermanentJobError } from "../queue";
import { defineEventHandler } from "../events";

/**
 * task.assigned -> an in-app notification for the new assignee.
 * Idempotent: (event, person) is unique, so a redelivered event cannot notify twice.
 */
defineEventHandler({
  name: "notifications.task_assigned",
  types: ["task.assigned"],
  handle: async (event) => {
    const assigneeId = typeof event.payload.assigneeId === "string" ? event.payload.assigneeId : null;
    if (!assigneeId) throw new PermanentJobError("task.assigned event without an assignee");
    const title = typeof event.payload.title === "string" ? event.payload.title : "a task";
    const { db } = await getDatabase();
    const actor = event.actorUserId
      ? ((await db.execute(sql`select name from users where id = ${event.actorUserId}`)) as unknown as { rows: { name: string }[] }).rows[0]?.name
      : null;
    // The composite foreign key only allows notifying a member of the event's own company; if the person
    // has since left, there is simply nobody to tell.
    await db.execute(sql`
      insert into notifications (organization_id, user_id, type, title, body, link, entity_type, entity_id, event_id)
      select ${event.organizationId}, m.user_id, 'task.assigned', ${`${actor ?? "Someone"} assigned you a task`}, ${title}, '/tasks', 'task', ${event.entityId}, ${event.id}
      from organization_members m
      where m.organization_id = ${event.organizationId} and m.user_id = ${assigneeId} and m.status = 'active'
      on conflict (event_id, user_id) where event_id is not null do nothing`);
  },
});
