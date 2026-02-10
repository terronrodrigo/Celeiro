#!/usr/bin/env node
/**
 * Atualiza a estrutura do banco MongoDB:
 * - Sincroniza índices de todos os modelos (cria os que faltam, remove os obsoletos).
 * Execute após deploy ou ao alterar schemas: node server/scripts/update-db.js
 * Requer MONGODB_URI no .env ou no ambiente.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Voluntario from '../models/Voluntario.js';
import Checkin from '../models/Checkin.js';
import EventoCheckin from '../models/EventoCheckin.js';
import Ministerio from '../models/Ministerio.js';
import RoleHistory from '../models/RoleHistory.js';

const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
if (!MONGODB_URI) {
  console.error('Defina MONGODB_URI no .env ou no ambiente.');
  process.exit(1);
}

const models = [
  { name: 'User', model: User },
  { name: 'Voluntario', model: Voluntario },
  { name: 'Checkin', model: Checkin },
  { name: 'EventoCheckin', model: EventoCheckin },
  { name: 'Ministerio', model: Ministerio },
  { name: 'RoleHistory', model: RoleHistory },
];

async function main() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Conectado ao MongoDB.');
    for (const { name, model } of models) {
      await model.syncIndexes();
      console.log(`  Índices sincronizados: ${name}`);
    }
    console.log('Estrutura do banco atualizada.');
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();
