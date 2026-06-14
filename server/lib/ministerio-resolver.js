/**
 * Vincula textos livres de ministério (cadastro legado) ao catálogo `ministerios`.
 */
import { normalizeMinisterioKey } from './escala-consolidada.js';
import { candidaturaMatchesLiderMinisterios, splitVoluntarioMinisterios } from './ministerio-match.js';

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Aliases legados do formulário aberto → nome canônico no catálogo. */
const LEGACY_NOME_ALIASES = new Map([
  ['suporte geral', 'Alicerce / Suporte Geral'],
  ['alicerce', 'Alicerce / Suporte Geral'],
  ['recepcao', 'Welcome / Recepção'],
  ['recepção', 'Welcome / Recepção'],
  ['welcome', 'Welcome / Recepção'],
  ['midia', 'Lab / Mídia ( Fotos )'],
  ['mídia', 'Lab / Mídia ( Fotos )'],
  ['lab / midia', 'Lab / Mídia ( Fotos )'],
  ['lab/midia', 'Lab / Mídia ( Fotos )'],
  ['lab / mídia', 'Lab / Mídia ( Fotos )'],
  ['fotos', 'Lab / Mídia ( Fotos )'],
  ['stories', 'Lab / Mídia ( Stories )'],
  ['video', 'Lab / Mídia ( Vídeo )'],
  ['vídeo', 'Lab / Mídia ( Vídeo )'],
  ['kids', 'Kids / Min. Infantil'],
  ['ministerio infantil', 'Kids / Min. Infantil'],
  ['min. infantil', 'Kids / Min. Infantil'],
  ['parking', 'Parking / Estacionamento'],
  ['estacionamento', 'Parking / Estacionamento'],
  ['care', 'Care / Saúde'],
  ['saude', 'Care / Saúde'],
  ['saúde', 'Care / Saúde'],
  ['consolidacao', 'Consolidação'],
  ['consolidação', 'Consolidação'],
  ['experience', 'Experience / Auditório'],
  ['auditorio', 'Experience / Auditório'],
  ['auditório', 'Experience / Auditório'],
  ['streaming', 'Streaming / Ao Vivo'],
  ['ao vivo', 'Streaming / Ao Vivo'],
  ['producao ao vivo', 'Produção Ao Vivo'],
  ['produção ao vivo', 'Produção Ao Vivo'],
  ['producao', 'Produção'],
  ['produção', 'Produção'],
  ['intercessao presencial', 'Intercessão Presencial'],
  ['intercessão presencial', 'Intercessão Presencial'],
  ['intercessao online', 'Intercessão Online'],
  ['intercessão online', 'Intercessão Online'],
  ['sala de voluntarios', 'Sala de Voluntários'],
  ['sala de voluntários', 'Sala de Voluntários'],
  ['seguranca', 'Segurança'],
  ['segurança', 'Segurança'],
  ['host', 'Host'],
  ['cozinha', 'Cozinha'],
  ['eventos', 'Eventos'],
  ['store', 'Store'],
  ['beauty', 'Beauty'],
  ['mid led', 'MID LED'],
]);

export function buildMinisterioCatalogIndex(catalog = []) {
  const list = Array.isArray(catalog) ? catalog : [];
  const byNormNome = new Map();
  const byId = new Map();
  const byAliasKey = new Map();

  for (const m of list) {
    const id = String(m._id || m.id || '').trim();
    const nome = String(m.nome || '').trim();
    if (!id || !nome) continue;
    const entry = { _id: id, id, nome, slug: m.slug, ativo: m.ativo !== false };
    byId.set(id, entry);
    byNormNome.set(norm(nome), entry);
    const key = normalizeMinisterioKey(nome);
    if (!byAliasKey.has(key)) byAliasKey.set(key, []);
    byAliasKey.get(key).push(entry);
  }

  return { list: [...byId.values()], byNormNome, byId, byAliasKey };
}

export function resolveRawMinisterioToCatalog(rawName, index) {
  const rawTrim = String(rawName || '').trim();
  if (!rawTrim || !index) return null;

  const aliasTarget = LEGACY_NOME_ALIASES.get(norm(rawTrim));
  if (aliasTarget) {
    const hit = index.byNormNome.get(norm(aliasTarget));
    if (hit) return hit;
  }

  const n = norm(rawTrim);
  if (index.byNormNome.has(n)) return index.byNormNome.get(n);

  for (const m of index.list) {
    if (candidaturaMatchesLiderMinisterios(rawTrim, [m.nome])) return m;
  }

  const key = normalizeMinisterioKey(rawTrim);
  const candidates = index.byAliasKey.get(key) || [];
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    const exactSub = candidates.find((m) => norm(m.nome) === n);
    if (exactSub) return exactSub;
    const partial = candidates.find((m) => {
      const mn = norm(m.nome);
      return mn.includes(n) || n.includes(mn);
    });
    if (partial) return partial;
  }

  return null;
}

function uniqueStrings(arr) {
  return [...new Set((arr || []).map((x) => String(x ?? '').trim()).filter(Boolean))];
}

function areasToList(areas) {
  if (Array.isArray(areas)) return uniqueStrings(areas);
  const csv = String(areas ?? '').trim();
  if (!csv) return [];
  return uniqueStrings(csv.split(',').map((s) => s.trim()));
}

/**
 * Resolve ministérios do voluntário para o catálogo.
 * @returns {{ ministerios: string[], ministerioIds: string[], habilidades: string[], unresolved: string[] }}
 */
export function resolveVoluntarioMinisteriosFromCatalog(vol, catalogIndex) {
  const d = vol?.dados || vol || {};
  const rawFromProfile = splitVoluntarioMinisterios({
    ministerios: d.ministerios,
    ministerio: d.ministerio,
  });
  const rawFromAreas = areasToList(d.areas);
  const existingHabilidades = Array.isArray(d.habilidades) ? d.habilidades : [];
  const rawAll = uniqueStrings([...rawFromProfile, ...rawFromAreas, ...existingHabilidades]);

  const byId = new Map();
  const unresolved = [];

  for (const raw of rawAll) {
    const hit = resolveRawMinisterioToCatalog(raw, catalogIndex);
    if (hit) byId.set(hit._id, hit.nome);
    else unresolved.push(raw);
  }

  const ministerioIds = [...byId.keys()];
  const ministerios = [...byId.values()];
  return {
    ministerios,
    ministerioIds,
    habilidades: uniqueStrings(unresolved),
    unresolved,
  };
}

/** Voluntário pertence ao ministério (id ou nome canônico). */
export function voluntarioMatchesMinisterioFilter(vol, { ministerioId, ministerioNome } = {}) {
  const id = String(ministerioId || '').trim();
  const nome = String(ministerioNome || '').trim();
  if (!id && !nome) return true;

  const ids = Array.isArray(vol?.ministerioIds) ? vol.ministerioIds.map(String) : [];
  if (id && ids.includes(id)) return true;

  const mins = splitVoluntarioMinisterios(vol);
  if (nome && mins.some((m) => String(m).trim() === nome)) return true;
  if (nome && mins.some((m) => candidaturaMatchesLiderMinisterios(m, [nome]))) return true;
  return false;
}
