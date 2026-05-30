#!/usr/bin/env node
/**
 * Lista e remove eventos_checkin que **não têm escala ativa** apontando para eles
 * (via dados.eventoCheckinId), junto com os registros em `checkins` desses eventos.
 *
 * Use após exclusões manuais de escalas no passado ou para auditoria periódica.
 * Novas exclusões de escala já disparam a limpeza automaticamente.
 *
 * Simular (recomendado primeiro):
 *   DATABASE_URL="postgresql://..." node server/scripts/purge-eventos-checkin-orfaos.js --dry-run
 *
 * Executar limpeza (todas as igrejas):
 *   DATABASE_URL="postgresql://..." node server/scripts/purge-eventos-checkin-orfaos.js
 *
 * Uma igreja:
 *   ... --igreja=UUID_PG
 *
 * npm (na pasta server):
 *   npm run purge-checkin-orfaos -- --dry-run
 */
import 'dotenv/config';
import { initPostgres, getPostgresPool } from '../db/postgres/init.js';
import {
  pgListEventosCheckinSemEscalaAtiva,
  pgPurgeEventosCheckinSemEscalaAtiva,
} from '../db/postgres/escalas-checkin.js';

function parseArgs() {
  const out = { dryRun: false, igrejaId: null };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--igreja=')) out.igrejaId = a.slice(9).trim() || null;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function formatData(val) {
  if (!val) return '—';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(`Uso: node scripts/purge-eventos-checkin-orfaos.js [--dry-run] [--igreja=UUID]

Remove eventos de check-in órfãos (sem escala ativa vinculada) e check-ins associados.`);
    process.exit(0);
  }

  const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
  if (!DATABASE_URL) {
    console.error('Defina DATABASE_URL (PostgreSQL).');
    process.exit(1);
  }

  await initPostgres(DATABASE_URL);
  const pool = getPostgresPool();

  console.log(JSON.stringify({
    dryRun: args.dryRun,
    igrejaId: args.igrejaId,
    modo: args.igrejaId ? 'uma igreja' : 'todas as igrejas',
  }, null, 2));

  const orphans = await pgListEventosCheckinSemEscalaAtiva(args.igrejaId);
  const totalCheckins = orphans.reduce((s, o) => s + (o.checkinsCount || 0), 0);

  console.log(`\nEventos check-in órfãos: ${orphans.length}`);
  console.log(`Registros de presença (checkins) nesses eventos: ${totalCheckins}`);

  if (orphans.length) {
    console.log('\nAmostra (até 30):');
    orphans.slice(0, 30).forEach((o) => {
      console.log(
        `  • ${formatData(o.data)} | ${(o.label || '(sem nome)').slice(0, 48)} | checkins: ${o.checkinsCount} | igreja: ${o.igrejaId} | id: ${o._id}`,
      );
    });
    if (orphans.length > 30) console.log(`  … e mais ${orphans.length - 30}`);
  }

  if (args.dryRun) {
    console.log('\nDry-run — nada foi alterado.');
    await pool.end();
    return;
  }

  if (!orphans.length) {
    console.log('\nNada a limpar.');
    await pool.end();
    return;
  }

  const r = await pgPurgeEventosCheckinSemEscalaAtiva(args.igrejaId, { dryRun: false });
  console.log('\nLimpeza concluída:');
  console.log(`  Eventos check-in removidos: ${r.deleted.eventos}`);
  console.log(`  Registros checkins removidos: ${r.deleted.checkins}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
