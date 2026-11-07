import "server-only";
import nodemailer from "nodemailer";
import { getConfig } from "./config";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly kind: "smtp" | "log-only";
  send(email: Email): Promise<void>;
}

/**
 * Without SMTP_URL nothing is delivered. The message is written to the server log (development
 * convenience: copy the link from the console). This is deliberately NOT presented to users as
 * "email sent" anywhere in the UI.
 */
class LogOnlyMailer implements Mailer {
  readonly kind = "log-only" as const;
  async send(email: Email) {
    console.warn(`[mail:not-delivered] no SMTP configured. To: ${email.to} | ${email.subject}\n${email.text}`);
  }
}

class SmtpMailer implements Mailer {
  readonly kind = "smtp" as const;
  private transport = nodemailer.createTransport(getConfig().SMTP_URL!);
  async send(email: Email) {
    await this.transport.sendMail({ from: getConfig().MAIL_FROM, to: email.to, subject: email.subject, text: email.text });
  }
}

let mailer: Mailer | undefined;
export function getMailer(): Mailer {
  mailer ??= getConfig().SMTP_URL ? new SmtpMailer() : new LogOnlyMailer();
  return mailer;
}

/** Test seam. */
export function setMailerForTesting(m: Mailer | undefined) {
  mailer = m;
}

/** Sends without ever failing the caller's business transaction. Returns true only if actually handed to SMTP. */
export async function sendBestEffort(email: Email): Promise<boolean> {
  try {
    await getMailer().send(email);
    return getMailer().kind === "smtp";
  } catch (e) {
    console.error("[mail] delivery failed", e);
    return false;
  }
}
