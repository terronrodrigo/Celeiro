#!/usr/bin/env node
/**
 * Importa líderes/usuários de um CSV para PostgreSQL.
 *
 * Colunas (cabeçalho obrigatório):
 *   email,nome,role,senha,ministerios
 *
 * - role: lider | admin | voluntario (padrão lider)
 * - ministerios: nomes separados por | (ex.: Beauty|Host)
 * - senha: mínimo 6 caracteres; se vazio, gera temporária e imprime no log
 *
 * Uso:
 *   DATABASE_URL=... IGREJA_SLUG=celeiro-sp node scripts/import-lideres-csv.js ./scripts/lideres-celeiro.csv
 *   DRY_RUN=1 ...
 */
import 'dotenv/config';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { parse } from 'csv-parse/sync';
import { initPostgres } from '../db/postgres/init.js';
import {
  pgFindIgrejaBySlug,
  pgFindMinisterioByNome,
  pgFindUserByEmailInIgreja,
  pgCreateUser,
  pgUpdateUser,
} from '../db/postgres/repos.js';

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const IGREJA_SLUG = (process.env.IGREJA_SLUG || 'celeiro-sp').trim().toLowerCase();
const DRY = String(process.env.DRY_RUN || '').trim() === '1';
const csvPath = process.argv[2];

function tempPassword() {
  return `Tmp${randomBytes(4).toString('hex')}!`;
}

async function resolveMinisterioIds(igrejaId, namesRaw) {
  const names = String(namesRaw || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const ids = [];
  for (const nome of names) {
    const m = await pgFindMinisterioByNome(igrejaId, nome);
    if (!m) {
      console.warn(`    ministério não encontrado: "${nome}" (rode seed-ministerios-celeiro antes)`);
      continue;
    }
    ids.push(m._id);
  }
  return ids;
}

async function main() {
  if (!DATABASE_URL) {
    console.error('Defina DATABASE_URL.');
    process.exit(1);
  }
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error('Uso: node scripts/import-lideres-csv.js <arquivo.csv>');
    process.exit(1);
  }

  await initPostgres(DATABASE_URL);
  const igreja = await pgFindIgrejaBySlug(IGREJA_SLUG);
  if (!igreja) {
    console.error(`Igreja não encontrada: ${IGREJA_SLUG}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`CSV: ${rows.length} linha(s) → ${igreja.nome} (${IGREJA_SLUG})\n`);
  if (DRY) console.log('DRY_RUN=1\n');

  const senhasGeradas = [];

  for (const row of rows) {
    const email = String(row.email || '').trim().toLowerCase();
    const nome = String(row.nome || '').trim();
    const role = String(row.role || 'lider').trim().toLowerCase();
    let senha = String(row.senha || '').trim();
    if (!email || !nome) {
      console.warn('  linha ignorada (email/nome vazio):', row);
      continue;
    }
    if (!['lider', 'admin', 'voluntario'].includes(role)) {
      console.warn(`  ${email}: role inválido "${role}"`);
      continue;
    }
    if (!senha || senha.length < 6) {
      senha = tempPassword();
      senhasGeradas.push({ email, senha });
    }

    const ministerioIds = await resolveMinisterioIds(igreja._id, row.ministerios);
    const existente = await pgFindUserByEmailInIgreja(igreja._id, email);

    if (DRY) {
      console.log(`  [dry-run] ${email} ${role} mins=${ministerioIds.length}`);
      continue;
    }

    if (!existente) {
      await pgCreateUser({
        email,
        nome,
        senha,
        role,
        igrejaId: igreja._id,
        ministerioIds,
        mustChangePassword: true,
      });
      console.log(`  + ${email} (${role})`);
    } else {
      await pgUpdateUser(existente._id, igreja._id, { nome, role, ministerioIds, ativo: true });
      console.log(`  ~ ${email} (${role})`);
    }
  }

  if (senhasGeradas.length) {
    console.log('\nSenhas temporárias geradas (envie aos líderes e peça troca no 1º login):');
    senhasGeradas.forEach(({ email, senha }) => console.log(`  ${email}\t${senha}`));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
