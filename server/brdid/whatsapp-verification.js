/**
 * Webhook BR DID – recebe código de verificação do WhatsApp.
 * API: https://brdid.com.br/api-docs/
 * Endpoint whatsapp_configurar envia POST com dados da chamada e url_audio.
 */

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

/** Último payload recebido (em memória). Para produção, considerar persistir em DB. */
let lastVerification = null;

/**
 * Extrai sequência de 6 dígitos de um texto (código WhatsApp).
 */
function extractCode(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.replace(/\s/g, '').match(/\b(\d{6})\b/) || text.match(/(\d{6})/);
  return match ? match[1] : null;
}

/**
 * Tenta extrair o código do áudio usando OpenAI Whisper.
 */
async function extractCodeFromAudio(audioUrl) {
  if (!OPENAI_API_KEY || !audioUrl) return null;
  try {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) return null;
    const audioBuffer = await audioRes.arrayBuffer();
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer]), 'audio.ogg');
    formData.append('model', 'whisper-1');
    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    });
    if (!whisperRes.ok) return null;
    const data = await whisperRes.json();
    const text = data?.text || '';
    return extractCode(text);
  } catch (err) {
    console.error('BR DID: erro ao transcrever áudio:', err.message);
    return null;
  }
}

/**
 * Processa o payload recebido do BR DID.
 * Retorna { codigo, url_audio, numero, recebidoEm, ... }
 */
export async function processBrdidWebhook(payload) {
  const receivedAt = new Date().toISOString();
  const urlAudio = payload?.url_audio || payload?.url_retorno || payload?.audio_url;
  const numero = payload?.numero || payload?.numero_did || payload?.numeroDid;
  let codigo = payload?.codigo || payload?.codigo_verificacao || extractCode(JSON.stringify(payload));
  if (!codigo && urlAudio) {
    codigo = await extractCodeFromAudio(urlAudio);
  }
  const result = {
    ...payload,
    recebidoEm: receivedAt,
    url_audio: urlAudio,
    numero,
    codigo_extraido: codigo,
  };
  lastVerification = result;
  return result;
}

/**
 * Retorna o último payload recebido (para o admin consultar o código).
 */
export function getLastVerification() {
  return lastVerification;
}
