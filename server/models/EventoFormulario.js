import mongoose from 'mongoose';

const eventoFormularioSchema = new mongoose.Schema({
  data: { type: Date, required: true },
  label: { type: String, trim: true, default: '' },
  /** 'batismo' | 'apresentacao' */
  tipo: { type: String, required: true, enum: ['batismo', 'apresentacao'] },
  criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ativo: { type: Boolean, default: true },
  horarioInicio: { type: String, trim: true, default: '' },
  horarioFim: { type: String, trim: true, default: '' },
}, { timestamps: true });

eventoFormularioSchema.index({ tipo: 1, data: -1 });
eventoFormularioSchema.index({ ativo: 1, tipo: 1, data: 1 });

export default mongoose.model('EventoFormulario', eventoFormularioSchema);
