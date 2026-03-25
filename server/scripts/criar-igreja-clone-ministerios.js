#!/usr/bin/env node
/**
 * Cria uma nova igreja (tenant) e replica a estrutura de ministérios de uma igreja modelo.
 * Não copia voluntários, usuários, check-ins, escalas ou formulários — só Igreja + Ministérios.
 *
 * Caso padrão (INC Adolescentes a partir de Inc SP):
 *   cd server && node scripts/criar-igreja-clone-ministerios.js
 *
 * Variáveis de ambiente (opcionais):
 *   SOURCE_IGREJA_SLUG=inc-sp          — igreja modelo
 *   NOVA_IGREJA_NOME=INC Adolescentes  — nome exibido
 *   NOVA_IGREJA_SLUG=inc-adolescentes  — slug para ?igreja= e login
 *   DRY_RUN=1                          — apenas log, sem gravar
 *
 * Requer MONGODB_URI (ou .env na pasta server com dotenv).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Igreja from '../models/Igreja.js';
import Ministerio from '../models/Ministerio.js';

const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const SOURCE_SLUG = (process.env.SOURCE_IGREJA_SLUG || 'inc-sp').trim().toLowerCase();
const NOVA_NOME = (process.env.NOVA_IGREJA_NOME || 'INC Adolescentes').trim();
const NOVA_SLUG = (process.env.NOVA_IGREJA_SLUG || 'inc-adolescentes').trim().toLowerCase();
const DRY = String(process.env.DRY_RUN || '').trim() === '1';

/** Mesma lista base do front (cadastro / selects) quando a igreja modelo não tem ministérios. */
const MINISTERIOS_PADRAO = [
  'Suporte Geral',
  'Welcome / Recepção',
  'Experience / Auditório',
  'Streaming / Ao Vivo',
  'Produção Ao Vivo',
  'Lab / Mídia',
  'Produção',
  'Intercessão Presencial',
  'Sala de Voluntários',
  'Kids / Min. Infantil',
  'Consolidação',
  'Care / Saúde',
  'Parking / Estacionamento',
  'Segurança',
  'Intercessão Online',
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
  if (!MONGODB_URI) {
    console.error('Defina MONGODB_URI (ex.: no server/.env).');
    process.exit(1);
  }
  if (!NOVA_SLUG || !/^[a-z0-9][a-z0-9-]*$/.test(NOVA_SLUG)) {
    console.error('NOVA_IGREJA_SLUG deve ser slug válido (minúsculas, números e hífen).');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Conectado ao MongoDB.');
  if (DRY) console.log('DRY_RUN=1 — nenhuma alteração será gravada.\n');

  const fonte = await Igreja.findOne({ slug: SOURCE_SLUG }).lean();
  if (!fonte) {
    console.error(`Igreja modelo não encontrada: slug "${SOURCE_SLUG}".`);
    console.error('Crie-a antes (ex.: migrate-multi-igreja.js cria inc-sp) ou ajuste SOURCE_IGREJA_SLUG.');
    await mongoose.disconnect();
    process.exit(1);
  }

  let destino = await Igreja.findOne({ slug: NOVA_SLUG }).lean();
  if (!destino) {
    if (DRY) {
      console.log(`[dry-run] Criaria igreja: "${NOVA_NOME}" (${NOVA_SLUG})`);
      destino = { _id: new mongoose.Types.ObjectId() };
    } else {
      const created = await Igreja.create({ nome: NOVA_NOME, slug: NOVA_SLUG, ativo: true });
      destino = created.toObject();
      console.log(`Igreja criada: ${NOVA_NOME} (${NOVA_SLUG}) id=${destino._id}`);
    }
  } else {
    console.log(`Igreja já existe: ${destino.nome} (${NOVA_SLUG}) id=${destino._id}`);
    if (!DRY && destino.nome !== NOVA_NOME) {
      await Igreja.updateOne({ _id: destino._id }, { $set: { nome: NOVA_NOME } });
      console.log(`  Nome atualizado para: ${NOVA_NOME}`);
    }
  }

  const destinoId = destino._id;

  const existentes = await Ministerio.countDocuments({ igrejaId: destinoId });
  if (existentes > 0 && !DRY) {
    console.log(`Esta igreja já tem ${existentes} ministério(s). Nada a clonar (idempotente).`);
    await mongoose.disconnect();
    process.exit(0);
  }
  if (existentes > 0 && DRY) {
    console.log(`[dry-run] Já existiriam ${existentes} ministérios — script sairia sem duplicar.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  let modeloMins = await Ministerio.find({ igrejaId: fonte._id }).sort({ nome: 1 }).lean();
  if (modeloMins.length === 0) {
    console.log(`Nenhum ministério em "${SOURCE_SLUG}"; usando lista padrão da plataforma (${MINISTERIOS_PADRAO.length} itens).`);
    modeloMins = MINISTERIOS_PADRAO.map((nome) => ({ nome, slug: slugifyNome(nome), ativo: true }));
  } else {
    console.log(`Copiando ${modeloMins.length} ministério(s) de ${SOURCE_SLUG} → ${NOVA_SLUG}.`);
  }

  const used = new Set();
  const toInsert = [];
  for (const m of modeloMins) {
    const nome = String(m.nome || '').trim();
    if (!nome) continue;
    let slug = (m.slug && String(m.slug).trim()) || slugifyNome(nome);
    slug = slug.toLowerCase();
    const base = slug;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    used.add(slug);
    toInsert.push({
      igrejaId: destinoId,
      nome,
      slug,
      ativo: m.ativo !== false,
    });
  }

  if (DRY) {
    console.log('[dry-run] Ministérios que seriam criados:');
    toInsert.forEach((row) => console.log(`  - ${row.nome} (${row.slug})`));
  } else {
    if (toInsert.length) await Ministerio.insertMany(toInsert);
    console.log(`OK: ${toInsert.length} ministério(s) criados para "${NOVA_SLUG}".`);
    console.log('\nPróximos passos:');
    console.log(`  • Login / links públicos: use ?igreja=${NOVA_SLUG} ou seletor de igreja com esse slug.`);
    console.log('  • Crie um admin global ou usuário vinculado a esta igreja pela UI (Usuários).');
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
