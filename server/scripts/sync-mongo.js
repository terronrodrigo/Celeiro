import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import { parse } from 'csv-parse/sync';
import Voluntario from '../models/Voluntario.js';
import Checkin from '../models/Checkin.js';
import { normalizarEstado, normalizarCidade } from '../utils/normalize-locale.js';

const VOLUNTARIOS_CSV_PATH = (process.env.VOLUNTARIOS_CSV_PATH || '').trim();
const CHECKIN_CSV_PATH = (process.env.CHECKIN_CSV_PATH || '').trim();
const CSV_URL = process.env.GOOGLE_SHEETS_CSV_URL ||
  'https://docs.google.com/spreadsheets/d/1uTgaI8Ct_rPr1KwyDOPCH5SLqdzv0Bwxog0B9k-PbPo/export?format=csv&gid=1582636562';

const COLS = {
  timestamp: ['Carimbo', 'data/hora'],
  email: ['Endereço de e-mail', 'E-mail', 'e-mail'],
  nome: ['Nome completo', 'sem abreviações'],
  nascimento: ['Data de nascimento', 'nascimento'],
  whatsapp: ['WhatsApp', 'Número do WhatsApp'],
  pais: ['País'],
  estado: ['Estado', 'Província', 'Região'],
  cidade: ['Cidade'],
  evangelico: ['Cristão', 'Protestante', 'Evangélico'],
  igreja: ['igreja onde congrega', 'Nome da igreja'],
  tempo_igreja: ['quanto tempo frequenta'],
  voluntario_igreja: ['voluntário em sua igreja', 'Já serve como voluntário'],
  ministerio: ['qual ministério serve', 'ministério serve'],
  disponibilidade: ['disponibilidade'],
  horas_semana: ['Horas que pode', 'horas por semana'],
  areas: ['áreas gostaria de servir', 'Em quais áreas'],
};

const CHECKIN_COLS = {
  timestamp: ['Carimbo', 'data/hora'],
  email: ['Endereço de e-mail', 'E-mail', 'e-mail'],
  nome: ['Nome completo', 'nome completo'],
  ministerio: ['ministério', 'ministerio', 'servir hoje'],
};

function parseDatePtBr(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const match = v.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function dateOnlyFromMs(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function findColIndex(headers, key, cols) {
  const terms = cols[key];
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || '').toLowerCase();
    if (terms.some(t => h.includes(t.toLowerCase()))) return i;
  }
  return -1;
}

function buildColMap(headers, cols) {
  const colMap = {};
  Object.keys(cols).forEach(k => { colMap[k] = findColIndex(headers, k, cols); });
  return colMap;
}

function parseCsvRows(text) {
  return parse(text, { relax_column_count: true, skip_empty_lines: true, trim: true });
}

function readCsvTextFromSource({ path, url }) {
  if (path) {
    if (!fs.existsSync(path)) {
      throw new Error(`CSV não encontrado: ${path}. Verifique o caminho.`);
    }
    return fs.readFileSync(path, 'utf8');
  }
  if (!url) throw new Error('CSV não configurado.');
  return fetch(url, { headers: { 'User-Agent': 'CeleiroDashboard/1.0' } }).then(async (r) => {
    if (!r.ok) throw new Error(`Planilha não acessível (HTTP ${r.status}).`);
    return r.text();
  });
}

function rowToVoluntario(headers, row, colMap) {
  const get = (key) => {
    const i = colMap[key];
    return i >= 0 && row[i] !== undefined ? String(row[i]).trim() : '';
  };
  const email = get('email');
  if (!email || !email.includes('@')) return null;
  const timestamp = get('timestamp');
  const timestampMs = parseDatePtBr(timestamp);
  const nascimento = get('nascimento');
  const nascimentoMs = parseDatePtBr(nascimento);
  return {
    email: email.toLowerCase(),
    nome: get('nome'),
    nascimento: nascimentoMs ? new Date(nascimentoMs) : undefined,
    whatsapp: get('whatsapp'),
    pais: get('pais'),
    estado: normalizarEstado(get('estado')),
    cidade: normalizarCidade(get('cidade')),
    evangelico: get('evangelico'),
    igreja: get('igreja'),
    tempoIgreja: get('tempo_igreja'),
    voluntarioIgreja: get('voluntario_igreja'),
    ministerio: get('ministerio'),
    disponibilidade: get('disponibilidade'),
    horasSemana: get('horas_semana'),
    areas: get('areas').split(',').map(a => a.trim()).filter(Boolean),
    timestamp: timestampMs ? new Date(timestampMs) : undefined,
    timestampMs,
  };
}

