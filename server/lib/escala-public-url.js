/** Monta URL pública de inscrição na escala (?escala=id&ministerio=…&igreja=slug). */
export function buildEscalaPublicUrl({ appBase, escalaId, igrejaSlug, ministerio = null }) {
  const base = (appBase || '').replace(/\/$/, '') || 'https://voluntariosceleirosp.com';
  const id = (escalaId || '').toString().trim();
  const slug = (igrejaSlug || 'celeiro-sp').toString().trim().toLowerCase();
  if (!id) return base;
  const u = new URL(base.includes('://') ? base : `https://${base}`);
  u.searchParams.set('escala', id);
  u.searchParams.set('igreja', slug);
  const min = (ministerio || '').toString().trim();
  if (min) u.searchParams.set('ministerio', min);
  return u.toString();
}
