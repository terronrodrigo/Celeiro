#!/usr/bin/env node
/**
 * Insere (idempotente) os ministérios históricos do Celeiro SP — escala "DOMINGO TARDE".
 * Nomes extraídos dos links ?ministerio=...&igreja=celeiro-sp.
 *
 * Uso local ou no Railway (com DATABASE_URL):
 *   cd server && node scripts/seed-ministerios-celeiro.js
 *
 * Variáveis:
 *   DATABASE_URL          — obrigatório (PostgreSQL)
 *   IGREJA_SLUG=celeiro-sp
 *   DRY_RUN=1             — só lista o que faria, sem gravar
 *
 * Nota: links públicos com escala=6a051f6e4ac87cd3584f11a6 ainda dependem do Mongo
 * até migrar escalas/candidaturas. Este script só recria ministérios no Postgres.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { initPostgres, getPostgresPool } from '../db/postgres/init.js';

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const IGREJA_SLUG = (process.env.IGREJA_SLUG || 'celeiro-sp').trim().toLowerCase();
const DRY = String(process.env.DRY_RUN || '').trim() === '1';

/** Lista exata dos links "DOMINGO TARDE" (voluntariosceleirosp.com). */
const MINISTERIOS_DOMINGO_TARDE = [
  'Alicerce / Suporte Geral',
  'Beauty',
  'Care / Saúde',
  'Consolidação',
  'Cozinha',
  'Eventos',
  'Experience / Auditório',
  'Host',
  'Intercessão Online',
  'Intercessão Presencial',
  'Kids / Min. Infantil',
  'Lab / Mídia ( Fotos )',
  'Lab / Mídia ( Stories )',
  'Lab / Mídia ( Vídeo )',
  'MID LED',
  'Outro',
  'Parking / Estacionamento',
  'Produção',
  'Produção Ao Vivo',
  'Sala de Voluntários',
  'Segurança',
  'Store',
  'Streaming / Ao Vivo',
  'Welcome / Recepção',
];

function slugifyNome(nome) {
  const s = String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  return s || 'ministerio';
}

async function main() {
  if (!DATABASE_URL) {
    console.error('Defina DATABASE_URL (PostgreSQL no Railway ou server/.env).');
    process.exit(1);
  }

  await initPostgres(DATABASE_URL);
  const pool = getPostgresPool();
  console.log('Conectado ao PostgreSQL.');
  if (DRY) console.log('DRY_RUN=1 — nenhuma alteração será gravada.\n');

  const { rows: igrejas } = await pool.query(
    'SELECT id, nome, slug FROM igrejas WHERE LOWER(slug) = $1 LIMIT 1',
    [IGREJA_SLUG],
  );
  const igreja = igrejas[0];
  if (!igreja) {
    console.error(`Igreja não encontrada: slug "${IGREJA_SLUG}". Rode o deploy/seed primeiro.`);
    process.exit(1);
  }
  console.log(`Igreja: ${igreja.nome} (${igreja.slug}) id=${igreja.id}\n`);

  const { rows: existentes } = await pool.query(
    'SELECT id, nome, slug FROM ministerios WHERE igreja_id = $1',
    [igreja.id],
  );
  const byNome = new Map(
    existentes.map((r) => [String(r.nome || '').trim().toLowerCase(), r]),
  );
  const usedSlugs = new Set(existentes.map((r) => String(r.slug || '').toLowerCase()));

  let criados = 0;
  let ignorados = 0;

  for (const nome of MINISTERIOS_DOMINGO_TARDE) {
    const key = nome.trim().toLowerCase();
    if (byNome.has(key)) {
      console.log(`  já existe: ${nome}`);
      ignorados += 1;
      continue;
    }

    let slug = slugifyNome(nome);
    const base = slug;
    let n = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    usedSlugs.add(slug);

    if (DRY) {
      console.log(`  [dry-run] criaria: ${nome} (${slug})`);
      criados += 1;
      continue;
    }

    const id = randomUUID();
    await pool.query(
      'INSERT INTO ministerios (id, igreja_id, nome, slug, ativo) VALUES ($1, $2, $3, $4, TRUE)',
      [id, igreja.id, nome, slug],
    );
    byNome.set(key, { id, nome, slug });
    console.log(`  + ${nome} (${slug})`);
    criados += 1;
  }

  const { rows: total } = await pool.query(
    'SELECT COUNT(*)::int AS c FROM ministerios WHERE igreja_id = $1',
    [igreja.id],
  );

  console.log(`\nResumo: ${criados} novo(s), ${ignorados} já existente(s). Total na igreja: ${total[0].c}.`);
  if (!DRY && criados > 0) {
    console.log('\nNo painel admin (Postgres), recarregue a página de Ministérios.');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
