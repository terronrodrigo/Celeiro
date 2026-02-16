import mongoose from 'mongoose';

const escalaSchema = new mongoose.Schema({
  nome: { type: String, required: true, trim: true },
  data: { type: Date, default: null },
  descricao: { type: String, trim: true, default: '' },
  ativo: { type: Boolean, default: true },
  criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

escalaSchema.index({ ativo: 1, createdAt: -1 });

export default mongoose.model('Escala', escalaSchema);
