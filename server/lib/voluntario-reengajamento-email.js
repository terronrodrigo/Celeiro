import { Resend } from 'resend';
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

export function buildVoluntarioReengajamentoEmailHtml({ nome, mensagemHtml, igrejaNome }) {
  const n = (nome || '').trim() || 'voluntário(a)';
  const ig = (igrejaNome || 'Celeiro São Paulo').trim();
  const intro = mensagemHtml?.trim()
    ? `<div style="margin:0 0 20px;font-size:16px;color:#374151;line-height:1.6;">${mensagemHtml}</div>`
    : `<p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">
        Notamos que você já serviu conosco nos últimos meses, mas não há registro de <strong>check-in</strong> nem de <strong>participação em escalas</strong> nos últimos <strong>30 dias</strong>.
      </p>
      <p style="margin:0 0 20px;font-size:16px;color:#374151;line-height:1.6;">
        Pode confirmar se está fazendo check-in e se inscrevendo nas escalas corretamente? Se algo estiver impedindo sua participação, conte para a equipe — queremos ajudar!
      </p>`;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Reengajamento de voluntários</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
  <tr><td style="background:#1a1a2e;padding:28px 36px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#f59e0b;text-transform:uppercase;letter-spacing:.08em;font-weight:600;">${escapeHtmlEmail(ig).replace(/&lt;br&gt;/g, '<br>')}</p>
    <h1 style="margin:8px 0 0;font-size:22px;color:#fff;font-weight:700;">Confira seu check-in e participação em escalas</h1>
  </td></tr>
  <tr><td style="padding:36px;">
    <p style="margin:0 0 14px;font-size:16px;color:#374151;line-height:1.6;">Olá, <strong>${escapeHtmlEmail(n).replace(/&lt;br&gt;/g, '<br>')}</strong>!</p>
    ${intro}
    <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.5;">Obrigado por fazer parte da equipe de voluntários. Contamos com você!</p>
  </td></tr>
  <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 36px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">Equipe de Voluntários · ${escapeHtmlEmail(ig).replace(/&lt;br&gt;/g, '<br>')}</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
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
} = {}) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_resend' };

  const recipients = await pgResolveDestinatariosReengajamento(igrejaId, { ministerioFiltro });
  if (!recipients.length) {
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_recipients' };
  }

  const igreja = await pgFindIgrejaById(igrejaId);
  const mensagemHtml = escapeHtmlEmail(mensagem);
  const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
  const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
  const resend = new Resend(apiKey);
  const igNome = igreja?.nome || 'Voluntários Celeiro';
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
