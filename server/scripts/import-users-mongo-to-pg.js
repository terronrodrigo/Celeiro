#!/usr/bin/env node
/**
 * Copia usuários (admin/líder/voluntário) do MongoDB para PostgreSQL, por igreja (slug).
 * Vincula ministerioIds pelo nome do ministério na igreja destino.
 *
 * Quando o Atlas voltar, libere seu IP e rode:
 *   MONGODB_URI="mongodb+srv://..." DATABASE_URL="postgresql://..." \\
 *   IGREJA_SLUG=celeiro-sp node scripts/import-users-mongo-to-pg.js
 *
 *   DRY_RUN=1  — só mostra o que faria
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { initPostgres, getPostgresPool } from '../db/postgres/init.js';
import { pgFindIgrejaBySlug, pgFindUserByEmailInIgreja, pgUpsertUserWithPasswordHash } from '../db/postgres/repos.js';
import User from '../models/User.js';
import Ministerio from '../models/Ministerio.js';
import Igreja from '../models/Igreja.js';

const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const IGREJA_SLUG = (process.env.IGREJA_SLUG || 'celeiro-sp').trim().toLowerCase();
const DRY = String(process.env.DRY_RUN || '').trim() === '1';

async function main() {
  if (!MONGODB_URI || !DATABASE_URL) {
    console.error('Defina MONGODB_URI e DATABASE_URL.');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  await initPostgres(DATABASE_URL);
  const pool = getPostgresPool();

  const mongoIgreja = await Igreja.findOne({ slug: IGREJA_SLUG }).lean();
  if (!mongoIgreja) {
    console.error(`Igreja Mongo não encontrada: ${IGREJA_SLUG}`);
    process.exit(1);
  }
  const pgIgreja = await pgFindIgrejaBySlug(IGREJA_SLUG);
  if (!pgIgreja) {
    console.error(`Igreja Postgres não encontrada: ${IGREJA_SLUG}`);
    process.exit(1);
  }

  const mongoMins = await Ministerio.find({ igrejaId: mongoIgreja._id }).lean();
  const { rows: pgMins } = await pool.query(
    'SELECT id, nome FROM ministerios WHERE igreja_id = $1',
    [pgIgreja._id],
  );
  const pgMinByNome = new Map(
    pgMins.map((m) => [String(m.nome || '').trim().toLowerCase(), m.id]),
  );

  const mongoIdToPgId = new Map();
  for (const mm of mongoMins) {
    const pgId = pgMinByNome.get(String(mm.nome || '').trim().toLowerCase());
    if (pgId) mongoIdToPgId.set(String(mm._id), pgId);
  }

  const users = await User.find({ igrejaId: mongoIgreja._id }).select(
    '+senha email nome role ativo ministerioIds mustChangePassword',
  );

  console.log(`Mongo → Postgres | ${IGREJA_SLUG} | ${users.length} usuário(s)\n`);
  if (DRY) console.log('DRY_RUN=1\n');

  let criados = 0;
  let atualizados = 0;
  let ignorados = 0;

  for (const u of users) {
    const email = String(u.email || '').trim().toLowerCase();
    if (!email) continue;

    const ministerioIds = (u.ministerioIds || [])
      .map((id) => mongoIdToPgId.get(String(id)))
      .filter(Boolean);

    const payload = {
      nome: u.nome,
      role: u.role || 'voluntario',
      ativo: u.ativo !== false,
      ministerioIds,
    };

    const existente = await pgFindUserByEmailInIgreja(pgIgreja._id, email);

    if (DRY) {
      console.log(`  [dry-run] ${email} role=${payload.role} mins=${ministerioIds.length} ${existente ? '(update)' : '(create)'}`);
      continue;
    }

    if (!u.senha) {
      console.warn(`  ! ${email}: sem senha/hash no Mongo — use CSV ou set-user-password`);
      ignorados += 1;
      continue;
    }

    const { created } = await pgUpsertUserWithPasswordHash({
      email,
      nome: payload.nome,
      senhaHash: u.senha,
      role: payload.role,
      igrejaId: pgIgreja._id,
      ministerioIds,
      mustChangePassword: !!u.mustChangePassword,
      ativo: payload.ativo,
    });
    console.log(`  ${created ? '+' : '~'} ${email} (${payload.role})`);
    if (created) criados += 1;
    else atualizados += 1;
  }

  console.log(`\nResumo: ${criados} criado(s), ${atualizados} atualizado(s), ${ignorados} ignorado(s).`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
