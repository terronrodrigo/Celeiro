import { BRAND_NAME } from './brand.js';
import { Resend } from 'resend';
import { getHojeDateString, weekdayBrasilia } from './brasilia.js';
import { getNowHHMMBrasilia } from './escala-checkin-rules.js';
import { buildCeleiroEmailHtml, EMAIL_COLORS, escapeHtml } from './email-layout.js';
import { defaultResendFrom, normalizeAppBase } from './app-url.js';
import { createMagicLoginLinkForEmail, buildPlatformAccessEmailBlock } from './magic-login.js';
import { pgFindIgrejaById, pgListIgrejas } from '../db/postgres/repos.js';
import {
  pgResolveDestinatariosNuncaServiram,
  pgWasVoluntarioNuncaServiuEmailEnviado,
  pgMarkVoluntarioNuncaServiuEmailEnviado,
  pgEnsureVoluntarioNuncaServiuEmailSchema,
} from '../db/postgres/voluntarios-engajamento.js';

const DEFAULT_WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/GstzVqxAPeqIxGQwvAuLqJ?s=cl&p=i&ilr=2';
const DEFAULT_INSTAGRAM_URL = 'https://www.instagram.com/voluntarios.celeiro?igsh=MTFrb3Zld25oaXkzaA==';

function whatsappGroupUrl() {
  return (process.env.VOLUNTARIO_WHATSAPP_GROUP_URL || DEFAULT_WHATSAPP_GROUP_URL).trim();
}

function instagramUrl() {
  return (process.env.VOLUNTARIO_INSTAGRAM_URL || DEFAULT_INSTAGRAM_URL).trim();
}

/** Segunda-feira, 10h–11h (horário de Brasília). */
export function isVoluntarioNuncaServiuEmailWindow(now = new Date()) {
  const hoje = getHojeDateString(now);
  if (weekdayBrasilia(hoje) !== 1) return false;
  const hhmm = getNowHHMMBrasilia(now);
  const hour = parseInt(hhmm.slice(0, 2), 10);
  const minHour = Number(process.env.VOL_NUNCA_SERVIU_HOUR_MIN || 10);
  const maxHour = Number(process.env.VOL_NUNCA_SERVIU_HOUR_MAX || 11);
  return Number.isFinite(hour) && hour >= minHour && hour < maxHour;
}

export function buildVoluntarioNuncaServiuEmailHtml({
  nome,
  igrejaNome,
  whatsappUrl,
  instagramLink,
  platformAccessHtml = '',
  appBase,
}) {
  const n = escapeHtml((nome || '').trim() || 'voluntário(a)');
  const ig = escapeHtml((igrejaNome || 'Celeiro São Paulo').trim());
  const wa = escapeHtml(whatsappUrl || whatsappGroupUrl());
  const insta = escapeHtml(instagramLink || instagramUrl());

  const bodyHtml = `
    <p style="margin:0 0 14px;">Olá, <strong>${n}</strong>!</p>
    <p style="margin:0 0 14px;">Notamos que você se cadastrou na nossa base de voluntários da <strong>${ig}</strong>, mas ainda não entrou em nossa escala nem fez check-in recentemente.</p>
    <p style="margin:0 0 14px;">Se você ainda não está em um ministério, entre no nosso <strong>grupo geral de voluntários no WhatsApp</strong> para ficar por dentro das novidades e combinar sua primeira participação.</p>
    <p style="margin:0 0 8px;font-size:14px;color:${EMAIL_COLORS.textSecondary};">Siga também a página de voluntários no Instagram:</p>
    <p style="margin:0 0 20px;font-size:14px;">
      <a href="${insta}" style="color:${EMAIL_COLORS.accent};font-weight:600;text-decoration:none;">@voluntarios.celeiro no Instagram →</a>
    </p>
    <p style="margin:0;font-size:15px;color:${EMAIL_COLORS.textSecondary};line-height:1.6;">Agradecemos por servir em nossa casa e esperamos te ver em muitos momentos em nosso time de voluntários.</p>`;

  return buildCeleiroEmailHtml({
    title: 'Venha fazer parte do time!',
    preheader: 'Cadastro recebido — entre no grupo de voluntários e acompanhe as escalas.',
    bodyHtml,
    ctaHref: wa,
    ctaLabel: 'Entrar no grupo de voluntários',
    afterCtaHtml: platformAccessHtml,
    footerNote: BRAND_NAME,
    appBase,
  });
}

