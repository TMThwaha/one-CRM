import { accountApi } from "@/server/http/api";
import { mfaBeginSetup, mfaStatus } from "@/server/modules/identity/account.service";

export const GET = accountApi(async ({ ctx }) => mfaStatus(ctx));
/** Starts enrolment; returns the seed and QR code once. */
export const POST = accountApi(async ({ ctx }) => mfaBeginSetup(ctx));
