import { BRAND_NAME } from './brand.js';
import { Resend } from 'resend';
import { buildCeleiroEmailHtml, EMAIL_COLORS, escapeHtml } from './email-layout.js';
import { createMagicLoginLinkForEmail, buildPlatformAccessEmailBlock } from './magic-login.js';
import { pgFindIgrejaById } from '../db/postgres/repos.js';
import { listProximasEscalasAbertas } from './checkin-agradecimento-email.js';

const DEFAULT_WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/GstzVqxAPeqIxGQwvAuLqJ?s=cl&p=i&ilr=2';
const DEFAULT_VOLUNTARIO_FORM_URL = 'https://voluntariosceleirosp.com/f/vU7Ezsc';

function whatsappGroupUrl() {
  return (process.env.VOLUNTARIO_WHATSAPP_GROUP_URL || DEFAULT_WHATSAPP_GROUP_URL).trim();
}

function voluntarioFormUrl() {
  return (process.env.NOVO_MEMBRO_VOLUNTARIO_FORM_URL || DEFAULT_VOLUNTARIO_FORM_URL).trim();
}

function resendClient() {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return null;
  return {
    resend: new Resend(apiKey),
    from: process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>',
    replyTo: process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com',
  };
}

function escalasBlock(proximasEscalas) {
  if (!proximasEscalas?.length) return '';
  const rows = proximasEscalas.map((e) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid ${EMAIL_COLORS.border};">
        <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:${EMAIL_COLORS.text};">${escapeHtml(e.nome)}</p>
        <p style="margin:0 0 8px;font-size:13px;color:${EMAIL_COLORS.textSecondary};">${escapeHtml(e.dataLabel)}</p>
        <a href="${escapeHtml(e.url)}" style="font-size:14px;color:${EMAIL_COLORS.accent};font-weight:600;text-decoration:none;">Ver escala e inscrever-se →</a>
      </td>
    </tr>`).join('');
  return `
    <h2 style="margin:24px 0 10px;font-size:14px;color:${EMAIL_COLORS.text};text-transform:uppercase;letter-spacing:0.04em;">Próximo culto</h2>
    <p style="margin:0 0 12px;font-size:14px;color:${EMAIL_COLORS.textSecondary};">A escala do próximo culto já está disponível. Escolha o ministério em que deseja servir:</p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows}</table>`;
}

export function buildVoluntarioCadastroAcolhimentoHtml({
  nome,
  ministerio,
  proximasEscalas,
  whatsappUrl,
  igrejaNome,
  platformAccessHtml = '',
  appBase,
}) {
  const n = escapeHtml((nome || '').trim() || 'voluntário(a)');
  const ig = escapeHtml((igrejaNome || 'Celeiro São Paulo').trim());
  const min = (ministerio || '').trim();
  const wa = escapeHtml(whatsappUrl || whatsappGroupUrl());

  const bodyHtml = `
    <p style="margin:0 0 14px;">Olá, <strong>${n}</strong>!</p>
    <p style="margin:0 0 14px;">Recebemos seu cadastro e queremos agradecer pela sua <strong>disponibilidade de servir</strong> na ${ig}.${min ? ` Vimos seu interesse em <strong>${escapeHtml(min)}</strong>.` : ''}</p>
    <p style="margin:0 0 14px;">Para ficar por dentro das escalas, avisos e combinados da equipe, entre no <strong>grupo de voluntários no WhatsApp</strong>:</p>
    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 0;">
      <tr><td style="border-radius:12px;background:${EMAIL_COLORS.accent};">
        <a href="${wa}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:12px;">Entrar no grupo de voluntários</a>
      </td></tr>
    </table>
    ${escalasBlock(proximasEscalas)}
    <p style="margin:20px 0 0;font-size:14px;color:${EMAIL_COLORS.textMuted};">Estamos muito felizes em ter você conosco. Qualquer dúvida, responda este e-mail.</p>`;

  const primaryEscala = proximasEscalas?.[0];
  return buildCeleiroEmailHtml({
    title: 'Obrigado pela sua disponibilidade!',
    preheader: 'Bem-vindo(a) à equipe de voluntários — entre no grupo e veja a escala do próximo culto.',
    bodyHtml,
    ctaHref: primaryEscala?.url || wa,
    ctaLabel: primaryEscala ? 'Inscrever-se na escala' : 'Entrar no grupo WhatsApp',
    afterCtaHtml: platformAccessHtml,
    footerNote: BRAND_NAME,
    appBase,
  });
}

export function buildNovoMembroAcolhimentoHtml({
  nome,
  voluntarioUrl,
  igrejaNome,
  platformAccessHtml = '',
  appBase,
}) {
  const n = escapeHtml((nome || '').trim() || 'amigo(a)');
  const ig = escapeHtml((igrejaNome || 'Celeiro São Paulo').trim());
  const formUrl = escapeHtml(voluntarioUrl || voluntarioFormUrl());

  const bodyHtml = `
    <p style="margin:0 0 14px;">Olá, <strong>${n}</strong>!</p>
    <p style="margin:0 0 14px;"><strong>Seja muito bem-vindo(a) à ${ig}!</strong> Ficamos felizes em receber sua inscrição e em saber que você quer fazer parte da nossa família.</p>
    <p style="margin:0 0 14px;">Se você tem interesse em servir nos cultos, convidamos você a preencher o <strong>cadastro de voluntários</strong>. É por lá que organizamos as escalas de cada ministério:</p>
    <p style="margin:16px 0 0;font-size:13px;color:${EMAIL_COLORS.textMuted};text-align:center;">
      Link do cadastro:<br>
      <a href="${formUrl}" style="color:${EMAIL_COLORS.accent};text-decoration:none;font-weight:600;">${formUrl}</a>
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:${EMAIL_COLORS.textMuted};">Estamos à disposição para acolher você. Responda este e-mail se precisar de ajuda.</p>`;

  return buildCeleiroEmailHtml({
    title: 'Bem-vindo(a) ao Celeiro!',
    preheader: 'Obrigado por se inscrever — conheça também o cadastro de voluntários.',
    bodyHtml,
    ctaHref: voluntarioUrl || voluntarioFormUrl(),
    ctaLabel: 'Cadastro de voluntários',
    afterCtaHtml: platformAccessHtml,
    footerNote: BRAND_NAME,
    appBase,
  });
}

