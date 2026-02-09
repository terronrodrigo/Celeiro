/**
 * Copia dados do banco local/de testes para o MongoDB de produção.
 * Útil para subir check-ins e outros dados criados em testes locais.
 *
 * Uso:
 *   MONGODB_URI_SOURCE="mongodb://localhost:27017/celeiro" MONGODB_URI="mongodb+srv://...prod..." node scripts/copy-to-prod.js
 * Ou com .env: coloque MONGODB_URI_SOURCE (local) e MONGODB_URI (prod) e rode:
 *   node scripts/copy-to-prod.js
 *
 * Coleções copiadas: checkins, eventocheckins, voluntarios (upsert por _id).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Checkin from '../models/Checkin.js';
import EventoCheckin from '../models/EventoCheckin.js';
import Voluntario from '../models/Voluntario.js';

function getUri(envVar, label) {
  let uri = (process.env[envVar] || '').trim().replace(/^["']|["']$/g, '');
  if (!uri || !/^mongodb(\+srv)?:\/\//i.test(uri)) {
    throw new Error(`${label} (${envVar}) deve ser uma URI MongoDB válida.`);
  }
  return uri;
}

async function copyCollection(Model, name) {
  const sourceConn = mongoose.createConnection(process.env.MONGODB_URI_SOURCE);
  const SourceModel = sourceConn.model(Model.modelName, Model.schema);
  const docs = await SourceModel.find({}).lean();
  sourceConn.close();

  if (docs.length === 0) {
    console.log(`  ${name}: 0 documentos (nada para copiar)`);
    return { copied: 0 };
  }

  const destConn = mongoose.createConnection(process.env.MONGODB_URI);
  const DestModel = destConn.model(Model.modelName, Model.schema);

  const ops = docs.map((doc) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: { $set: doc },
      upsert: true,
    },
  }));
  const result = await DestModel.bulkWrite(ops, { ordered: false });
  destConn.close();

  const copied = result.upsertedCount + result.modifiedCount;
  console.log(`  ${name}: ${docs.length} lidos, ${copied} escritos (${result.upsertedCount || 0} novos, ${result.modifiedCount || 0} atualizados)`);
  return { copied };
}

async function main() {
  const sourceUri = getUri('MONGODB_URI_SOURCE', 'Origem (local/testes)');
  const destUri = getUri('MONGODB_URI', 'Destino (produção)');
  if (sourceUri === destUri) {
    throw new Error('Use URIs diferentes para origem e destino.');
  }
  process.env.MONGODB_URI_SOURCE = sourceUri;
  process.env.MONGODB_URI = destUri;

  console.log('Copiando dados: origem → produção');
  await copyCollection(Checkin, 'checkins');
  await copyCollection(EventoCheckin, 'eventos-checkin');
  await copyCollection(Voluntario, 'voluntarios');
  console.log('Concluído.');
}

main().catch((err) => {
  console.error('Erro:', err.message || err);
  process.exit(1);
});
