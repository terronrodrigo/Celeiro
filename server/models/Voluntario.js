import mongoose from 'mongoose';

const voluntarioSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  nome: { type: String, trim: true },
  nascimento: { type: Date },
  whatsapp: { type: String, trim: true },
  pais: { type: String, trim: true },
  estado: { type: String, trim: true },
  cidade: { type: String, trim: true },
  evangelico: { type: String, trim: true },
  igreja: { type: String, trim: true },
  tempoIgreja: { type: String, trim: true },
  voluntarioIgreja: { type: String, trim: true },
  ministerio: { type: String, trim: true },
  disponibilidade: { type: String, trim: true },
  horasSemana: { type: String, trim: true },
  areas: { type: [String], default: [] },
  testemunho: { type: String, trim: true },
  timestamp: { type: Date, default: Date.now },
  timestampMs: { type: Number, default: () => Date.now() },
  // Para rastreamento
  fonte: { type: String, enum: ['planilha', 'manual'], default: 'planilha' },
  ativo: { type: Boolean, default: true },
}, { 
  timestamps: true,
  indexes: [
    { email: 1 },
    { ministerio: 1 },
    { estado: 1 },
    { disponibilidade: 1 },
    { areas: 1 },
    { ativo: 1 },
  ]
});

// Índice composto para queries comuns
voluntarioSchema.index({ ativo: 1, ministerio: 1 });
voluntarioSchema.index({ ativo: 1, estado: 1 });

export default mongoose.model('Voluntario', voluntarioSchema);
