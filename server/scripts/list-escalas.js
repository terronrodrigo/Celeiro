/**
 * Lista todas as escalas no banco.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Escala from '../models/Escala.js';
import Candidatura from '../models/Candidatura.js';

const mongoUri = (process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');
if (!mongoUri) {
  console.error('MONGODB_URI não definida.');
  process.exit(1);
}

async function main() {
  await mongoose.connect(mongoUri);
  const escalas = await Escala.find({}).select('nome data').sort({ createdAt: -1 }).lean();
  console.log('Escalas no banco:', escalas.length);
  escalas.forEach((e, i) => {
    const data = e.data ? new Date(e.data).toLocaleDateString('pt-BR') : '-';
    console.log(`  ${i + 1}. "${e.nome}" (data: ${data})`);
  });
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
