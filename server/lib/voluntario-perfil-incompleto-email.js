import { BRAND_NAME } from './brand.js';
import { Resend } from 'resend';
import { getHojeDateString, weekdayBrasilia, TZ_BRASILIA } from './brasilia.js';
import { buildCeleiroEmailHtml, EMAIL_COLORS, escapeHtml } from './email-layout.js';
import { createMagicLoginLinkForEmail, buildPlatformAccessEmailBlock } from './magic-login.js';
import { pgFindIgrejaById, pgListIgrejas } from '../db/postgres/repos.js';
import {
  pgResolveDestinatariosPerfilIncompleto,
  pgWasVoluntarioPerfilIncompletoEmailEnviado,
  pgMarkVoluntarioPerfilIncompletoEmailEnviado,
  pgEnsureVoluntarioPerfilIncompletoEmailSchema,
} from '../db/postgres/voluntarios-engajamento.js';

/** Terça-feira, 13h–14h (horário de Brasília). */
export function isVoluntarioPerfilIncompletoEmailWindow(now = new Date()) {
  const hoje = now.toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
  if (weekdayBrasilia(hoje) !== 2) return false;
  const hhmm = now.toLocaleTimeString('en-GB', {
    timeZone: TZ_BRASILIA,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const hour = parseInt(hhmm.slice(0, 2), 10);
  const minHour = Number(process.env.VOL_PERFIL_INCOMPLETO_HOUR_MIN || 13);
  const maxHour = Number(process.env.VOL_PERFIL_INCOMPLETO_HOUR_MAX || 14);
  return Number.isFinite(hour) && hour >= minHour && hour < maxHour;
}

function buildMissingFieldsHtml(labels) {
  const items = (labels || []).slice(0, 8);
  if (!items.length) return '';
  const lis = items.map((l) => `<li style="margin:4px 0;">${escapeHtml(l)}</li>`).join('');
  const extra = (labels || []).length > 8
    ? `<li style="margin:4px 0;color:${EMAIL_COLORS.textMuted};">…e outros campos</li>`
    : '';
  return `
    <p style="margin:0 0 8px;font-size:14px;color:${EMAIL_COLORS.textSecondary};">Ainda faltam, por exemplo:</p>
    <ul style="margin:0 0 18px 18px;padding:0;font-size:14px;color:${EMAIL_COLORS.text};line-height:1.5;">${lis}${extra}</ul>`;
}

export function buildVoluntarioPerfilIncompletoEmailHtml({
  nome,
  igrejaNome,
  missingLabels = [],
  platformAccessHtml = '',
  appBase,
}) {
  const n = escapeHtml((nome || '').trim() || 'voluntário(a)');
  const ig = escapeHtml((igrejaNome || BRAND_NAME).trim());
  const missingHtml = buildMissingFieldsHtml(missingLabels);

  const bodyHtml = `
    <p style="margin:0 0 14px;">Olá, <strong>${n}</strong>!</p>
    <p style="margin:0 0 14px;">Deixe seu cadastro atualizado na plataforma da <strong>${ig}</strong>.</p>
    <p style="margin:0 0 14px;">Preencha agora mesmo as informações do seu perfil — isso nos ajuda a cuidar melhor de quem serve, organizar escalas e acompanhar a família de voluntários com dados completos (cadastro de voluntário e de membro).</p>
    ${missingHtml}
    <p style="margin:0;font-size:15px;color:${EMAIL_COLORS.textSecondary};line-height:1.6;">Leva poucos minutos. Obrigado por manter seus dados em dia!</p>`;

  return buildCeleiroEmailHtml({
    title: 'Atualize seu perfil',
    preheader: 'Complete seu cadastro de voluntário na plataforma Celeiro.',
    bodyHtml,
    ctaHref: null,
    ctaLabel: null,
    afterCtaHtml: platformAccessHtml,
    footerNote: BRAND_NAME,
    appBase,
  });
}

export async function previewVoluntarioPerfilIncompletoEmail(igrejaId) {
  const destinatarios = await pgResolveDestinatariosPerfilIncompleto(igrejaId);
  return {
    total: destinatarios.length,
    amostra: destinatarios.slice(0, 12),
  };
}

export async function sendVoluntarioPerfilIncompletoEmailsForIgreja({
  igrejaId,
  tercaYmd,
  force = false,
  appBase,
} = {}) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_resend' };

  const hoje = tercaYmd || getHojeDateString();
  if (!force && await pgWasVoluntarioPerfilIncompletoEmailEnviado(igrejaId, hoje)) {
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'already_sent' };
  }

  const recipients = await pgResolveDestinatariosPerfilIncompleto(igrejaId);
  if (!recipients.length) {
    if (!force) await pgMarkVoluntarioPerfilIncompletoEmailEnviado(igrejaId, hoje, 0);
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_recipients' };
  }

  const igreja = await pgFindIgrejaById(igrejaId);
  const base = (appBase || process.env.APP_URL || 'https://voluntariosceleirosp.com').replace(/\/$/, '');
  const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
  const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
  const resend = new Resend(apiKey);
  const igNome = igreja?.nome || BRAND_NAME;
  const subject = `${igNome} — deixe seu cadastro atualizado`;

  let sent = 0;
  let failed = 0;
  for (const v of recipients) {
    const email = (v.email || '').toLowerCase().trim();
    if (!email) continue;
    let platformAccessHtml = '';
    try {
      const magic = await createMagicLoginLinkForEmail({
        igrejaId,
        email,
        nome: v.nome,
        appBase: base,
        redirectView: 'perfil',
      });
      if (magic?.url) {
        platformAccessHtml = buildPlatformAccessEmailBlock({
          magicLoginUrl: magic.url,
          title: 'Complete seu cadastro agora',
          hint: 'Abra o link e vá em Perfil para preencher as informações que ainda faltam.',
          ctaLabel: 'Atualizar meu perfil agora',
          platformExtra: '',
        });
      }
    } catch (_) { /* opcional */ }

    try {
      const { error } = await resend.emails.send({
        from,
        to: email,
        reply_to: replyTo,
        subject,
        html: buildVoluntarioPerfilIncompletoEmailHtml({
          nome: v.nome,
          igrejaNome: igreja?.nome,
          missingLabels: v.missingLabels,
          platformAccessHtml,
          appBase: base,
        }),
      });
      if (error) {
        failed += 1;
        console.warn(`perfil incompleto email ${email}:`, error.message || error);
      } else {
        sent += 1;
      }
    } catch (e) {
      failed += 1;
      console.warn(`perfil incompleto email ${email}:`, e?.message || e);
    }
    if (recipients.length > 1) {
      await new Promise((r) => setTimeout(r, Number(process.env.EMAIL_SEND_DELAY_MS) || 450));
    }
  }

  if (!force || sent > 0) {
    await pgMarkVoluntarioPerfilIncompletoEmailEnviado(igrejaId, hoje, sent);
  }

  return { sent, failed, total: recipients.length, tercaYmd: hoje };
}

