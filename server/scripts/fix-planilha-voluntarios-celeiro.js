#!/usr/bin/env node
/**
 * Voluntários com fonte "planilha" (import Google Sheets/CSV da plataforma) devem ficar
 * apenas no tenant Celeiro. Corrige registros que foram gravados com outro igrejaId
 * (ex.: admin global com Inc selecionado ao rodar migração/sync).
 *
 * Uso: cd server && node scripts/fix-planilha-voluntarios-celeiro.js
 * Opcional: MONGODB_URI=... node scripts/fix-planilha-voluntarios-celeiro.js --dry-run
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Igreja from '../models/Igreja.js';
import Voluntario from '../models/Voluntario.js';

const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const DRY = process.argv.includes('--dry-run');

if (!MONGODB_URI) {
  console.error('Defina MONGODB_URI.');
  process.exit(1);
}

const CELEIRO_SLUG = (process.env.DEFAULT_IGREJA_SLUG || 'celeiro-sp').trim().toLowerCase();

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Conectado.', DRY ? '(dry-run)' : '');

  const celeiro = await Igreja.findOne({ slug: CELEIRO_SLUG }).lean();
  if (!celeiro) {
    console.error(`Igreja "${CELEIRO_SLUG}" não encontrada. Rode migrate-multi-igreja.js primeiro.`);
    process.exit(1);
  }
  const celeiroId = celeiro._id;

  const stray = await Voluntario.find({ fonte: 'planilha', igrejaId: { $ne: celeiroId } }).lean();
  console.log(`Encontrados ${stray.length} voluntário(s) planilha fora do Celeiro.`);

  let moved = 0;
  let removed = 0;
  for (const v of stray) {
    const em = (v.email || '').toLowerCase().trim();
    const existsCeleiro = await Voluntario.findOne({ email: em, igrejaId: celeiroId }).lean();
    if (existsCeleiro) {
      if (!DRY) await Voluntario.deleteOne({ _id: v._id });
      removed++;
      console.log(`  ${DRY ? '[dry-run] ' : ''}Remover duplicata: ${em} (mantido no Celeiro)`);
    } else {
      if (!DRY) await Voluntario.updateOne({ _id: v._id }, { $set: { igrejaId: celeiroId } });
      moved++;
      console.log(`  ${DRY ? '[dry-run] ' : ''}Mover para Celeiro: ${em}`);
    }
  }

  console.log(`\nOK. Movidos: ${moved}, duplicatas removidas: ${removed}.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
