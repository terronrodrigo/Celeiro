/**
 * Corrige check-ins com dataCheckin incorreto causado pelo bug em getEventDateStringSaoPaulo.
 *
 * O bug: eventos são gravados como meia-noite UTC (2026-02-15T00:00:00Z), mas
 * getEventDateStringSaoPaulo convertia para Brasília, retornando "2026-02-14" (-3h).
 * Assim check-ins do dia 15 eram gravados com dataCheckin = 14 e não apareciam no filtro.
 *
 * Este script:
 *  1. Lê todos os check-ins que possuem eventoId.
 *  2. Para cada um, busca o evento correspondente.
 *  3. Recalcula o dataCheckin correto a partir da data UTC do evento.
 *  4. Atualiza o registro se estiver errado (dry-run por padrão, use --fix para aplicar).
 *
 * Uso (dentro da pasta server, com MONGODB_URI no .env):
 *   node scripts/fix-datacheckin.js          # dry-run: mostra o que seria corrigido
 *   node scripts/fix-datacheckin.js --fix    # aplica as correções
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Checkin from '../models/Checkin.js';
import EventoCheckin from '../models/EventoCheckin.js';

const DRY_RUN = !process.argv.includes('--fix');

const mongoUri = (process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');
if (!mongoUri || !/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
  console.error('Defina MONGODB_URI no .env (deve começar com mongodb:// ou mongodb+srv://).');
  process.exit(1);
}

/** Meia-noite de Brasília em UTC para uma data YYYY-MM-DD (03:00 UTC = 00:00 BRT). */
function getDayRangeStart(dateStr) {
  return new Date(dateStr + 'T03:00:00.000Z');
}

async function main() {
  await mongoose.connect(mongoUri);
  console.log('Conectado ao MongoDB.');
  console.log(DRY_RUN ? '[DRY-RUN] Nenhuma alteração será gravada. Use --fix para aplicar.' : '[FIX] Aplicando correções...');
  console.log('');

  // Carrega todos os eventos em memória (normalmente são poucos)
  const eventos = await EventoCheckin.find({}).select('_id data').lean();
  const eventoMap = new Map(eventos.map(e => [String(e._id), e]));

  // Check-ins vinculados a eventos
  const checkins = await Checkin.find({ eventoId: { $exists: true, $ne: null } })
    .select('_id eventoId dataCheckin email nome')
    .lean();

  let errados = 0;
  let corrigidos = 0;

  for (const c of checkins) {
    const evento = eventoMap.get(String(c.eventoId));
    if (!evento || !evento.data) continue;

    // Data correta: extraída como UTC (como o evento foi salvo)
    const d = evento.data instanceof Date ? evento.data : new Date(evento.data);
    const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD em UTC
    const dataCorreta = getDayRangeStart(dateStr);

    // Compara com o que está gravado
    const dataAtual = c.dataCheckin instanceof Date ? c.dataCheckin : new Date(c.dataCheckin);
    if (!dataAtual || dataAtual.getTime() !== dataCorreta.getTime()) {
      errados++;
      console.log(
        `CHECK-IN ${c._id} | ${c.email} | evento ${c.eventoId}` +
        ` | dataCheckin atual: ${dataAtual ? dataAtual.toISOString() : 'null'}` +
        ` → correto: ${dataCorreta.toISOString()}`
      );
      if (!DRY_RUN) {
        await Checkin.updateOne({ _id: c._id }, { $set: { dataCheckin: dataCorreta } });
        corrigidos++;
      }
    }
  }

  console.log('');
  console.log(`Total check-ins com eventoId: ${checkins.length}`);
  console.log(`Encontrados com dataCheckin errado: ${errados}`);
  if (!DRY_RUN) console.log(`Corrigidos: ${corrigidos}`);
  else if (errados > 0) console.log('Execute com --fix para aplicar as correções.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
