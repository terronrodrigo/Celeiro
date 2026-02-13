import mongoose from 'mongoose';

const checkinSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  nome: { type: String, trim: true },
  ministerio: { type: String, trim: true },
  timestamp: { type: Date, default: Date.now },
  timestampMs: { type: Number, default: () => Date.now() },
  dataCheckin: { type: Date, required: true },
  presente: { type: Boolean, default: true },
  eventoId: { type: mongoose.Schema.Types.ObjectId, ref: 'EventoCheckin' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true,
  indexes: [
    { email: 1, ministerio: 1, dataCheckin: 1 },
    { ministerio: 1, dataCheckin: 1 },
    { ministerio: 1, timestampMs: -1 }, // Para sort rápido na consulta de check-ins do líder
    { eventoId: 1, email: 1, dataCheckin: 1 }, // Para validação de check-in duplicado
    { email: 1 },
    { eventoId: 1 },
    { userId: 1 },
    { dataCheckin: 1 },
    { timestampMs: -1 }, // Para sort descendente rápido
  ]
});

// Índice único para 1 check-in por pessoa por ministério por dia
checkinSchema.index(
  { 
    email: 1, 
    ministerio: 1, 
    dataCheckin: 1 
  }, 
  { 
    unique: false, // Permitir múltiplos por dia se houver eventos diferentes
    sparse: true 
  }
);

export default mongoose.model('Checkin', checkinSchema);
