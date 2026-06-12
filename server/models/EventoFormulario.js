import mongoose from 'mongoose';

const SHORT_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
function generateShortCode(len = 7) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
  }
  return out;
}

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
  /** Código curto para link público discreto (/f/:code) */
  shortCode: { type: String, trim: true, default: generateShortCode },
}, { timestamps: true });

eventoFormularioSchema.index({ shortCode: 1 }, { unique: true, sparse: true });

eventoFormularioSchema.index({ igrejaId: 1, tipo: 1, data: -1 });
eventoFormularioSchema.index({ igrejaId: 1, ativo: 1, tipo: 1, data: 1 });
eventoFormularioSchema.index({ tipo: 1, data: -1 });
eventoFormularioSchema.index({ ativo: 1, tipo: 1, data: 1 });

export default mongoose.model('EventoFormulario', eventoFormularioSchema);
