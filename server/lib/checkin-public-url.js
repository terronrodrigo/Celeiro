import { normalizeAppBase, resolveAppBaseUrl } from './app-url.js';

export { resolveAppBaseUrl };

/** Monta URL pública de check-in (?checkin=id&igreja=slug). */
export function buildCheckinPublicUrl({ appBase, eventoId, igrejaSlug }) {
  const base = normalizeAppBase(appBase);
  const id = (eventoId || '').toString().trim();
  const slug = (igrejaSlug || 'celeiro-sp').toString().trim().toLowerCase();
  if (!id) return base;
  const u = new URL(base.includes('://') ? base : `https://${base}`);
  u.searchParams.set('checkin', id);
  u.searchParams.set('igreja', slug);
  return u.toString();
}

/** Target interno para short_links (ex.: /?checkin=uuid&igreja=slug). */
export function buildCheckinShortLinkTarget({ eventoId, igrejaSlug }) {
  const slug = (igrejaSlug || 'celeiro-sp').toString().trim().toLowerCase();
  const id = (eventoId || '').toString().trim();
  if (!id) return '';
  const qs = new URLSearchParams({ checkin: id, igreja: slug });
  return `/?${qs.toString()}`;
}

/** URL do QR hospedado (imagem inline no email, sem anexo). */
export function buildCheckinQrImageUrl({ appBase, eventoId, igrejaSlug }) {
  const base = normalizeAppBase(appBase);
  const id = (eventoId || '').toString().trim();
  const slug = encodeURIComponent((igrejaSlug || 'celeiro-sp').toString().trim().toLowerCase());
  if (!id) return '';
  return `${base}/api/public/checkin-qr/${encodeURIComponent(id)}.png?igreja=${slug}`;
}
