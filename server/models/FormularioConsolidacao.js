import mongoose from 'mongoose';

/** Formulário de Consolidação / Acolhimento (decisão, contato, oração). Multi-tenant por igrejaId. */
const formularioConsolidacaoSchema = new mongoose.Schema({
  igrejaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Igreja', required: true },
  nomeCompleto: { type: String, trim: true, default: '' },
  dataNascimento: { type: Date },
  idade: { type: String, trim: true, default: '' },
  genero: { type: String, trim: true, default: '' },
  estadoCivil: { type: String, trim: true, default: '' },
  batizadoAguas: { type: String, trim: true, default: '' },
  telefoneWhatsapp: { type: String, trim: true, default: '' },
  bairroCidade: { type: String, trim: true, default: '' },
  decisaoHoje: { type: String, trim: true, default: '' },
  grupoOracao: { type: String, trim: true, default: '' },
  podeContato: { type: String, trim: true, default: '' },
  melhorDiaContato: { type: String, trim: true, default: '' },
  melhorHorarioContato: { type: String, trim: true, default: '' },
  preferenciaContato: { type: String, trim: true, default: '' },
  pedidoOracao: { type: String, trim: true, default: '' },
  emailOpcional: { type: String, lowercase: true, trim: true, default: '' },
}, { timestamps: true });

formularioConsolidacaoSchema.index({ igrejaId: 1, createdAt: -1 });
formularioConsolidacaoSchema.index({ createdAt: -1 });

export default mongoose.model('FormularioConsolidacao', formularioConsolidacaoSchema);
