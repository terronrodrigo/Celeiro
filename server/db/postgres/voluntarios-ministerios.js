import { getPostgresPool } from './init.js';
import { pgListMinisterios } from './repos.js';
import {
  buildMinisterioCatalogIndex,
  resolveVoluntarioMinisteriosFromCatalog,
  resolveRawMinisterioToCatalog,
} from '../../lib/ministerio-resolver.js';
import { splitVoluntarioMinisterios } from '../../lib/ministerio-match.js';

/** Contagem de voluntários por ministério (via ministerio_ids no JSONB). */
export async function pgCountVoluntariosPorMinisterio(igrejaId) {
  const pool = getPostgresPool();
  const { rows } = await pool.query(
    `SELECT m.id,
            m.nome,
            COALESCE((
              SELECT COUNT(*)::int
              FROM voluntarios v
              WHERE v.igreja_id = $1
                AND v.dados->'ministerio_ids' @> to_jsonb(ARRAY[m.id]::text[])
            ), 0) AS total_voluntarios,
            COALESCE((
              SELECT COUNT(*)::int
              FROM voluntarios v
              WHERE v.igreja_id = $1
                AND v.ativo IS DISTINCT FROM FALSE
                AND v.dados->'ministerio_ids' @> to_jsonb(ARRAY[m.id]::text[])
            ), 0) AS ativos_voluntarios
     FROM ministerios m
     WHERE m.igreja_id = $1
     ORDER BY m.nome`,
    [igrejaId],
  );
  const map = new Map();
  for (const r of rows) {
    map.set(String(r.id), {
      totalVoluntarios: Number(r.total_voluntarios) || 0,
      ativosVoluntarios: Number(r.ativos_voluntarios) || 0,
    });
  }
  return map;
}

/**
 * Normaliza ministerios/ministerio_ids de todos os voluntários da igreja.
 * Textos não reconhecidos vão para `habilidades`.
 */
export async function pgNormalizeVoluntariosMinisterios(igrejaId, { dryRun = false } = {}) {
  const catalog = await pgListMinisterios(igrejaId);
  const index = buildMinisterioCatalogIndex(catalog);
  const pool = getPostgresPool();

  const { rows } = await pool.query(
    `SELECT id, email, dados, ativo FROM voluntarios WHERE igreja_id = $1`,
    [igrejaId],
  );

  let processed = 0;
  let updated = 0;
  let vinculados = 0;
  let comHabilidades = 0;
  let semMinisterio = 0;
  const amostraNaoResolvido = [];

  for (const row of rows) {
    processed += 1;
    const d = row.dados || {};
    const beforeIds = JSON.stringify(d.ministerio_ids || []);
    const resolved = resolveVoluntarioMinisteriosFromCatalog({ dados: d }, index);

    if (resolved.ministerioIds.length) vinculados += 1;
    else semMinisterio += 1;
    if (resolved.habilidades.length) comHabilidades += 1;

    for (const u of resolved.unresolved) {
      if (amostraNaoResolvido.length < 20 && !amostraNaoResolvido.includes(u)) {
        amostraNaoResolvido.push(u);
      }
    }

    const newDados = {
      ...d,
      ministerios: resolved.ministerios,
      ministerio: resolved.ministerios.join(', '),
      ministerio_ids: resolved.ministerioIds,
      habilidades: resolved.habilidades,
    };
    const afterIds = JSON.stringify(newDados.ministerio_ids || []);
    const changed = beforeIds !== afterIds
      || JSON.stringify(d.ministerios || []) !== JSON.stringify(newDados.ministerios)
      || JSON.stringify(d.habilidades || []) !== JSON.stringify(newDados.habilidades);

    if (changed && !dryRun) {
      await pool.query(
        `UPDATE voluntarios SET dados = $2::jsonb WHERE id = $1`,
        [row.id, JSON.stringify(newDados)],
      );
      updated += 1;
    } else if (changed) {
      updated += 1;
    }
  }

  return {
    processed,
    updated,
    vinculados,
    semMinisterio,
    comHabilidades,
    catalogoMinisterios: catalog.length,
    amostraNaoResolvido,
    dryRun: !!dryRun,
  };
}

/** Lista valores crus ainda sem vínculo (para revisão admin). */
export async function pgListMinisteriosNaoResolvidos(igrejaId, { limit = 40 } = {}) {
  const catalog = await pgListMinisterios(igrejaId);
  const index = buildMinisterioCatalogIndex(catalog);
  const pool = getPostgresPool();
  const { rows } = await pool.query(
    `SELECT dados FROM voluntarios WHERE igreja_id = $1`,
    [igrejaId],
  );
  const counts = new Map();
  for (const row of rows) {
    const d = row.dados || {};
    const raw = [
      ...splitVoluntarioMinisterios({ ministerios: d.ministerios, ministerio: d.ministerio }),
      ...(Array.isArray(d.habilidades) ? d.habilidades : []),
    ];
    for (const r of raw) {
      const t = String(r || '').trim();
      if (!t) continue;
      if (resolveRawMinisterioToCatalog(t, index)) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([nome, total]) => ({ nome, total }));
}
