import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import logger from '../config/logger.js';

let transporter;

const getTransporter = () => {
  if (transporter) return transporter;
  if (!env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
  });
  return transporter;
};

export const sendMail = async ({ to, subject, text, html }) => {
  const client = getTransporter();
  if (!client) {
    logger.info({ to, subject }, 'SMTP is not configured; email delivery skipped');
    return { skipped: true };
  }
  return client.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
};

