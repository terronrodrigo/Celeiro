import mongoose from 'mongoose';

const candidaturaSchema = new mongoose.Schema({
  escalaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Escala', required: true },
  nome: { type: String, trim: true, default: '' },
  email: { type: String, lowercase: true, trim: true, default: '' },
  telefone: { type: String, trim: true, default: '' },
  ministerio: { type: String, trim: true, default: '' },
  status: {
    type: String,
    enum: ['pendente', 'aprovado', 'desistencia', 'falta'],
    default: 'pendente',
  },
  aprovadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  aprovadoEm: { type: Date, default: null },
  emailEnviado: { type: Boolean, default: false },
}, { timestamps: true });

candidaturaSchema.index({ escalaId: 1, email: 1 });
candidaturaSchema.index({ escalaId: 1, ministerio: 1, status: 1 });
candidaturaSchema.index({ email: 1, status: 1 });

export default mongoose.model('Candidatura', candidaturaSchema);
