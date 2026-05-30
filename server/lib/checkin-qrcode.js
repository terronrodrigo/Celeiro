import QRCode from 'qrcode';

/** Gera PNG do QR code para a URL de check-in (buffer). */
export async function generateCheckinQrPng(url, opts = {}) {
  const target = (url || '').trim();
  if (!target) throw new Error('URL do check-in é obrigatória.');
  const size = Math.min(Math.max(Number(opts.size) || 512, 128), 1024);
  return QRCode.toBuffer(target, {
    type: 'png',
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#1a1a2e', light: '#ffffff' },
  });
}

export async function generateCheckinQrDataUrl(url, opts = {}) {
  const buf = await generateCheckinQrPng(url, opts);
  return `data:image/png;base64,${buf.toString('base64')}`;
}
