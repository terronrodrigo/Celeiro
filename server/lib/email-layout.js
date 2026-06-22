import { BRAND_NAME, BRAND_SHORT, BRAND_TAGLINE } from './brand.js';
import { normalizeAppBase } from './app-url.js';

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

/** URL absoluta do logo preto (mesmo da plataforma: fundo claro). */
export function emailLogoUrl(appBase) {
  const base = normalizeAppBase(appBase);
  return `${base}/assets/logo-hop-dark-transparent.png`;
}

/** Bloco de logo centralizado para headers de email. */
export function buildEmailLogoBlock(appBase) {
  const url = emailLogoUrl(appBase);
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(BRAND_SHORT)} — ${escapeHtml(BRAND_TAGLINE)}" width="240" style="display:block;margin:0 auto 12px;max-width:240px;height:auto;border:0;" />`;
}

/** Header padrão Celeiro v3: fundo claro + logo preto + título escuro. */
export function buildEmailHeaderHtml({ title, appBase }) {
  const c = EMAIL_COLORS;
  const logoBlock = buildEmailLogoBlock(appBase);
  return `
      <tr>
        <td style="background:${c.card};padding:28px 32px 22px;text-align:center;border-bottom:3px solid ${c.accent};">
          ${logoBlock}
          <p style="margin:0 0 6px;font-size:11px;color:${c.textMuted};text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">${escapeHtml(BRAND_TAGLINE)}</p>
          <h1 style="margin:0;font-size:22px;color:${c.text};font-weight:700;line-height:1.3;">${escapeHtml(title)}</h1>
        </td>
      </tr>`;
}

/**
 * Shell HTML transacional Celeiro v3 (creme + bordô).
 * @param {{ title: string, preheader?: string, bodyHtml: string, ctaHref?: string, ctaLabel?: string, afterCtaHtml?: string, footerNote?: string, appBase?: string }} opts
 */
export function buildCeleiroEmailHtml({
  title,
  preheader = '',
  bodyHtml,
  ctaHref,
  ctaLabel,
  afterCtaHtml = '',
  footerNote,
  appBase,
}) {
  const c = EMAIL_COLORS;
  const pre = preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : '';
  const ctaBlock = (ctaHref && ctaLabel)
    ? `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:28px auto 0;"><tr><td align="center" style="border-radius:12px;background:${c.accent};">
      <a href="${ctaHref}" style="display:inline-block;padding:14px 32px;font-family:'DM Sans','Segoe UI',Arial,sans-serif;font-size:16px;font-weight:700;color:#fff;text-decoration:none;border-radius:12px;">${escapeHtml(ctaLabel)}</a>
    </td></tr></table>`
    : '';
  const headerHtml = buildEmailHeaderHtml({ title, appBase });

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
      ${headerHtml}
      <tr>
        <td style="padding:32px 28px 28px;color:${c.text};font-size:16px;line-height:1.65;">
          ${bodyHtml}
          ${ctaBlock}
          ${afterCtaHtml}
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
