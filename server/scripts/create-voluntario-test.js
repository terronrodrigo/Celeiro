/**
 * Cria conta de voluntário para teste: rodrigo.terron@gmail.com / senha 123456
 * e perfil com dados sintéticos.
 *
 * Uso: node scripts/create-voluntario-test.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Voluntario from '../models/Voluntario.js';

const EMAIL = 'rodrigo.terron@gmail.com';
const SENHA = '123456';

const perfilSintetico = {
  nome: 'Rodrigo Terron',
  nascimento: new Date(1990, 4, 15), // 15/05/1990
  whatsapp: '(11) 98765-4321',
  pais: 'Brasil',
  estado: 'SP',
  cidade: 'São Paulo',
  evangelico: 'Sim',
  igreja: 'Igreja Celeiro São Paulo',
  tempoIgreja: '3 anos',
  voluntarioIgreja: 'Sim',
  ministerio: 'Streaming',
  disponibilidade: 'Domingos manhã',
  horasSemana: '2 a 4 horas',
  areas: ['Mídia', 'Streaming', 'Tecnologia'],
  fonte: 'manual',
  ativo: true,
};

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI não configurado no .env.');
  }
  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB conectado');

  const email = EMAIL.toLowerCase().trim();

  let user = await User.findOne({ email });
  if (user) {
    user.nome = perfilSintetico.nome;
    user.senha = SENHA;
    user.role = 'voluntario';
    user.ativo = true;
    await user.save();
    console.log('✅ Usuário atualizado:', email);
  } else {
    user = new User({
      email,
      nome: perfilSintetico.nome,
      senha: SENHA,
      role: 'voluntario',
      ativo: true,
    });
    await user.save();
    console.log('✅ Usuário criado:', email);
  }

  await Voluntario.findOneAndUpdate(
    { email },
    { $set: { ...perfilSintetico, email } },
    { upsert: true, new: true }
  );
  console.log('✅ Perfil voluntário criado/atualizado com dados sintéticos');

  console.log('\n📧 Login: rodrigo.terron@gmail.com');
  console.log('🔑 Senha: 123456');
  console.log('   (use no login do dashboard como voluntário)\n');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Erro:', err.message || err);
  process.exitCode = 1;
});
