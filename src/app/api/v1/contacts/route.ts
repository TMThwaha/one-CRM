import { api } from "@/server/http/api";
import { createContact, listContacts } from "@/server/modules/crm/contacts.service";

export const GET = api(({ ctx, query }) => listContacts(ctx, query));
export const POST = api(async ({ ctx, body }) => createContact(ctx, (await body()) as never), { status: 201 });
