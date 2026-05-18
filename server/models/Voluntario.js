import mongoose from 'mongoose';

const voluntarioSchema = new mongoose.Schema({
  igrejaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Igreja', required: true },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  nome: { type: String, trim: true },
  nascimento: { type: Date },
  whatsapp: { type: String, trim: true },
  telefone: { type: String, trim: true },
  pais: { type: String, trim: true },
  estado: { type: String, trim: true },
  cidade: { type: String, trim: true },
  evangelico: { type: String, trim: true },
  igreja: { type: String, trim: true },
  tempoIgreja: { type: String, trim: true },
  voluntarioIgreja: { type: String, trim: true },
  ministerio: { type: String, trim: true },
  ministerios: { type: [String], default: undefined },
  disponibilidade: { type: String, trim: true },
  horasSemana: { type: String, trim: true },
  areas: { type: [String], default: [] },
  testemunho: { type: String, trim: true },
  batizado: { type: Boolean, default: null },
  timestamp: { type: Date, default: Date.now },
  timestampMs: { type: Number, default: () => Date.now() },
  // Para rastreamento
  fonte: { type: String, enum: ['planilha', 'manual'], default: 'planilha' },
  ativo: { type: Boolean, default: true },
  perfilCheckinCompletoAt: { type: Date, default: null },
  perfilCheckinSkip: { type: Boolean, default: false },
  perfilCheckinSkipAt: { type: Date, default: null },
}, { 
  timestamps: true,
  indexes: [
    { igrejaId: 1, email: 1 },
    { email: 1 },
    { ministerio: 1 },
    { estado: 1 },
    { disponibilidade: 1 },
    { areas: 1 },
    { ativo: 1 },
  ]
});

// Índice composto para queries comuns
voluntarioSchema.index({ igrejaId: 1, email: 1 }, { unique: true });
voluntarioSchema.index({ ativo: 1, ministerio: 1 });
voluntarioSchema.index({ igrejaId: 1, ativo: 1, ministerio: 1 });
voluntarioSchema.index({ ativo: 1, estado: 1 });

export default mongoose.model('Voluntario', voluntarioSchema);