export async function previewVoluntarioNuncaServiuEmail(igrejaId) {
  const destinatarios = await pgResolveDestinatariosNuncaServiram(igrejaId);
  return {
    total: destinatarios.length,
    amostra: destinatarios.slice(0, 12),
  };
}

export async function sendVoluntarioNuncaServiuEmailsForIgreja({
  igrejaId,
  semanaYmd,
  force = false,
  appBase,
} = {}) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_resend' };

  const hoje = semanaYmd || getHojeDateString();
  if (!force && await pgWasVoluntarioNuncaServiuEmailEnviado(igrejaId, hoje)) {
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'already_sent' };
  }

  const recipients = await pgResolveDestinatariosNuncaServiram(igrejaId);
  if (!recipients.length) {
    if (!force) await pgMarkVoluntarioNuncaServiuEmailEnviado(igrejaId, hoje, 0);
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_recipients' };
  }

  const igreja = await pgFindIgrejaById(igrejaId);
  const base = normalizeAppBase(appBase);
  const from = defaultResendFrom();
  const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
  const resend = new Resend(apiKey);
  const igNome = igreja?.nome || BRAND_NAME;
  const subject = `${igNome} — venha servir conosco no time de voluntários`;
  const wa = whatsappGroupUrl();
  const insta = instagramUrl();

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
        redirectView: 'escalas',
      });
      if (magic?.url) {
        platformAccessHtml = buildPlatformAccessEmailBlock({
          magicLoginUrl: magic.url,
          hint: 'Veja escalas abertas e faça seu primeiro check-in quando servir.',
        });
      }
    } catch (_) { /* opcional */ }

    try {
      const { error } = await resend.emails.send({
        from,
        to: email,
        reply_to: replyTo,
        subject,
        html: buildVoluntarioNuncaServiuEmailHtml({
          nome: v.nome,
          igrejaNome: igreja?.nome,
          whatsappUrl: wa,
          instagramLink: insta,
          platformAccessHtml,
          appBase: base,
        }),
      });
      if (error) {
        failed += 1;
        console.warn(`nunca serviu email ${email}:`, error.message || error);
      } else {
        sent += 1;
      }
    } catch (e) {
      failed += 1;
      console.warn(`nunca serviu email ${email}:`, e?.message || e);
    }
    if (recipients.length > 1) {
      await new Promise((r) => setTimeout(r, Number(process.env.EMAIL_SEND_DELAY_MS) || 450));
    }
  }

  if (!force || sent > 0) {
    await pgMarkVoluntarioNuncaServiuEmailEnviado(igrejaId, hoje, sent);
  }

  return { sent, failed, total: recipients.length, semanaYmd: hoje };
}

/** Job: toda segunda-feira às 10h (Brasília), para todas as igrejas. */
export async function runVoluntarioNuncaServiuEmailJob() {
  if ((process.env.VOL_NUNCA_SERVIU_EMAIL || 'true').toLowerCase() === 'false') {
    return { skipped: true, reason: 'disabled' };
  }
  if (!isVoluntarioNuncaServiuEmailWindow()) {
    return { skipped: true, reason: 'outside_window' };
  }

  await pgEnsureVoluntarioNuncaServiuEmailSchema();

  const hoje = getHojeDateString();
  const igrejas = await pgListIgrejas();
  let totalSent = 0;
  let totalFailed = 0;
  let processed = 0;

  for (const ig of igrejas) {
    if (await pgWasVoluntarioNuncaServiuEmailEnviado(ig._id, hoje)) continue;
    try {
      const r = await sendVoluntarioNuncaServiuEmailsForIgreja({
        igrejaId: ig._id,
        semanaYmd: hoje,
      });
      processed += 1;
      totalSent += r.sent || 0;
      totalFailed += r.failed || 0;
      if ((r.sent || 0) > 0) {
        console.log(`✉️ Nunca serviu (segunda): ${r.sent}/${r.total} — ${ig.nome}`);
      } else if (r.reason === 'no_recipients') {
        console.log(`⏭️ Nunca serviu (segunda): sem destinatários — ${ig.nome}`);
      }
    } catch (e) {
      console.error('runVoluntarioNuncaServiuEmailJob igreja', ig._id, e?.message || e);
    }
  }

  return { semanaYmd: hoje, processed, sent: totalSent, failed: totalFailed };
}
