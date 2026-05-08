import nodemailer from "nodemailer";

export type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: "smtp_not_configured"; previewLink: string };

/**
 * Send an email via SMTP. When SMTP env vars aren't set, returns
 * sent=false with a previewLink so the caller can surface the link in the
 * UI for manual sharing — preserves the single-admin happy path.
 *
 * Required env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
export async function sendEmail(
  payload: EmailPayload,
  previewLink: string,
): Promise<EmailResult> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    return { sent: false, reason: "smtp_not_configured", previewLink };
  }
  const t = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  const info = await t.sendMail({
    from: process.env.SMTP_FROM || "no-reply@jilljill.in",
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return { sent: true, messageId: info.messageId };
}