function rowToCheckin(headers, row, colMap) {
  const get = (key) => {
    const i = colMap[key];
    return i >= 0 && row[i] !== undefined ? String(row[i]).trim() : '';
  };
  const email = get('email');
  if (!email || !email.includes('@')) return null;
  const timestamp = get('timestamp');
  const timestampMs = parseDatePtBr(timestamp);
  return {
    email: email.toLowerCase(),
    nome: get('nome'),
    ministerio: get('ministerio'),
    timestamp: timestampMs ? new Date(timestampMs) : undefined,
    timestampMs,
    dataCheckin: dateOnlyFromMs(timestampMs),
  };
}

async function syncVoluntarios() {
  const text = await readCsvTextFromSource({
    path: VOLUNTARIOS_CSV_PATH,
    url: VOLUNTARIOS_CSV_PATH ? '' : CSV_URL,
  });
  const rows = parseCsvRows(text);
  if (!rows.length) return { inserted: 0, updated: 0 };
  const headers = rows[0].map(h => (h || '').trim());
  const colMap = buildColMap(headers, COLS);
  const voluntarios = rows.slice(1).map(row => rowToVoluntario(headers, row, colMap)).filter(Boolean);
  const byEmail = new Map();
  voluntarios.forEach(v => byEmail.set(v.email.toLowerCase(), v));
  const unique = Array.from(byEmail.values());

  const operations = unique.map(doc => ({
    updateOne: {
      filter: { email: doc.email.toLowerCase() },
      update: { $set: doc },
      upsert: true,
    }
  }));
  const result = await Voluntario.bulkWrite(operations, { ordered: false });
  return { inserted: result.upsertedCount || 0, updated: result.modifiedCount || 0 };
}

/** Normaliza estado (UF) e cidade em todos os voluntários já no banco. */
async function normalizarVoluntariosExistentes() {
  const cursor = Voluntario.find({}).select('_id estado cidade').lean();
  const updates = [];
  for await (const doc of cursor) {
    const novoEstado = normalizarEstado(doc.estado);
    const novaCidade = normalizarCidade(doc.cidade);
    if (novoEstado !== (doc.estado || '') || novaCidade !== (doc.cidade || '')) {
      updates.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { estado: novoEstado, cidade: novaCidade } },
        },
      });
    }
  }
  if (!updates.length) return { normalized: 0 };
  await Voluntario.bulkWrite(updates, { ordered: false });
  return { normalized: updates.length };
}

async function syncCheckins() {
  if (!CHECKIN_CSV_PATH) {
    return { inserted: 0, updated: 0, skipped: true };
  }
  const text = await readCsvTextFromSource({
    path: CHECKIN_CSV_PATH,
    url: '',
  });
  const rows = parseCsvRows(text);
  if (!rows.length) return { inserted: 0, updated: 0 };
  const headers = rows[0].map(h => (h || '').trim());
  const colMap = buildColMap(headers, CHECKIN_COLS);
  const checkins = rows.slice(1).map(row => rowToCheckin(headers, row, colMap)).filter(Boolean);

  const byKey = new Map();
  checkins.forEach(c => {
    const key = `${c.email}-${c.ministerio}-${c.timestamp_ms || 0}`;
    byKey.set(key, c);
  });
  const unique = Array.from(byKey.values());

  const operations = unique.map(doc => ({
    updateOne: {
      filter: { email: doc.email, ministerio: doc.ministerio, timestampMs: doc.timestampMs },
      update: { $set: doc },
      upsert: true,
    }
  }));
  const result = await Checkin.bulkWrite(operations, { ordered: false });
  return { inserted: result.upsertedCount || 0, updated: result.modifiedCount || 0 };
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI não configurado no .env.');
  }
  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB conectado');

  const vol = await syncVoluntarios();
  const norm = await normalizarVoluntariosExistentes();
  const chk = await syncCheckins();
  console.log('✅ Voluntários:', vol);
  if (norm.normalized) console.log('✅ Normalização estado/cidade:', norm.normalized, 'registros');
  console.log('✅ Check-ins:', chk);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Erro na sincronização:', err.message || err);
  process.exitCode = 1;
});
