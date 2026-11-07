import { api } from "@/server/http/api";
import { deleteContact, getContact, updateContact } from "@/server/modules/crm/contacts.service";

export const GET = api(({ ctx, params }) => getContact(ctx, params.id));
export const PATCH = api(async ({ ctx, params, body }) => updateContact(ctx, params.id, await body()));
export const DELETE = api(async ({ ctx, params }) => { await deleteContact(ctx, params.id); });
