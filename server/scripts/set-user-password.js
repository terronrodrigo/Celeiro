/**
 * Define uma nova senha (hasheada) para um usuário por email.
 * Use após migrar dados para prod se as senhas estavam em texto plano.
 *
 * Uso:
 *   MONGODB_URI="mongodb+srv://..." node scripts/set-user-password.js email@exemplo.com NovaSenha123
 * Ou com .env:
 *   node scripts/set-user-password.js email@exemplo.com NovaSenha123
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';

const email = process.argv[2];
const novaSenha = process.argv[3];
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('Defina MONGODB_URI no .env ou na linha de comando.');
  process.exit(1);
}
if (!email || !novaSenha) {
  console.error('Uso: node scripts/set-user-password.js <email> <novaSenha>');
  process.exit(1);
}

async function main() {
  await mongoose.connect(mongoUri);
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error('Usuário não encontrado:', email);
    process.exit(1);
  }
  user.senha = novaSenha;
  await user.save();
  console.log('Senha atualizada para:', email);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
