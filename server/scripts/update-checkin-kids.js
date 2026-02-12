/**
 * Atualiza todos os check-ins cujo campo ministerio contém "kids" (case insensitive)
 * para o valor "Kids / Min. Infantil".
 *
 * Uso (com MONGODB_URI no .env da pasta server):
 *   node scripts/update-checkin-kids.js
 *
 * Ou com URI explícita:
 *   MONGODB_URI="mongodb+srv://..." node scripts/update-checkin-kids.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Checkin from '../models/Checkin.js';

const mongoUri = (process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');

if (!mongoUri || !/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
  console.error('Defina MONGODB_URI no .env (deve começar com mongodb:// ou mongodb+srv://).');
  process.exit(1);
}

const TARGET_MINISTERIO = 'Kids / Min. Infantil';

async function main() {
  await mongoose.connect(mongoUri);
  const result = await Checkin.updateMany(
    { ministerio: /kids/i },
    { $set: { ministerio: TARGET_MINISTERIO } }
  );
  console.log('Check-ins atualizados:', result.modifiedCount, '(total matched:', result.matchedCount, ')');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
