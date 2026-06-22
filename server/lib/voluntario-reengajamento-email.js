import { BRAND_NAME } from './brand.js';
import { Resend } from 'resend';
import { buildCeleiroEmailHtml, EMAIL_COLORS, escapeHtml } from './email-layout.js';
import { defaultResendFrom, normalizeAppBase } from './app-url.js';
import { pgFindIgrejaById } from '../db/postgres/repos.js';
import { pgResolveDestinatariosReengajamento } from '../db/postgres/voluntarios-engajamento.js';

function escapeHtmlEmail(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

export function buildVoluntarioReengajamentoEmailHtml({
  nome,
  mensagemHtml,
  igrejaNome,
  appBase,
}) {
  const n = escapeHtml((nome || '').trim() || 'voluntário(a)');
  const intro = mensagemHtml?.trim()
    ? `<div style="margin:0 0 20px;font-size:16px;line-height:1.6;">${mensagemHtml}</div>`
    : `<p style="margin:0 0 16px;">Notamos que você já serviu conosco nos últimos meses, mas não há registro de <strong>check-in</strong> nem de <strong>participação em escalas</strong> nos últimos <strong>30 dias</strong>.</p>
      <p style="margin:0 0 20px;">Pode confirmar se está fazendo check-in e se inscrevendo nas escalas corretamente? Se algo estiver impedindo sua participação, conte para a equipe — queremos ajudar!</p>`;

  const bodyHtml = `
    <p style="margin:0 0 14px;">Olá, <strong>${n}</strong>!</p>
    ${intro}
    <p style="margin:0;font-size:14px;color:${EMAIL_COLORS.textMuted};">Obrigado por fazer parte da equipe de voluntários. Contamos com você!</p>`;

  return buildCeleiroEmailHtml({
    title: 'Confira seu check-in e participação em escalas',
    preheader: 'Sua participação recente — confira check-in e escalas.',
    bodyHtml,
    footerNote: igrejaNome || BRAND_NAME,
    appBase,
  });
}

export async function previewVoluntarioReengajamentoEmail(igrejaId, { ministerioFiltro } = {}) {
  const destinatarios = await pgResolveDestinatariosReengajamento(igrejaId, { ministerioFiltro });
  return {
    total: destinatarios.length,
    amostra: destinatarios.slice(0, 12),
  };
}

export async function sendVoluntarioReengajamentoEmails({
  igrejaId,
  mensagem = '',
  ministerioFiltro,
  appBase,
} = {}) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_resend' };

  const recipients = await pgResolveDestinatariosReengajamento(igrejaId, { ministerioFiltro });
  if (!recipients.length) {
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_recipients' };
  }

  const igreja = await pgFindIgrejaById(igrejaId);
  const base = normalizeAppBase(appBase);
  const mensagemHtml = escapeHtmlEmail(mensagem);
  const from = defaultResendFrom();
  const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
  const resend = new Resend(apiKey);
  const igNome = igreja?.nome || BRAND_NAME;
  const subject = `${igNome} — confira seu check-in e participação em escalas`;

  let sent = 0;
  let failed = 0;
  for (const v of recipients) {
    const email = (v.email || '').toLowerCase().trim();
    if (!email) continue;
    try {
      const { error } = await resend.emails.send({
        from,
        to: email,
        reply_to: replyTo,
        subject,
        html: buildVoluntarioReengajamentoEmailHtml({
          nome: v.nome,
          mensagemHtml,
          igrejaNome: igreja?.nome,
          appBase: base,
        }),
      });
      if (error) {
        failed += 1;
        console.warn(`reengajamento email ${email}:`, error.message || error);
      } else {
        sent += 1;
      }
    } catch (e) {
      failed += 1;
      console.warn(`reengajamento email ${email}:`, e?.message || e);
    }
    if (recipients.length > 1) {
      await new Promise((r) => setTimeout(r, Number(process.env.EMAIL_SEND_DELAY_MS) || 450));
    }
  }

  return { sent, failed, total: recipients.length };
}
