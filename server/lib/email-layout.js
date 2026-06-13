import { BRAND_NAME, BRAND_SHORT, BRAND_TAGLINE } from './brand.js';

/** Paleta Celeiro v3 para emails (clientes não suportam CSS variables). */
export const EMAIL_COLORS = {
  bg: '#f7f1e8',
  card: '#ffffff',
  border: '#e9dfd0',
  text: '#2b241e',
  textSecondary: '#6e6359',
  textMuted: '#9c9186',
  accent: '#8a342c',
  accentDark: '#6e2922',
  accentSoft: '#f3e8e4',
};

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Shell HTML transacional Celeiro v3 (creme + bordô).
 * @param {{ title: string, preheader?: string, bodyHtml: string, ctaHref?: string, ctaLabel?: string, footerNote?: string }} opts
 */
export function buildCeleiroEmailHtml({
  title,
  preheader = '',
  bodyHtml,
  ctaHref,
  ctaLabel,
  footerNote,
}) {
  const c = EMAIL_COLORS;
  const pre = preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : '';
  const ctaBlock = (ctaHref && ctaLabel)
    ? `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:28px auto 0;"><tr><td align="center" style="border-radius:12px;background:${c.accent};">
      <a href="${ctaHref}" style="display:inline-block;padding:14px 32px;font-family:'DM Sans','Segoe UI',Arial,sans-serif;font-size:16px;font-weight:700;color:#fff;text-decoration:none;border-radius:12px;">${escapeHtml(ctaLabel)}</a>
    </td></tr></table>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${c.bg};font-family:'DM Sans','Segoe UI',Arial,sans-serif;">
${pre}
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${c.bg};padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;background:${c.card};border:1px solid ${c.border};border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(82,58,38,0.1);">
      <tr>
        <td style="background:linear-gradient(135deg,${c.accentDark} 0%,${c.accent} 100%);padding:28px 32px;text-align:center;">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.82);text-transform:uppercase;letter-spacing:0.12em;font-weight:600;">${escapeHtml(BRAND_SHORT)}</p>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.9);letter-spacing:0.04em;">${escapeHtml(BRAND_TAGLINE)}</p>
          <h1 style="margin:14px 0 0;font-size:22px;color:#fff;font-weight:700;line-height:1.3;">${escapeHtml(title)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 28px 28px;color:${c.text};font-size:16px;line-height:1.65;">
          ${bodyHtml}
          ${ctaBlock}
        </td>
      </tr>
      <tr>
        <td style="background:${c.accentSoft};border-top:1px solid ${c.border};padding:18px 28px;text-align:center;">
          <p style="margin:0;font-size:12px;color:${c.textMuted};line-height:1.5;">${escapeHtml(footerNote || BRAND_NAME)}</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export { escapeHtml };
