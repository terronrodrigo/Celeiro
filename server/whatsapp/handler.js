/**
 * Handler do webhook WhatsApp - verificação e processamento de mensagens.
 * Meta Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import crypto from 'crypto';
import { processMessage } from './agent.js';

const WHATSAPP_TOKEN = (process.env.WHATSAPP_TOKEN || '').trim();
const WHATSAPP_PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const WHATSAPP_VERIFY_TOKEN = (process.env.WHATSAPP_VERIFY_TOKEN || 'celeiro-webhook').trim();

function verifySignature(payload, signature) {
  if (!WHATSAPP_TOKEN || !signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', WHATSAPP_TOKEN).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
}

async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.warn('WhatsApp: WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurado');
    return;
  }
  const phoneId = to.replace(/\D/g, '');
  const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneId,
      type: 'text',
      text: { body: text, preview_url: false },
    }),
  });
}

/** Cria o handler do webhook. Recebe createAuthToken para integrar com authTokens do servidor. */
export function createWhatsAppHandler({ createAuthTokenForUser }) {
  return {
    handleVerify(req, res) {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
        res.status(200).send(challenge);
      } else {
        res.status(403).send('Forbidden');
      }
    },

    async handleWebhook(req, res) {
      res.status(200).send('OK');
      const rawBody = req.body;
      const rawStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : (typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));
      const signature = req.headers['x-hub-signature-256'];
      if (signature && WHATSAPP_TOKEN && !verifySignature(rawStr, signature)) {
        console.warn('WhatsApp webhook: assinatura inválida');
        return;
      }
      const body = typeof rawBody === 'object' && !Buffer.isBuffer(rawBody) ? rawBody : JSON.parse(rawStr);
      const entries = body?.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field !== 'messages') continue;
          const value = change.value || {};
          const messages = value.messages || [];
          const contacts = value.contacts || [];
          const fromContact = (id) => (contacts.find((c) => c.wa_id === id) || {}).profile?.name || id;
          for (const msg of messages) {
            if (msg.type !== 'text') continue;
            const from = msg.from;
            const text = msg.text?.body || '';
            try {
              const sendCode = async (phone, code) => {
                await sendWhatsAppText(phone, `Seu código de acesso ao Celeiro: *${code}*\nVálido por 10 minutos.`);
              };
              const reply = await processMessage(from, text, sendCode, createAuthTokenForUser);
              if (reply) await sendWhatsAppText(from, reply);
            } catch (err) {
              console.error('WhatsApp agent error:', err);
              await sendWhatsAppText(from, 'Ocorreu um erro. Tente novamente em instantes.');
            }
          }
        }
      }
    },
  };
}
