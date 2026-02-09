/**
 * Cria um usuário admin no banco (para uso após deploy ou quando não usar a tela de setup).
 *
 * Uso:
 *   MONGODB_URI="mongodb+srv://..." node scripts/create-admin.js email@admin.com "Nome do Admin" "SenhaSegura123"
 * Ou com .env na pasta server:
 *   node scripts/create-admin.js email@admin.com "Nome" "Senha"
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';

const email = process.argv[2];
const nome = process.argv[3];
const senha = process.argv[4];
const mongoUri = (process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');

if (!mongoUri || !/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
  console.error('Defina MONGODB_URI no .env (deve começar com mongodb:// ou mongodb+srv://).');
  process.exit(1);
}
if (!email || !email.includes('@')) {
  console.error('Uso: node scripts/create-admin.js <email> <nome> <senha>');
  process.exit(1);
}
if (!nome) {
  console.error('Nome é obrigatório.');
  process.exit(1);
}
if (!senha || senha.length < 6) {
  console.error('Senha é obrigatória e deve ter no mínimo 6 caracteres.');
  process.exit(1);
}

async function main() {
  await mongoose.connect(mongoUri);
  let user = await User.findOne({ email: email.toLowerCase() });
  if (user) {
    if (user.role === 'admin') {
      console.log('Admin já existe com este email. Para trocar a senha use: node scripts/set-user-password.js', email, '<novaSenha>');
      process.exit(0);
      return;
    }
    user.role = 'admin';
    user.nome = nome;
    user.senha = senha;
    await user.save();
    console.log('Usuário atualizado para admin:', email);
  } else {
    user = new User({ email: email.toLowerCase(), nome, senha, role: 'admin' });
    await user.save();
    console.log('Admin criado:', email);
  }
  console.log('Faça login no dashboard com este email e senha. Depois você pode trocar a senha em Perfil.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
