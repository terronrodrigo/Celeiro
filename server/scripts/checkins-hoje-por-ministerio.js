/**
 * Lista quantidade de check-ins de hoje por ministério (data em Brasília).
 * Uso (na pasta server, com MONGODB_URI no .env):
 *   node scripts/checkins-hoje-por-ministerio.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Checkin from '../models/Checkin.js';

const TZ_BRASILIA = 'America/Sao_Paulo';
const mongoUri = (process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');

if (!mongoUri || !/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
  console.error('Defina MONGODB_URI no .env (deve começar com mongodb:// ou mongodb+srv://).');
  process.exit(1);
}

function getHojeDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
}

async function main() {
  await mongoose.connect(mongoUri);
  const hojeStr = getHojeDateString();

  const result = await Checkin.aggregate([
    {
      $match: {
        $expr: {
          $eq: [
            { $dateToString: { date: '$dataCheckin', format: '%Y-%m-%d', timezone: TZ_BRASILIA } },
            hojeStr,
          ],
        },
      },
    },
    { $group: { _id: { $ifNull: ['$ministerio', '(sem ministério)'] }, total: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);

  const total = result.reduce((acc, r) => acc + r.total, 0);
  console.log('Check-ins hoje (' + hojeStr + ' – Brasília):', total);
  console.log('');
  console.log('Pessoas por ministério:');
  console.log('----------------------');
  result.forEach((r) => {
    const nome = (r._id || '(vazio)').trim() || '(vazio)';
    console.log('  ' + nome + ': ' + r.total);
  });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
