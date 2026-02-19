/**
 * Conta quantas pessoas de cada ministério estão nas escalas Domingo 22/02 Manhã e Domingo 22/02 Tarde.
 * Também conta quantas estão nas 2 escalas.
 * Uso (na pasta server, com MONGODB_URI no .env):
 *   node scripts/escalas-por-ministerio.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Escala from '../models/Escala.js';
import Candidatura from '../models/Candidatura.js';

const mongoUri = (process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');

if (!mongoUri || !/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
  console.error('Defina MONGODB_URI no .env.');
  process.exit(1);
}

const NOMES_ESCALAS = ['Domingo 22/02 Manhã', 'Domingo 22/02 Tarde'];

async function main() {
  await mongoose.connect(mongoUri);

  // Busca escalas (match flexível por nome)
  const escalas = await Escala.find({
    nome: { $in: NOMES_ESCALAS },
  }).lean();

  if (escalas.length === 0) {
    // Tenta match parcial
    const parcial = await Escala.find({
      $or: [
        { nome: /Domingo\s*22\/?02\s*Manhã/i },
        { nome: /Domingo\s*22\/?02\s*Tarde/i },
      ],
    }).lean();
    if (parcial.length === 0) {
      console.log('Escalas "Domingo 22/02 Manhã" e "Domingo 22/02 Tarde" não encontradas.');
      const todas = await Escala.find({}).select('nome').lean();
      if (todas.length) {
        console.log('\nEscalas existentes:', todas.map((e) => e.nome).join(', '));
      }
      await mongoose.disconnect();
      return;
    }
    escalas.push(...parcial);
  }

  const escalaManha = escalas.find((e) => /manhã|manha/i.test(e.nome));
  const escalaTarde = escalas.find((e) => /tarde/i.test(e.nome));

  // Candidaturas aprovadas (considerando "estão na escala" = aprovado)
  const statusConsiderado = ['aprovado', 'pendente'];

  const result = { manha: {}, tarde: {}, manhaEmails: new Set(), tardeEmails: new Set() };

  if (escalaManha) {
    const cands = await Candidatura.find({
      escalaId: escalaManha._id,
      status: { $in: statusConsiderado },
    }).lean();
    cands.forEach((c) => {
      const min = (c.ministerio || '').trim() || '(sem ministério)';
      result.manha[min] = (result.manha[min] || 0) + 1;
      if (c.email) result.manhaEmails.add(c.email.toLowerCase());
    });
  }

  if (escalaTarde) {
    const cands = await Candidatura.find({
      escalaId: escalaTarde._id,
      status: { $in: statusConsiderado },
    }).lean();
    cands.forEach((c) => {
      const min = (c.ministerio || '').trim() || '(sem ministério)';
      result.tarde[min] = (result.tarde[min] || 0) + 1;
      if (c.email) result.tardeEmails.add(c.email.toLowerCase());
    });
  }

  const nasDuas = [...result.manhaEmails].filter((e) => result.tardeEmails.has(e));

  // Saída
  console.log('\n=== Domingo 22/02 Manhã ===');
  console.log('Escala:', escalaManha?.nome || 'não encontrada');
  const totalManha = Object.values(result.manha).reduce((a, b) => a + b, 0);
  console.log('Total:', totalManha);
  Object.entries(result.manha)
    .sort((a, b) => b[1] - a[1])
    .forEach(([min, qtd]) => console.log(`  ${min}: ${qtd}`));

  console.log('\n=== Domingo 22/02 Tarde ===');
  console.log('Escala:', escalaTarde?.nome || 'não encontrada');
  const totalTarde = Object.values(result.tarde).reduce((a, b) => a + b, 0);
  console.log('Total:', totalTarde);
  Object.entries(result.tarde)
    .sort((a, b) => b[1] - a[1])
    .forEach(([min, qtd]) => console.log(`  ${min}: ${qtd}`));

  console.log('\n=== Nas 2 escalas ===');
  console.log('Quantidade:', nasDuas.length);
  if (nasDuas.length > 0) {
    console.log('Emails:', nasDuas.slice(0, 20).join(', ') + (nasDuas.length > 20 ? ` (+${nasDuas.length - 20} mais)` : ''));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