/** Job: toda terça-feira às 13h (Brasília), para todas as igrejas. */
export async function runVoluntarioPerfilIncompletoEmailJob() {
  if ((process.env.VOL_PERFIL_INCOMPLETO_EMAIL || 'true').toLowerCase() === 'false') {
    return { skipped: true, reason: 'disabled' };
  }
  if (!isVoluntarioPerfilIncompletoEmailWindow()) {
    return { skipped: true, reason: 'outside_window' };
  }

  await pgEnsureVoluntarioPerfilIncompletoEmailSchema();

  const hoje = getHojeDateString();
  const igrejas = await pgListIgrejas();
  let totalSent = 0;
  let totalFailed = 0;
  let processed = 0;

  for (const ig of igrejas) {
    if (await pgWasVoluntarioPerfilIncompletoEmailEnviado(ig._id, hoje)) continue;
    try {
      const r = await sendVoluntarioPerfilIncompletoEmailsForIgreja({
        igrejaId: ig._id,
        tercaYmd: hoje,
      });
      processed += 1;
      totalSent += r.sent || 0;
      totalFailed += r.failed || 0;
      if ((r.sent || 0) > 0) {
        console.log(`✉️ Perfil incompleto (terça): ${r.sent}/${r.total} — ${ig.nome}`);
      } else if (r.reason === 'no_recipients') {
        console.log(`⏭️ Perfil incompleto (terça): sem destinatários — ${ig.nome}`);
      }
    } catch (e) {
      console.error('runVoluntarioPerfilIncompletoEmailJob igreja', ig._id, e?.message || e);
    }
  }

  return { tercaYmd: hoje, processed, sent: totalSent, failed: totalFailed };
}
