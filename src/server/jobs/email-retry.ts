import "server-only";
import { getDatabase } from "@/server/db/client";
import { decryptSecret, encryptSecret } from "@/server/platform/secrets";
import { defineJob, enqueue } from "./queue";

/**
 * Email delivery that survives an SMTP outage. The first attempt happens inline (so callers still learn
 * immediately whether it worked); if the provider fails, the message is queued and retried with backoff.
 *
 * The body usually contains a one-time link (password reset, invitation), i.e. something that grants
 * access. So it is stored ENCRYPTED, and the whole payload is wiped as soon as the job finishes.
 */
interface EmailPayload {
  to: string;
  subject: string;
  textEnc: string;
}

export async function queueEmailRetry(email: { to: string; subject: string; text: string }): Promise<void> {
  const { db } = await getDatabase();
  await enqueue(db, "email.send", { to: email.to, subject: email.subject, textEnc: encryptSecret(email.text) });
}

defineJob<EmailPayload>({
  kind: "email.send",
  maxAttempts: 8, // spans roughly a day with the backoff schedule
  timeoutMs: 30_000,
  scrubPayload: true,
  handler: async ({ to, subject, textEnc }) => {
    const { getMailer } = await import("@/server/platform/mailer"); // lazy: mailer imports this module
    await getMailer().send({ to, subject, text: decryptSecret(textEnc) });
    return { delivered: true };
  },
});
