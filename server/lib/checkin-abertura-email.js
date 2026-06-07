import { Resend } from 'resend';
import { formatDataPtBr, escalaDataToYMD } from './brasilia.js';
import { buildCheckinPublicUrl } from './checkin-public-url.js';
import { generateCheckinQrEmailBuffer, CHECKIN_QR_EMAIL_CID } from './checkin-qrcode.js';
import { pgListVoluntarios } from '../db/postgres/operational-data.js';
import { pgFindIgrejaById } from '../db/postgres/repos.js';
import {
  pgListEventosCheckinAberturaEmailPendentes,
  pgTryClaimEventoAberturaEmail,
} from '../db/postgres/escalas-checkin.js';

function horarioCheckinLabel(evento) {
  const hin = (evento.horarioInicio || '').trim();
  const hfi = (evento.horarioFim || '').trim();
  if (!hin && !hfi) return 'disponível o dia todo (horário de Brasília)';
  if (hin && hfi) return `das ${hin} às ${hfi} (horário de Brasília)`;
  if (hin) return `a partir das ${hin} (horário de Brasília)`;
  return `até ${hfi} (horário de Brasília)`;
}

export function buildCheckinAberturaEmailHtml({
  nome,
  eventoLabel,
  eventoDataLabel,
  horarioTexto,
  checkinUrl,
  igrejaNome,
}) {
  const n = (nome || '').trim() || 'voluntário(a)';
  const titulo = (eventoLabel || 'Check-in de presença').trim();
  const ig = (igrejaNome || 'Celeiro São Paulo').trim();
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Check-in aberto</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
  <tr><td style="background:#1a1a2e;padding:28px 36px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#f59e0b;text-transform:uppercase;letter-spacing:.08em;font-weight:600;">${ig}</p>
    <h1 style="margin:8px 0 0;font-size:22px;color:#fff;font-weight:700;">Check-in aberto</h1>
  </td></tr>
  <tr><td style="padding:36px;">
    <p style="margin:0 0 14px;font-size:16px;color:#374151;line-height:1.6;">Olá, <strong>${n}</strong>!</p>
    <p style="margin:0 0 14px;font-size:16px;color:#374151;line-height:1.6;">O check-in de presença está aberto para <strong>${titulo}</strong>${eventoDataLabel ? ` (${eventoDataLabel})` : ''}.</p>
    <p style="margin:0 0 20px;font-size:15px;color:#6b7280;line-height:1.5;">Janela: ${horarioTexto}.</p>
    <p style="margin:0 0 16px;text-align:center;">
      <a href="${checkinUrl}" style="display:inline-block;background:#f59e0b;color:#1a1a2e;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Fazer check-in agora</a>
    </p>
    <p style="margin:0 0 8px;text-align:center;font-size:13px;color:#9ca3af;">Ou escaneie o QR code:</p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:0 0 20px;">
      <img src="cid:${CHECKIN_QR_EMAIL_CID}" width="280" height="280" alt="QR code check-in"
        style="display:block;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;padding:8px;background:#fff;max-width:280px;height:auto;">
    </td></tr></table>
    <p style="margin:0;font-size:13px;color:#9ca3af;word-break:break-all;text-align:center;">${checkinUrl}</p>
  </td></tr>
  <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 36px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">Equipe de Voluntários · ${ig}</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

/**
 * Envia email de abertura de check-in para voluntários da igreja.
 * @returns {{ sent: number, failed: number, total: number, skipped?: boolean }}
 */
export async function sendCheckinAberturaEmailsForEvento(evento, opts = {}) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_resend' };

  const igreja = await pgFindIgrejaById(evento.igrejaId);
  const appBase = (opts.appBase || process.env.APP_URL || 'https://voluntariosceleirosp.com').replace(/\/$/, '');
  const checkinUrl = buildCheckinPublicUrl({
    appBase,
    eventoId: evento._id,
    igrejaSlug: igreja?.slug || 'celeiro-sp',
  });
  const ymd = escalaDataToYMD(evento.data);
  const eventoDataLabel = ymd ? formatDataPtBr(ymd) : '';
  const eventoLabel = (evento.label || '').trim() || `Culto ${eventoDataLabel}`;
  const qrBuffer = await generateCheckinQrEmailBuffer(checkinUrl);
  const horarioTexto = horarioCheckinLabel(evento);

  let ev = evento;
  if (opts.markSent !== false && !opts.alreadyClaimed) {
    const claimed = await pgTryClaimEventoAberturaEmail(evento._id, evento.igrejaId);
    if (!claimed) {
      return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'already_sent' };
    }
    ev = claimed;
  }

  const voluntarios = await pgListVoluntarios(ev.igrejaId);
  const byEmail = new Map();
  for (const v of voluntarios) {
    const em = (v.email || '').toLowerCase().trim();
    if (!em || !em.includes('@') || byEmail.has(em)) continue;
    byEmail.set(em, (v.nome || '').trim());
  }
  const recipients = [...byEmail.entries()];
  if (!recipients.length) {
    return { sent: 0, failed: 0, total: 0, checkinUrl };
  }

  const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
  const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
  const resend = new Resend(apiKey);
  const subject = `Check-in aberto — ${eventoLabel}${eventoDataLabel ? ` (${eventoDataLabel})` : ''}`;

  let sent = 0;
  let failed = 0;
  for (const [email, nome] of recipients) {
    try {
      const { error } = await resend.emails.send({
        from,
        to: email,
        reply_to: replyTo,
        subject,
        html: buildCheckinAberturaEmailHtml({
          nome,
          eventoLabel,
          eventoDataLabel,
          horarioTexto,
          checkinUrl,
          igrejaNome: igreja?.nome,
        }),
        attachments: [{
          filename: 'checkin-qrcode.png',
          content: qrBuffer,
          contentType: 'image/png',
          contentId: CHECKIN_QR_EMAIL_CID,
        }],
      });
      if (error) {
        failed += 1;
        console.warn(`checkin abertura email ${email}:`, error.message || error);
      } else {
        sent += 1;
      }
    } catch (e) {
      failed += 1;
      console.warn(`checkin abertura email ${email}:`, e?.message || e);
    }
    if (recipients.length > 1) {
      await new Promise((r) => setTimeout(r, Number(process.env.EMAIL_SEND_DELAY_MS) || 450));
    }
  }

  return { sent, failed, total: recipients.length, checkinUrl };
}

/** Job periódico: dispara emails quando a janela de check-in abre. */
export async function runCheckinAberturaEmailJob() {
  if ((process.env.CHECKIN_ABERTURA_EMAIL || 'true').toLowerCase() === 'false') {
    return { skipped: true, reason: 'disabled' };
  }
  const eventos = await pgListEventosCheckinAberturaEmailPendentes();
  if (!eventos.length) return { processed: 0, sent: 0 };

  let totalSent = 0;
  let totalFailed = 0;
  for (const ev of eventos) {
    try {
      const r = await sendCheckinAberturaEmailsForEvento(ev);
      if (r.skipped && r.reason === 'already_sent') continue;
      totalSent += r.sent || 0;
      totalFailed += r.failed || 0;
      if ((r.sent || 0) > 0) {
        console.log(`✉️ Check-in abertura: ${r.sent}/${r.total} email(s) — ${ev.label || ev._id}`);
      }
    } catch (e) {
      console.error('runCheckinAberturaEmailJob evento', ev._id, e?.message || e);
    }
  }
  return { processed: eventos.length, sent: totalSent, failed: totalFailed };
}

export { pgListEventosCheckinAberturaEmailPendentes };