/** Email de acolhimento após cadastro público de voluntário. */
export async function sendVoluntarioCadastroAcolhimentoEmail({
  igrejaId,
  email,
  nome,
  ministerio,
  appBase,
  igrejaNome,
  igrejaSlug,
}) {
  const client = resendClient();
  if (!client) return { skipped: true, reason: 'no_resend' };

  const em = String(email || '').toLowerCase().trim();
  if (!em || !em.includes('@')) return { skipped: true, reason: 'invalid_email' };

  const igreja = igrejaNome
    ? { nome: igrejaNome, slug: igrejaSlug || 'celeiro-sp' }
    : await pgFindIgrejaById(igrejaId);
  const slug = igreja?.slug || igrejaSlug || 'celeiro-sp';
  const base = (appBase || process.env.APP_URL || 'https://voluntariosceleirosp.com').replace(/\/$/, '');
  const proximasEscalas = await listProximasEscalasAbertas(igrejaId, {
    limit: 2,
    appBase: base,
    igrejaSlug: slug,
  }).catch(() => []);
  const wa = whatsappGroupUrl();

  let platformAccessHtml = '';
  try {
    const magic = await createMagicLoginLinkForEmail({
      igrejaId,
      email: em,
      nome,
      appBase: base,
      redirectView: 'escalas',
    });
    if (magic?.url) platformAccessHtml = buildPlatformAccessEmailBlock({ magicLoginUrl: magic.url });
  } catch (_) { /* opcional */ }

  const { error } = await client.resend.emails.send({
    from: client.from,
    to: em,
    reply_to: client.replyTo,
    subject: 'Obrigado pela sua disponibilidade de servir!',
    html: buildVoluntarioCadastroAcolhimentoHtml({
      nome,
      ministerio,
      proximasEscalas,
      whatsappUrl: wa,
      igrejaNome: igreja?.nome,
      platformAccessHtml,
      appBase: base,
    }),
  });

  if (error) {
    console.warn(`acolhimento voluntario ${em}:`, error.message || error);
    return { sent: 0, failed: 1, error: error.message || String(error) };
  }
  return { sent: 1, failed: 0 };
}

/** Email de boas-vindas após formulário de novos membros. */
export async function sendNovoMembroAcolhimentoEmail({
  igrejaId,
  email,
  nome,
  appBase,
  igrejaNome,
}) {
  const client = resendClient();
  if (!client) return { skipped: true, reason: 'no_resend' };

  const em = String(email || '').toLowerCase().trim();
  if (!em || !em.includes('@')) return { skipped: true, reason: 'invalid_email' };

  let igNome = igrejaNome;
  if (!igNome && igrejaId) {
    const igreja = await pgFindIgrejaById(igrejaId).catch(() => null);
    igNome = igreja?.nome;
  }

  const formUrl = voluntarioFormUrl();

  let platformAccessHtml = '';
  if (igrejaId) {
    try {
      const magic = await createMagicLoginLinkForEmail({
        igrejaId,
        email: em,
        nome,
        redirectView: 'escalas',
      });
      if (magic?.url) platformAccessHtml = buildPlatformAccessEmailBlock({ magicLoginUrl: magic.url });
    } catch (_) { /* opcional */ }
  }

  const { error } = await client.resend.emails.send({
    from: client.from,
    to: em,
    reply_to: client.replyTo,
    subject: `Bem-vindo(a) ao ${igNome || 'Celeiro São Paulo'}!`,
    html: buildNovoMembroAcolhimentoHtml({
      nome,
      voluntarioUrl: formUrl,
      igrejaNome: igNome,
      platformAccessHtml,
      appBase: (appBase || process.env.APP_URL || 'https://voluntariosceleirosp.com').replace(/\/$/, ''),
    }),
  });

  if (error) {
    console.warn(`acolhimento novo membro ${em}:`, error.message || error);
    return { sent: 0, failed: 1, error: error.message || String(error) };
  }
  return { sent: 1, failed: 0 };
}
