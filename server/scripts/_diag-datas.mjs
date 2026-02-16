import 'dotenv/config';
import mongoose from 'mongoose';
import Checkin from '../models/Checkin.js';

const TZ = 'America/Sao_Paulo';

await mongoose.connect(process.env.MONGODB_URI);

const all = await Checkin.find({}).lean();
const byDate = {};
const conflitos = [];

all.forEach(c => {
  const dc = c.dataCheckin ? new Date(c.dataCheckin) : null;
  const ts = c.timestampMs ? new Date(c.timestampMs) : (c.timestamp ? new Date(c.timestamp) : null);
  const dcBrt = dc ? dc.toLocaleDateString('en-CA', { timeZone: TZ }) : 'sem-dataCheckin';
  const tsBrt = ts ? ts.toLocaleDateString('en-CA', { timeZone: TZ }) : null;

  byDate[dcBrt] = (byDate[dcBrt] || 0) + 1;

  if (tsBrt && dcBrt !== tsBrt) {
    conflitos.push({
      id: String(c._id), email: c.email, dcBrt, tsBrt,
      dcRaw: dc ? dc.toISOString() : null,
      tsRaw: ts ? ts.toISOString() : null,
      eventoId: c.eventoId || null,
    });
  }
});

console.log('== Distribuição por dataCheckin (BRT) ==');
Object.entries(byDate).sort().forEach(([d, n]) => console.log(' ', d, ':', n));

console.log(`\n== Conflitos dataCheckin BRT ≠ timestampMs BRT (${conflitos.length}) ==`);
conflitos.slice(0, 30).forEach(c => {
  console.log(`  ${c.email} | dc: ${c.dcBrt} (${c.dcRaw}) | ts: ${c.tsBrt} (${c.tsRaw}) | evento: ${c.eventoId}`);
});

await mongoose.disconnect();
