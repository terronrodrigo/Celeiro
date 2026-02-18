/** Sessões do agente WhatsApp: whatsappId -> { userId, token, role, ... } */
const sessions = new Map();

/** Códigos de login pendentes: email -> { code, expiresAt, whatsappId } */
const loginCodes = new Map();

const CODE_TTL_MS = 10 * 60 * 1000; // 10 min
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function getSession(whatsappId) {
  const key = normalizePhone(whatsappId);
  const s = sessions.get(key);
  if (!s) return null;
  if (Date.now() > (s.expiresAt || 0)) {
    sessions.delete(key);
    return null;
  }
  return s;
}

export function setSession(whatsappId, data) {
  const key = normalizePhone(whatsappId);
  sessions.set(key, {
    ...data,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
}

export function clearSession(whatsappId) {
  sessions.delete(normalizePhone(whatsappId));
}

export function createLoginCode(email, whatsappId) {
  const code = generateCode();
  const key = (email || '').trim().toLowerCase();
  if (!key) return null;
  loginCodes.set(key, {
    code,
    whatsappId: normalizePhone(whatsappId),
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return code;
}

export function verifyLoginCode(emailOrWhatsappId, code) {
  const codeStr = String(code || '').trim();
  for (const [email, data] of loginCodes) {
    if (data.code === codeStr && Date.now() <= data.expiresAt) {
      if (!emailOrWhatsappId || data.whatsappId === normalizePhone(emailOrWhatsappId)) {
        loginCodes.delete(email);
        return { email, whatsappId: data.whatsappId };
      }
    }
  }
  return null;
}

export { normalizePhone };
