/** Monta URL pública de check-in (?checkin=id&igreja=slug). */
export function buildCheckinPublicUrl({ appBase, eventoId, igrejaSlug }) {
  const base = (appBase || '').replace(/\/$/, '') || 'https://voluntariosceleirosp.com';
  const id = (eventoId || '').toString().trim();
  const slug = (igrejaSlug || 'celeiro-sp').toString().trim().toLowerCase();
  if (!id) return base;
  const u = new URL(base.includes('://') ? base : `https://${base}`);
  u.searchParams.set('checkin', id);
  u.searchParams.set('igreja', slug);
  return u.toString();
}

export function resolveAppBaseUrl(req) {
  const fromEnv = (process.env.APP_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (req?.protocol && req?.get?.('host')) {
    return `${req.protocol}://${req.get('host')}`;
  }
  return 'https://voluntariosceleirosp.com';
}
