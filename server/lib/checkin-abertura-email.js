import { BRAND_NAME } from './brand.js';
import { Resend } from 'resend';
import { formatDataPtBr, escalaDataToYMD } from './brasilia.js';
import {
  buildCheckinPublicUrl,
  buildCheckinQrImageUrl,
  buildCheckinShortLinkTarget,
} from './checkin-public-url.js';
import { buildCeleiroEmailHtml, EMAIL_COLORS, escapeHtml } from './email-layout.js';
import { createMagicLoginLinkForEmail, buildPlatformAccessEmailBlock } from './magic-login.js';
import { pgListVoluntarios } from '../db/postgres/operational-data.js';
import { pgFindIgrejaById } from '../db/postgres/repos.js';
import { pgGetOrCreateShortLink } from '../db/postgres/short-links.js';
import {
  pgListEventosCheckinAberturaEmailPendentes,
  pgTryClaimEventoAberturaEmail,
  pgTryClaimCheckinAberturaEmail,
  pgReleaseCheckinAberturaEmail,
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
  checkinUrlDisplay,
  qrImageUrl,
  igrejaNome,
  platformAccessHtml = '',
  appBase,
}) {
  const n = escapeHtml((nome || '').trim() || 'voluntário(a)');
  const titulo = escapeHtml((eventoLabel || 'Check-in de presença').trim());
  const ig = escapeHtml((igrejaNome || 'Celeiro São Paulo').trim());
  const dataPart = eventoDataLabel ? ` <span style="color:${EMAIL_COLORS.textSecondary};">(${escapeHtml(eventoDataLabel)})</span>` : '';
  const linkDisplay = escapeHtml(checkinUrlDisplay || checkinUrl);
  const qrBlock = qrImageUrl
    ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0 0;">
      <tr><td align="center" style="padding:16px;background:${EMAIL_COLORS.bg};border:1px solid ${EMAIL_COLORS.border};border-radius:12px;">
        <p style="margin:0 0 12px;font-size:13px;color:${EMAIL_COLORS.textMuted};">Ou escaneie o QR code:</p>
        <img src="${escapeHtml(qrImageUrl)}" width="200" height="200" alt="QR code check-in"
          style="display:block;margin:0 auto;border-radius:8px;background:#fff;max-width:200px;height:auto;">
      </td></tr>
    </table>`
    : '';

  const bodyHtml = `
    <p style="margin:0 0 14px;">Olá, <strong>${n}</strong>!</p>
    <p style="margin:0 0 14px;">O check-in de presença está aberto para <strong>${titulo}</strong>${dataPart}.</p>
    <p style="margin:0 0 8px;font-size:15px;color:${EMAIL_COLORS.textSecondary};">Janela: ${escapeHtml(horarioTexto)}.</p>
    <p style="margin:16px 0 0;font-size:14px;color:${EMAIL_COLORS.textSecondary};">Igreja: <strong>${ig}</strong></p>
    ${qrBlock}
    <p style="margin:20px 0 0;font-size:13px;color:${EMAIL_COLORS.textMuted};text-align:center;">
      Link direto:<br>
      <a href="${escapeHtml(checkinUrl)}" style="color:${EMAIL_COLORS.accent};text-decoration:none;font-weight:600;">${linkDisplay}</a>
    </p>`;

  return buildCeleiroEmailHtml({
    title: 'Check-in aberto',
    preheader: `Check-in aberto para ${(eventoLabel || 'culto').trim()}${eventoDataLabel ? ` — ${eventoDataLabel}` : ''}`,
    bodyHtml,
    ctaHref: checkinUrl,
    ctaLabel: 'Fazer check-in agora',
    afterCtaHtml: platformAccessHtml,
    footerNote: BRAND_NAME,
    appBase,
  });
}

async function resolveCheckinShareUrl({ appBase, eventoId, igrejaSlug, igrejaId }) {
  const longUrl = buildCheckinPublicUrl({ appBase, eventoId, igrejaSlug });
  try {
    const target = buildCheckinShortLinkTarget({ eventoId, igrejaSlug });
    if (!target) return { href: longUrl, display: longUrl };
    const code = await pgGetOrCreateShortLink(target, igrejaId || null);
    if (!code) return { href: longUrl, display: longUrl };
    const shortUrl = `${appBase.replace(/\/$/, '')}/f/${code}`;
    return { href: shortUrl, display: shortUrl };
  } catch (_) {
    return { href: longUrl, display: longUrl };
  }
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
  const igrejaSlug = igreja?.slug || 'celeiro-sp';
  const { href: checkinUrl, display: checkinUrlDisplay } = await resolveCheckinShareUrl({
    appBase,
    eventoId: evento._id,
    igrejaSlug,
    igrejaId: evento.igrejaId,
  });
  const qrImageUrl = buildCheckinQrImageUrl({ appBase, eventoId: evento._id, igrejaSlug });
  const ymd = escalaDataToYMD(evento.data);
  const eventoDataLabel = ymd ? formatDataPtBr(ymd) : '';
  const eventoLabel = (evento.label || '').trim() || `Culto ${eventoDataLabel}`;
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
  let skippedDedup = 0;
  for (const [email, nome] of recipients) {
    const claimed = await pgTryClaimCheckinAberturaEmail(ev.igrejaId, email, ev._id);
    if (!claimed) {
      skippedDedup += 1;
      continue;
    }
    try {
      let platformAccessHtml = '';
      try {
        const magic = await createMagicLoginLinkForEmail({
          igrejaId: ev.igrejaId,
          email,
          nome,
          appBase,
          redirectView: 'checkin-hoje',
        });
        if (magic?.url) {
          platformAccessHtml = buildPlatformAccessEmailBlock({
            magicLoginUrl: magic.url,
            hint: 'Veja seus cultos, confirme check-in e acompanhe seu histórico.',
          });
        }
      } catch (_) { /* segue sem bloco de plataforma */ }

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
          checkinUrlDisplay,
          qrImageUrl,
          igrejaNome: igreja?.nome,
          platformAccessHtml,
          appBase,
        }),
      });
      if (error) {
        failed += 1;
        await pgReleaseCheckinAberturaEmail(ev.igrejaId, email, ev._id);
        console.warn(`checkin abertura email ${email}:`, error.message || error);
      } else {
        sent += 1;
      }
    } catch (e) {
      failed += 1;
      await pgReleaseCheckinAberturaEmail(ev.igrejaId, email, ev._id);
      console.warn(`checkin abertura email ${email}:`, e?.message || e);
    }
    if (recipients.length > 1) {
      await new Promise((r) => setTimeout(r, Number(process.env.EMAIL_SEND_DELAY_MS) || 450));
    }
  }

  return { sent, failed, skippedDedup, total: recipients.length, checkinUrl };
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
      } else if ((r.skippedDedup || 0) > 0) {
        console.log(`✉️ Check-in abertura: 0 novos (${r.skippedDedup} já receberam neste evento) — ${ev.label || ev._id}`);
      }
    } catch (e) {
      console.error('runCheckinAberturaEmailJob evento', ev._id, e?.message || e);
    }
  }
  return { processed: eventos.length, sent: totalSent, failed: totalFailed };
}
