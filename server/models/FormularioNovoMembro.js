import mongoose from 'mongoose';

const formularioNovoMembroSchema = new mongoose.Schema({
  igrejaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Igreja', required: true },
  eventoId: { type: mongoose.Schema.Types.ObjectId, ref: 'EventoFormulario', required: true },
  nomeCompleto: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, lowercase: true, default: '' },
  telefoneWhatsapp: { type: String, trim: true, default: '' },
  endereco: { type: String, trim: true, default: '' },
  idade: { type: String, trim: true, default: '' },
  estadoCivil: { type: String, trim: true, default: '' },
  batizado: { type: String, trim: true, default: '' },
  tempoFrequentaIgreja: { type: String, trim: true, default: '' },
  interesseServir: { type: String, trim: true, default: '' },
  ministeriosInteresse: [{ type: String, trim: true }],
}, { timestamps: true });

formularioNovoMembroSchema.index({ igrejaId: 1, eventoId: 1 });
formularioNovoMembroSchema.index({ eventoId: 1 });
formularioNovoMembroSchema.index({ igrejaId: 1, email: 1, eventoId: 1 });

export default mongoose.model('FormularioNovoMembro', formularioNovoMembroSchema);
