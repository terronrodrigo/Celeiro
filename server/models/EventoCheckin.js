import mongoose from 'mongoose';

const eventoCheckinSchema = new mongoose.Schema({
  igrejaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Igreja', required: true },
  data: { type: Date, required: true },
  label: { type: String, trim: true, default: '' },
  criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ativo: { type: Boolean, default: true },
  /** Horário de início do check-in (timezone São Paulo), formato "HH:mm". Opcional = dia inteiro. */
  horarioInicio: { type: String, trim: true, default: '' },
  /** Horário de fim do check-in (timezone São Paulo), formato "HH:mm". Opcional = dia inteiro. */
  horarioFim: { type: String, trim: true, default: '' },
}, { timestamps: true });

eventoCheckinSchema.index({ igrejaId: 1, data: 1 });
eventoCheckinSchema.index({ igrejaId: 1, ativo: 1, data: 1 });
eventoCheckinSchema.index({ data: 1 });
eventoCheckinSchema.index({ ativo: 1, data: 1 });

export default mongoose.model('EventoCheckin', eventoCheckinSchema);
