import { z } from "zod";
import { api } from "@/server/http/api";
import { deleteRole, updateRole } from "@/server/modules/identity/roles.service";

const id = (p: Record<string, string>) => z.string().uuid().parse(p.id);

export const PATCH = api(async ({ ctx, params, body }) => updateRole(ctx, id(params), await body()));
export const DELETE = api(async ({ ctx, params }) => deleteRole(ctx, id(params)));
