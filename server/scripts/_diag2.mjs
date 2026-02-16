import 'dotenv/config';
import mongoose from 'mongoose';
import Checkin from '../models/Checkin.js';

const TZ = 'America/Sao_Paulo';
await mongoose.connect(process.env.MONGODB_URI);

const all = await Checkin.find({}).lean();

// Amostra dos valores brutos de dataCheckin distintos
const distinct = new Map();
all.forEach(c => {
  const raw = c.dataCheckin ? new Date(c.dataCheckin).toISOString() : 'null';
  if (!distinct.has(raw)) distinct.set(raw, 0);
  distinct.set(raw, distinct.get(raw) + 1);
});

console.log('=== Valores distintos de dataCheckin (raw UTC) ===');
[...distinct.entries()].sort().forEach(([raw, n]) => {
  const brt = raw !== 'null' ? new Date(raw).toLocaleDateString('pt-BR', { timeZone: TZ }) : 'null';
  const utcDate = raw.slice(0, 10);
  console.log(`  ${raw}  →  BRT: ${brt}  |  UTC date: ${utcDate}  |  count: ${n}`);
});

// Mostrar os 5 registros mais recentes com todos os campos de data
console.log('\n=== 5 check-ins mais recentes (por timestampMs) ===');
const recent = all
  .filter(c => c.timestampMs)
  .sort((a, b) => b.timestampMs - a.timestampMs)
  .slice(0, 5);
recent.forEach(c => {
  const ts = new Date(c.timestampMs);
  const dc = c.dataCheckin ? new Date(c.dataCheckin) : null;
  console.log(`  ${c.email} | evento: ${c.eventoId || 'null'}`);
  console.log(`    timestampMs: ${ts.toISOString()}  →  BRT: ${ts.toLocaleDateString('pt-BR', { timeZone: TZ })} ${ts.toLocaleTimeString('pt-BR', { timeZone: TZ })}`);
  console.log(`    dataCheckin: ${dc ? dc.toISOString() : 'null'}  →  BRT: ${dc ? dc.toLocaleDateString('pt-BR', { timeZone: TZ }) : 'null'}`);
});

await mongoose.disconnect();
