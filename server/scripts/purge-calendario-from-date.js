#!/usr/bin/env node
/**
 * Remove artefatos **gerados automaticamente** pelo culto recorrente com data civil
 * maior ou igual a `--from=YYYY-MM-DD` (fuso America/Sao_Paulo nos JSON de escala).
 *
 * Escopo inclui:
 * - escalas com autoGerada/cultoRecorrenteId e data ≥ from
 * - eventos_checkin com auto_gerado ou culto_recorrente_id e data ≥ from
 * - culto_ocorrencias com data ≥ from (tabela de rastreamento do sync)
 *
 * Não apaga registros da tabela cultos_recorrentes (configs). Rode depois POST sync
 * no admin para recriar ocorrências limpas se quiser.
 *
 * Uso em produção (perigoso sem dry-run primeiro):
 *
 *   DATABASE_URL="postgresql://..." node server/scripts/purge-calendario-from-date.js --from=2026-05-28
 *
 * Todas igrejas:
 *
 *   ... --from=2026-05-28
 *
 * Apenas uma igreja:
 *
 *   ... --from=2026-05-28 --igreja=UUID_PG
 *
 * Simular sem escrever:
 *
 *   ... --dry-run
 */
import 'dotenv/config';
import { initPostgres, getPostgresPool } from '../db/postgres/init.js';

const DEFAULT_FROM = '2026-05-28';

function parseArgs() {
  const out = {
    dryRun: false,
    fromYmd: DEFAULT_FROM,
    igrejaId: null,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--from=')) out.fromYmd = a.slice(7).trim();
    else if (a.startsWith('--igreja=')) out.igrejaId = a.slice(9).trim() || null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.fromYmd)) {
    console.error('Use --from=YYYY-MM-DD (ex.: 2026-05-28).');
    process.exit(1);
  }
  return out;
}

const escalaFilterSql = `
  SELECT id FROM escalas e
  WHERE ($2::text IS NULL OR igreja_id = $2::text)
    AND (
      (e.dados->>'autoGerada')::boolean IS TRUE OR (NULLIF(trim(e.dados->>'cultoRecorrenteId'), '') IS NOT NULL)
    )
    AND (e.dados->>'data') IS NOT NULL
    AND (
      ((e.dados->>'data')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
    )
`;

const eventoFilterSql = `
  SELECT id FROM eventos_checkin
  WHERE ($2::text IS NULL OR igreja_id = $2::text)
    AND data >= $1::date
    AND (auto_gerado IS TRUE OR culto_recorrente_id IS NOT NULL)
`;

async function main() {
  const { dryRun, fromYmd, igrejaId } = parseArgs();
  const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
  if (!DATABASE_URL) {
    console.error('Defina DATABASE_URL (PostgreSQL).');
    process.exit(1);
  }

  await initPostgres(DATABASE_URL);
  const pool = getPostgresPool();
  const igParam = igrejaId || null;

  console.log(JSON.stringify({
    dryRun,
    fromYmd,
    igrejaId: igParam,
    modo: igParam ? 'uma igreja' : 'todas as igrejas',
  }, null, 2));

  const [{ rows: escalasIds }, { rows: eventoIds }] = await Promise.all([
    pool.query(escalaFilterSql, [fromYmd, igParam]),
    pool.query(eventoFilterSql, [fromYmd, igParam]),
  ]);

  const { rows: occCount } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM culto_ocorrencias
     WHERE data >= $1::date AND ($2::text IS NULL OR igreja_id = $2::text)`,
    [fromYmd, igParam],
  );

  console.log('\nEscalas a apagar:', escalasIds.length);
  console.log('Eventos check-in a apagar:', eventoIds.length);
  console.log('Ocorrências (culto_ocorrencias) ≥ data:', occCount[0]?.c ?? 0);

  if (dryRun) {
    console.log('\nDry-run — nada foi alterado.');
    await pool.end();
    return;
  }

  const idsE = escalasIds.map((r) => r.id);
  const idsEv = eventoIds.map((r) => r.id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (idsE.length) {
      const { rowCount } = await client.query(
        `DELETE FROM escalas WHERE id = ANY($1::text[]) AND ($2::text IS NULL OR igreja_id = $2::text)`,
        [idsE, igParam],
      );
      console.log('Escalas eliminadas (linhas):', rowCount);
    }
    if (idsEv.length) {
      const { rowCount } = await client.query(
        `DELETE FROM eventos_checkin WHERE id = ANY($1::text[]) AND ($2::text IS NULL OR igreja_id = $2::text)`,
        [idsEv, igParam],
      );
      console.log('Eventos check-in eliminados (linhas):', rowCount);
    }
    const { rowCount } = await client.query(
      `DELETE FROM culto_ocorrencias WHERE data >= $1::date AND ($2::text IS NULL OR igreja_id = $2::text)`,
      [fromYmd, igParam],
    );
    console.log('culto_ocorrencias eliminadas:', rowCount);
    await client.query('COMMIT');
    console.log('\nCommit concluído. Reinicie o servidor ou rode sync de cultos recorrentes se necessário.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
