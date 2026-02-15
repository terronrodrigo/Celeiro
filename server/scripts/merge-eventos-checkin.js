/**
 * Unifica check-ins de vários eventos com o mesmo nome em um único evento.
 * Mantém um evento como alvo, aponta todos os check-ins para ele e remove os eventos duplicados.
 *
 * Uso (na pasta server, com MONGODB_URI no .env):
 *   node scripts/merge-eventos-checkin.js "Culto 15/02"
 *
 * Ou com termo parcial (case-insensitive):
 *   node scripts/merge-eventos-checkin.js "15/02"
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Checkin from '../models/Checkin.js';
import EventoCheckin from '../models/EventoCheckin.js';

const searchTerm = process.argv[2]?.trim();
const mongoUri = (process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');

if (!mongoUri || !/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
  console.error('Defina MONGODB_URI no .env (deve começar com mongodb:// ou mongodb+srv://).');
  process.exit(1);
}
if (!searchTerm) {
  console.error('Uso: node scripts/merge-eventos-checkin.js "<nome do evento>"');
  console.error('Ex.: node scripts/merge-eventos-checkin.js "Culto 15/02"');
  process.exit(1);
}

async function main() {
  await mongoose.connect(mongoUri);

  const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  const eventos = await EventoCheckin.find({ label: regex }).sort({ createdAt: 1 }).lean();

  if (eventos.length === 0) {
    console.log('Nenhum evento encontrado com o termo:', searchTerm);
    await mongoose.disconnect();
    return;
  }
  if (eventos.length === 1) {
    console.log('Apenas 1 evento encontrado. Nada a unificar.');
    await mongoose.disconnect();
    return;
  }

  const eventoIds = eventos.map((e) => e._id);
  const counts = await Checkin.aggregate([
    { $match: { eventoId: { $in: eventoIds } } },
    { $group: { _id: '$eventoId', total: { $sum: 1 } } },
  ]);
  const countByEvent = Object.fromEntries(counts.map((c) => [String(c._id), c.total]));

  const target = eventos.reduce((best, e) => {
    const a = countByEvent[String(best._id)] || 0;
    const b = countByEvent[String(e._id)] || 0;
    return b >= a ? e : best;
  });
  const others = eventos.filter((e) => String(e._id) !== String(target._id));
  const otherIds = others.map((e) => e._id);

  console.log('Eventos encontrados:', eventos.length);
  eventos.forEach((e) => {
    const n = countByEvent[String(e._id)] || 0;
    const mark = e._id.equals(target._id) ? ' [ALVO]' : '';
    console.log('  -', e.label, '(_id:', e._id, ')', n, 'check-ins', mark);
  });

  const result = await Checkin.updateMany(
    { eventoId: { $in: otherIds } },
    { $set: { eventoId: target._id } }
  );
  console.log('\nCheck-ins atualizados:', result.modifiedCount, 'agora apontam para o evento alvo.');

  const deleteResult = await EventoCheckin.deleteMany({ _id: { $in: otherIds } });
  console.log('Eventos duplicados removidos:', deleteResult.deletedCount);

  const totalCheckins = await Checkin.countDocuments({ eventoId: target._id });
  console.log('\nTotal de check-ins no evento unificado:', totalCheckins);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
