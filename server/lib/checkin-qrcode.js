import QRCode from 'qrcode';
import sharp from 'sharp';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOGO = join(__dirname, '../../assets/logo-hop-texto-claro.png');

const CARD_W = 720;
const HEADER_H = 132;
const PAD_X = 48;
const QR_PAD = 16;
const ACCENT = '#f59e0b';
const INK = '#1a1a2e';
const MUTED = '#6b7280';
const BG = '#f4f4f5';

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Quebra título longo em linhas para caber na largura do card. */
function wrapTitle(text, maxChars = 26, maxLines = 3) {
  const words = String(text || 'Check-in').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['Check-in'];
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  if (words.join(' ').length > lines.join(' ').length && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > maxChars - 1 ? `${last.slice(0, maxChars - 1)}…` : `${last}…`;
  }
  return lines;
}

function buildCardSvg({
  totalH,
  titleLines,
  subtitle,
  qrTop,
  qrBoxSize,
}) {
  const titleStartY = HEADER_H + 36;
  const titleLineH = 34;
  const titleBlockH = titleLines.length * titleLineH;
  const subtitleY = titleStartY + titleBlockH + 8;
  const hasSubtitle = !!(subtitle || '').trim();

  const titleSvg = titleLines.map((line, i) => `
    <text x="${CARD_W / 2}" y="${titleStartY + i * titleLineH}"
      text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif"
      font-size="26" font-weight="700" fill="${INK}">${escapeXml(line)}</text>`).join('');

  const subtitleSvg = hasSubtitle
    ? `<text x="${CARD_W / 2}" y="${subtitleY}"
        text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif"
        font-size="15" fill="${MUTED}">${escapeXml(subtitle)}</text>`
    : '';

  const footerY = qrTop + qrBoxSize + 36;
  const accentY = totalH - 28;

  return Buffer.from(`<svg width="${CARD_W}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.08"/>
    </filter>
  </defs>
  <rect width="${CARD_W}" height="${totalH}" fill="${BG}"/>
  <rect x="24" y="24" width="${CARD_W - 48}" height="${totalH - 48}" rx="20" fill="#ffffff" filter="url(#shadow)"/>
  <rect x="24" y="24" width="${CARD_W - 48}" height="${HEADER_H}" rx="20" fill="${INK}"/>
  <rect x="24" y="${24 + HEADER_H - 20}" width="${CARD_W - 48}" height="20" fill="${INK}"/>
  <rect x="${PAD_X}" y="${qrTop - QR_PAD}" width="${CARD_W - PAD_X * 2}" height="${qrBoxSize}" rx="14"
    fill="#ffffff" stroke="#e5e7eb" stroke-width="2"/>
  ${titleSvg}
  ${subtitleSvg}
  <text x="${CARD_W / 2}" y="${footerY}"
    text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif"
    font-size="14" font-weight="600" fill="${MUTED}">Escaneie para fazer check-in</text>
  <rect x="${CARD_W / 2 - 36}" y="${accentY}" width="72" height="4" rx="2" fill="${ACCENT}"/>
</svg>`);
}

/**
 * Gera PNG estilizado: logo Celeiro, nome do check-in e QR centralizado.
 * @param {string} url — URL pública do check-in
 * @param {{ title?, subtitle?, label?, qrSize?, logoPath?, size? }} opts
 */
export async function generateCheckinQrPng(url, opts = {}) {
  const target = (url || '').trim();
  if (!target) throw new Error('URL do check-in é obrigatória.');

  const title = (opts.title || opts.label || 'Check-in').trim();
  const subtitle = (opts.subtitle || '').trim();
  const qrSize = Math.min(Math.max(Number(opts.qrSize || opts.size) || 400, 200), 560);
  const titleLines = wrapTitle(title);
  const titleBlockH = titleLines.length * 34;
  const subtitleBlockH = subtitle ? 28 : 0;
  const qrBoxSize = qrSize + QR_PAD * 2;
  const qrTop = HEADER_H + 36 + titleBlockH + subtitleBlockH + 28;
  const totalH = qrTop + qrBoxSize + 88;

  const qrBuffer = await QRCode.toBuffer(target, {
    type: 'png',
    width: qrSize,
    margin: 1,
    errorCorrectionLevel: 'H',
    color: { dark: INK, light: '#ffffff' },
  });

  const cardSvg = buildCardSvg({ totalH, titleLines, subtitle, qrTop, qrBoxSize });

  const logoPath = opts.logoPath || DEFAULT_LOGO;
  const composites = [{ input: cardSvg, top: 0, left: 0 }];

  if (fs.existsSync(logoPath)) {
    try {
      const logoBuffer = await sharp(logoPath)
        .resize({ width: 240, height: 64, fit: 'inside' })
        .png()
        .toBuffer();
      const { width: lw = 0, height: lh = 0 } = await sharp(logoBuffer).metadata();
      composites.push({
        input: logoBuffer,
        top: Math.round(24 + (HEADER_H - lh) / 2),
        left: Math.round((CARD_W - lw) / 2),
      });
    } catch (_) { /* segue sem logo */ }
  }

  composites.push({
    input: qrBuffer,
    top: qrTop,
    left: Math.round((CARD_W - qrSize) / 2),
  });

  return sharp({
    create: {
      width: CARD_W,
      height: totalH,
      channels: 4,
      background: BG,
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const CHECKIN_QR_EMAIL_CID = 'checkin-qr';

/**
 * QR compacto só para email (sem card/logo) — menor e legível em clientes de email.
 */
export async function generateCheckinQrEmailBuffer(url) {
  const target = (url || '').trim();
  if (!target) throw new Error('URL do check-in é obrigatória.');
  return QRCode.toBuffer(target, {
    type: 'png',
    width: 280,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: INK, light: '#ffffff' },
  });
}

export { CHECKIN_QR_EMAIL_CID };
