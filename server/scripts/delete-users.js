/**
 * Remove usuários do MongoDB por email (produção ou local).
 *
 * Uso:
 *   node scripts/delete-users.js email1@x.com email2@y.com
 * Ou com .env na pasta server (MONGODB_URI):
 *   node scripts/delete-users.js email1@x.com email2@y.com
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';

const emails = process.argv.slice(2).filter((e) => e && e.includes('@'));
const mongoUri = (process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');

if (!mongoUri || !/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
  console.error('Defina MONGODB_URI no .env (deve começar com mongodb:// ou mongodb+srv://).');
  process.exit(1);
}
if (emails.length === 0) {
  console.error('Uso: node scripts/delete-users.js <email1> <email2> ...');
  process.exit(1);
}

async function main() {
  await mongoose.connect(mongoUri);
  const normalized = emails.map((e) => e.toLowerCase().trim());
  const deleted = await User.deleteMany({ email: { $in: normalized } });
  console.log('Removidos:', deleted.deletedCount, 'usuário(s). Emails:', normalized.join(', '));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
