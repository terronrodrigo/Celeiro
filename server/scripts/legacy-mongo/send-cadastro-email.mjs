/**
 * Envia email pedindo cadastro completo para voluntários que fizeram check-in
 * mas não têm perfil completo na plataforma.
 *
 * Uso (na pasta server):
 *   node scripts/send-cadastro-email.mjs --test          # envia APENAS para rodrigo.terron@gmail.com
 *   node scripts/send-cadastro-email.mjs --dry           # mostra quem receberia, sem enviar
 *   node scripts/send-cadastro-email.mjs --send          # envia para todos os elegíveis
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Resend } from 'resend';
import Checkin from '../../models/Checkin.js';
import Voluntario from '../../models/Voluntario.js';

const MODE = process.argv.includes('--send') ? 'send'
           : process.argv.includes('--test') ? 'test'
           : 'dry';

const mongoUri = (process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');
const resendKey = (process.env.RESEND_API_KEY || '').trim();
const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
const TEST_EMAIL = 'rodrigo.terron@gmail.com';

if (!resendKey) { console.error('RESEND_API_KEY não configurada.'); process.exit(1); }

// ── HTML do email ──────────────────────────────────────────────────────────────
function buildHtml(nome) {
  const nomeDisplay = (nome || '').trim() || 'voluntário(a)';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complete seu cadastro — Celeiro SP</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

          <!-- Header -->
          <tr>
            <td style="background:#1a1a2e;padding:32px 40px;text-align:center;">
              <p style="margin:0;font-size:13px;color:#f59e0b;text-transform:uppercase;letter-spacing:.1em;font-weight:600;">Igreja Celeiro São Paulo</p>
              <h1 style="margin:8px 0 0;font-size:24px;color:#ffffff;font-weight:700;">Equipe de Voluntários</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">
                Olá, <strong>${nomeDisplay}</strong>! 👋
              </p>

              <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">
                <strong>Obrigado por servir como voluntário no Celeiro São Paulo!</strong>
                Sua dedicação é fundamental para que o propósito de Deus se cumpra aqui.
              </p>

              <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">
                Recebemos o seu check-in — mas ainda não temos seus dados completos em nossa
                base de voluntários. Para que possamos te conhecer melhor e manter um registro
                organizado do time, pedimos que você crie sua conta na plataforma e preencha
                suas informações.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:32px auto;">
                <tr>
                  <td style="border-radius:8px;background:#f59e0b;">
                    <a href="https://voluntariosceleirosp.com/"
                       style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:700;color:#1a1a2e;text-decoration:none;border-radius:8px;letter-spacing:.02em;">
                      Criar minha conta agora →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">
                Após criar sua conta e fazer login, você poderá:
              </p>
              <ul style="margin:0 0 24px;padding-left:20px;color:#374151;font-size:15px;line-height:1.8;">
                <li>Acompanhar o histórico completo dos seus check-ins</li>
                <li>Manter seus dados de contato atualizados</li>
                <li>Ver os eventos e cultos disponíveis para voluntários</li>
              </ul>

              <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
                Ficamos felizes em ter você no time. Se tiver qualquer dúvida,
                é só responder este email.
              </p>
            </td>
          </tr>

          <!-- Signature -->
          <tr>
            <td style="padding:0 40px 40px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-left:3px solid #f59e0b;padding-left:16px;">
                    <p style="margin:0;font-size:15px;font-weight:700;color:#1a1a2e;">Com gratidão,</p>
                    <p style="margin:4px 0 0;font-size:14px;color:#6b7280;">Equipe Voluntários Celeiro São Paulo</p>
                    <p style="margin:4px 0 0;font-size:13px;color:#9ca3af;">
                      <a href="https://voluntariosceleirosp.com/" style="color:#f59e0b;text-decoration:none;">voluntariosceleirosp.com</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                Você recebeu este email porque realizou um check-in como voluntário no Celeiro SP.<br>
                Igreja Celeiro São Paulo · São Paulo, SP
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Lógica principal ───────────────────────────────────────────────────────────
async function main() {
  if (!mongoUri || !/^mongodb/.test(mongoUri)) {
    console.error('MONGODB_URI inválida ou ausente.');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);

  // Emails únicos que fizeram check-in
  const checkinsRaw = await Checkin.aggregate([
    { $group: { _id: { $toLower: '$email' }, nome: { $first: '$nome' } } },
    { $match: { _id: { $ne: null, $ne: '' } } },
  ]);

  // Voluntarios com perfil cadastrado (email preenchido)
  const perfisExistentes = await Voluntario.find({
    email: { $exists: true, $ne: '' },
    nome: { $exists: true, $ne: '' },
  }).select('email').lean();
  const emailsComPerfil = new Set(perfisExistentes.map(v => (v.email || '').toLowerCase().trim()));

  // Sem perfil: fez check-in mas não tem Voluntario com nome preenchido
  const semPerfil = checkinsRaw
    .filter(c => c._id && !emailsComPerfil.has(c._id.trim()))
    .map(c => ({ email: c._id.trim(), nome: (c.nome || '').trim() }))
    .sort((a, b) => a.email.localeCompare(b.email));

  console.log(`Check-ins únicos: ${checkinsRaw.length}`);
  console.log(`Com perfil cadastrado: ${emailsComPerfil.size}`);
  console.log(`Sem perfil (elegíveis): ${semPerfil.length}`);

  if (MODE === 'dry') {
    console.log('\n— Lista (dry-run) —');
    semPerfil.forEach(v => console.log(`  ${v.email}  (${v.nome || 'sem nome'})`));
    await mongoose.disconnect();
    return;
  }

  const resend = new Resend(resendKey);
  const targets = MODE === 'test' ? [{ email: TEST_EMAIL, nome: 'Rodrigo (teste)' }] : semPerfil;

  console.log(`\nEnviando para ${targets.length} destinatário(s)…`);
  let ok = 0, fail = 0;
  for (const v of targets) {
    try {
      const { error } = await resend.emails.send({
        from,
        to: v.email,
        reply_to: replyTo,
        subject: 'Complete seu cadastro — Voluntários Celeiro SP',
        html: buildHtml(v.nome),
      });
      if (error) throw new Error(error.message || JSON.stringify(error));
      console.log(`  ✅ ${v.email}`);
      ok++;
    } catch (e) {
      console.error(`  ❌ ${v.email}: ${e.message}`);
      fail++;
    }
    if (targets.length > 1) await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nResultado: ${ok} enviados, ${fail} falhas.`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
