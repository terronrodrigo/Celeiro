/**
 * Envia um email de teste via Resend para verificar se RESEND_API_KEY e RESEND_FROM_EMAIL estão ok.
 * Uso: cd server && node scripts/send-test-email.js
 * Destino padrão: rodrigo.terron@gmail.com (pode passar outro como argumento: node scripts/send-test-email.js outro@email.com)
 */
import 'dotenv/config';
import { Resend } from 'resend';

const to = process.argv[2] || 'rodrigo.terron@gmail.com';
const apiKey = (process.env.RESEND_API_KEY || '').trim();
const from = (process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>').trim();
const replyTo = (process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com').trim();

if (!apiKey) {
  console.error('Erro: RESEND_API_KEY não está definida no .env');
  process.exit(1);
}

const resend = new Resend(apiKey);

async function main() {
  console.log('Enviando email de teste para', to, '...');
  const { data, error } = await resend.emails.send({
    from,
    to,
    reply_to: replyTo,
    subject: 'Teste Resend - Celeiro SP',
    html: '<p>Este é um email de teste do dashboard Celeiro SP.</p><p>Se você recebeu, o Resend está configurado corretamente.</p><p>— Celeiro SP</p>',
  });
  if (error) {
    console.error('Falha ao enviar:', error.message);
    process.exit(1);
  }
  console.log('Enviado com sucesso. ID:', data?.id);
}

main();
