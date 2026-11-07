import { api } from "@/server/http/api";
import { mfaBeginSetup, mfaStatus } from "@/server/modules/identity/account.service";

export const GET = api(async ({ ctx }) => mfaStatus(ctx));
/** Starts enrolment; returns the seed and QR code once. */
export const POST = api(async ({ ctx }) => mfaBeginSetup(ctx));
