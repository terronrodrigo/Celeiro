#!/usr/bin/env node
/**
 * Cria igrejas Celeiro SP + Inc SP e preenche igrejaId em todas as coleções (dados legados → Celeiro).
 * Execute UMA VEZ após deploy com os novos models:
 *   cd server && MONGODB_URI="..." node scripts/migrate-multi-igreja.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Igreja from '../models/Igreja.js';
import Ministerio from '../models/Ministerio.js';
import User from '../models/User.js';
import Escala from '../models/Escala.js';
import Candidatura from '../models/Candidatura.js';
import EventoCheckin from '../models/EventoCheckin.js';
import Checkin from '../models/Checkin.js';
import EventoFormulario from '../models/EventoFormulario.js';
import FormularioMembro from '../models/FormularioMembro.js';
import FormularioBatismo from '../models/FormularioBatismo.js';
import FormularioApresentacao from '../models/FormularioApresentacao.js';
import Voluntario from '../models/Voluntario.js';
import RoleHistory from '../models/RoleHistory.js';

const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
if (!MONGODB_URI) {
  console.error('Defina MONGODB_URI.');
  process.exit(1);
}

async function upsertIgreja(nome, slug) {
  let doc = await Igreja.findOne({ slug }).lean();
  if (doc) return doc;
  const created = await Igreja.create({ nome, slug, ativo: true });
  console.log(`  Igreja criada: ${nome} (${slug})`);
  return created.toObject();
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Conectado.');

  const celeiro = await upsertIgreja('Celeiro São Paulo', 'celeiro-sp');
  await upsertIgreja('Inc São Paulo', 'inc-sp');
  const celeiroId = celeiro._id;

  const set = { $set: { igrejaId: celeiroId } };

  const run = async (label, fn) => {
    const r = await fn();
    console.log(`  ${label}: ${JSON.stringify(r)}`);
  };

  await run('Ministerio', () => Ministerio.updateMany({ igrejaId: { $exists: false } }, set));
  await run('Escala', () => Escala.updateMany({ igrejaId: { $exists: false } }, set));
  await run('EventoCheckin', () => EventoCheckin.updateMany({ igrejaId: { $exists: false } }, set));
  await run('EventoFormulario', () => EventoFormulario.updateMany({ igrejaId: { $exists: false } }, set));
  await run('FormularioMembro', () => FormularioMembro.updateMany({ igrejaId: { $exists: false } }, set));
  await run('Voluntario', () => Voluntario.updateMany({ igrejaId: { $exists: false } }, set));
  await run('RoleHistory', () => RoleHistory.updateMany({ igrejaId: { $exists: false } }, { $set: { igrejaId: celeiroId } }));

  // Líderes e voluntários: sempre Celeiro no legado. Admins globais ficam sem igreja (null).
  await run('User (lider/voluntario)', () =>
    User.updateMany(
      { role: { $in: ['lider', 'voluntario'] }, $or: [{ igrejaId: null }, { igrejaId: { $exists: false } }] },
      set,
    ));

  // Check-ins: herdam igreja do evento quando possível
  const eventos = await EventoCheckin.find({}).select('_id igrejaId').lean();
  const evMap = new Map(eventos.map((e) => [String(e._id), e.igrejaId]));
  let chkUp = 0;
  for await (const c of Checkin.find({ $or: [{ igrejaId: null }, { igrejaId: { $exists: false } }] }).cursor()) {
    let gid = c.eventoId ? evMap.get(String(c.eventoId)) : null;
    if (!gid) gid = celeiroId;
    await Checkin.updateOne({ _id: c._id }, { $set: { igrejaId: gid } });
    chkUp++;
  }
  console.log(`  Checkin (por evento ou celeiro): { modified: ${chkUp} }`);

  // Candidaturas: igreja da escala
  const escalas = await Escala.find({}).select('_id igrejaId').lean();
  const escMap = new Map(escalas.map((e) => [String(e._id), e.igrejaId]));
  let candUp = 0;
  for await (const c of Candidatura.find({ $or: [{ igrejaId: null }, { igrejaId: { $exists: false } }] }).cursor()) {
    const gid = escMap.get(String(c.escalaId)) || celeiroId;
    await Candidatura.updateOne({ _id: c._id }, { $set: { igrejaId: gid } });
    candUp++;
  }
  console.log(`  Candidatura: { modified: ${candUp} }`);

  const evForm = await EventoFormulario.find({}).select('_id igrejaId').lean();
  const efMap = new Map(evForm.map((e) => [String(e._id), e.igrejaId]));
  let fb = 0;
  for await (const d of FormularioBatismo.find({ $or: [{ igrejaId: null }, { igrejaId: { $exists: false } }] }).cursor()) {
    const gid = efMap.get(String(d.eventoId)) || celeiroId;
    await FormularioBatismo.updateOne({ _id: d._id }, { $set: { igrejaId: gid } });
    fb++;
  }
  console.log(`  FormularioBatismo: { modified: ${fb} }`);
  let fa = 0;
  for await (const d of FormularioApresentacao.find({ $or: [{ igrejaId: null }, { igrejaId: { $exists: false } }] }).cursor()) {
    const gid = efMap.get(String(d.eventoId)) || celeiroId;
    await FormularioApresentacao.updateOne({ _id: d._id }, { $set: { igrejaId: gid } });
    fa++;
  }
  console.log(`  FormularioApresentacao: { modified: ${fa} }`);

  console.log('\nOK. Rode também: cd server && npm run update-db');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
