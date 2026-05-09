import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../config.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.SMTP_ENABLED || !config.SMTP_HOST || !config.ALERT_EMAIL) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      },
    });
  }

  return transporter;
}

/** Drop the cached transporter so the next send recreates it from current config. */
export function resetEmailTransporter(): void {
  if (transporter) {
    try { transporter.close(); } catch { /* ignore */ }
  }
  transporter = null;
}

export interface SmtpStatus {
  enabled: boolean;
  host: string;
  port: number;
  from: string;
  alertEmail: string;
}

export function getSmtpStatus(): SmtpStatus {
  return {
    enabled: config.SMTP_ENABLED,
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    from: config.SMTP_FROM,
    alertEmail: config.ALERT_EMAIL,
  };
}

export async function sendTestEmail(): Promise<{ success: boolean; message: string }> {
  if (!config.SMTP_ENABLED) {
    return { success: false, message: 'SMTP désactivé (SMTP_ENABLED=false)' };
  }
  if (!config.SMTP_HOST) {
    return { success: false, message: 'SMTP_HOST non configuré' };
  }
  if (!config.ALERT_EMAIL) {
    return { success: false, message: 'ALERT_EMAIL non configuré' };
  }

  const transport = getTransporter();
  if (!transport) {
    return { success: false, message: 'Impossible de créer le transport SMTP' };
  }

  const now = new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  try {
    await transport.sendMail({
      from: `"${config.SMTP_FROM_NAME}" <${config.SMTP_FROM}>`,
      to: config.ALERT_EMAIL,
      subject: '✅ Sentinel — Test SMTP réussi',
      text: `Ceci est un email de test envoyé par Sentinel.\n\nDate : ${now}\nDestinataire : ${config.ALERT_EMAIL}\nServeur SMTP : ${config.SMTP_HOST}:${config.SMTP_PORT}\n\nSi vous recevez cet email, la configuration SMTP est correcte.\n\n— Sentinel`,
      html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #10b981; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
    <h1 style="margin: 0; font-size: 20px;">✅ Test SMTP réussi</h1>
    <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">${now}</p>
  </div>
  <div style="background: #1e1e2e; color: #cdd6f4; padding: 24px; border-radius: 0 0 12px 12px;">
    <p style="margin: 0 0 16px; font-size: 14px;">Ceci est un email de test envoyé par Sentinel.</p>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr>
        <td style="padding: 8px 0; color: #6c7086;">Destinataire</td>
        <td style="padding: 8px 0; text-align: right;">${config.ALERT_EMAIL}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6c7086;">Serveur SMTP</td>
        <td style="padding: 8px 0; text-align: right; font-family: monospace;">${config.SMTP_HOST}:${config.SMTP_PORT}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6c7086;">Expéditeur</td>
        <td style="padding: 8px 0; text-align: right;">${config.SMTP_FROM}</td>
      </tr>
    </table>
    <div style="margin-top: 16px; padding: 16px; background: #181825; border-radius: 8px; border-left: 3px solid #10b981;">
      <p style="margin: 0; font-size: 13px; color: #a6e3a1;">Si vous recevez cet email, la configuration SMTP est correcte.</p>
    </div>
    <p style="margin: 20px 0 0; font-size: 12px; color: #6c7086;">— Sentinel Backup Manager</p>
  </div>
</div>`,
    });
    return { success: true, message: `Email de test envoyé à ${config.ALERT_EMAIL}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Erreur SMTP : ${msg}` };
  }
}

interface BackupAlertData {
  projectName: string;
  backupType: string;
  status: 'failed' | 'partial';
  timestamp: Date;
  duration: number;
  errors: string[];
}

export async function sendBackupAlert(data: BackupAlertData): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;

  const isFailed = data.status === 'failed';
  const statusLabel = isFailed ? 'ÉCHOUÉ' : 'PARTIEL';
  const statusEmoji = isFailed ? '🔴' : '🟠';
  const durationSec = Math.round(data.duration / 1000);
  const dateStr = data.timestamp.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const errorList = data.errors.length > 0
    ? data.errors.map((e) => `• ${e}`).join('\n')
    : '(aucun détail disponible)';

  const subject = `${statusEmoji} Sentinel — Backup ${statusLabel} : ${data.projectName}`;

  const text = `Backup ${statusLabel} pour ${data.projectName}

Projet : ${data.projectName}
Type : ${data.backupType}
Statut : ${statusLabel}
Date : ${dateStr}
Durée : ${durationSec}s

Erreurs :
${errorList}

— Sentinel`;

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: ${isFailed ? '#dc2626' : '#f59e0b'}; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
    <h1 style="margin: 0; font-size: 20px;">${statusEmoji} Backup ${statusLabel}</h1>
    <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">${data.projectName} — ${dateStr}</p>
  </div>
  <div style="background: #1e1e2e; color: #cdd6f4; padding: 24px; border-radius: 0 0 12px 12px;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr>
        <td style="padding: 8px 0; color: #6c7086;">Projet</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 600;">${data.projectName}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6c7086;">Type</td>
        <td style="padding: 8px 0; text-align: right;">${data.backupType}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6c7086;">Durée</td>
        <td style="padding: 8px 0; text-align: right;">${durationSec}s</td>
      </tr>
    </table>
    <div style="margin-top: 16px; padding: 16px; background: #181825; border-radius: 8px; border-left: 3px solid ${isFailed ? '#dc2626' : '#f59e0b'};">
      <p style="margin: 0 0 8px; font-size: 13px; color: #6c7086; text-transform: uppercase; letter-spacing: 0.5px;">Erreurs</p>
      <pre style="margin: 0; font-size: 13px; white-space: pre-wrap; color: #f38ba8;">${data.errors.map((e) => `• ${e}`).join('\n') || '(aucun détail)'}</pre>
    </div>
    <p style="margin: 20px 0 0; font-size: 12px; color: #6c7086;">— Sentinel Backup Manager</p>
  </div>
</div>`;

  try {
    await transport.sendMail({
      from: `"${config.SMTP_FROM_NAME}" <${config.SMTP_FROM}>`,
      to: config.ALERT_EMAIL,
      subject,
      text,
      html,
    });
  } catch (err) {
    console.error('[email] Failed to send alert:', err instanceof Error ? err.message : err);
  }
}
