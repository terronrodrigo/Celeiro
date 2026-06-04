import mongoose from 'mongoose';

const eventoFormularioSchema = new mongoose.Schema({
  igrejaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Igreja', required: true },
  data: { type: Date, required: true },
  label: { type: String, trim: true, default: '' },
  /** 'batismo' | 'apresentacao' | 'novo_membro' */
  tipo: { type: String, required: true, enum: ['batismo', 'apresentacao', 'novo_membro'] },
  criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ativo: { type: Boolean, default: true },
  horarioInicio: { type: String, trim: true, default: '' },
  horarioFim: { type: String, trim: true, default: '' },
}, { timestamps: true });

eventoFormularioSchema.index({ igrejaId: 1, tipo: 1, data: -1 });
eventoFormularioSchema.index({ igrejaId: 1, ativo: 1, tipo: 1, data: 1 });
eventoFormularioSchema.index({ tipo: 1, data: -1 });
eventoFormularioSchema.index({ ativo: 1, tipo: 1, data: 1 });

export default mongoose.model('EventoFormulario', eventoFormularioSchema);
