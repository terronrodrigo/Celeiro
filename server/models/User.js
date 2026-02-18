import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  nome: {
    type: String,
    required: true,
  },
  senha: {
    type: String,
    default: null, // null quando usa Google OAuth
  },
  googleId: {
    type: String,
    default: null, // preenchido se usar Google OAuth
  },
  role: {
    type: String,
    enum: ['admin', 'voluntario', 'lider'],
    default: 'voluntario',
  },
  ministerioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ministerio', default: null }, // legado; preferir ministerioIds
  ministerioIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ministerio' }],
  ativo: {
    type: Boolean,
    default: true,
  },
  criadoEm: {
    type: Date,
    default: Date.now,
  },
  ultimoAcesso: {
    type: Date,
    default: null,
  },
  fotoUrl: {
    type: String,
    default: null,
    trim: true,
  },
  resetToken: { type: String, default: null },
  resetTokenExpires: { type: Date, default: null },
  /** Exigir troca de senha no primeiro acesso (ex.: usuário criado por admin). */
  mustChangePassword: { type: Boolean, default: false },
  /** Telefone WhatsApp normalizado (ex: 5511999999999) para login/vínculo com agente. */
  whatsapp: { type: String, default: null, trim: true },
}, {
  timestamps: false,
});

// Índices para performance
userSchema.index({ role: 1 });
userSchema.index({ ministerioIds: 1, ativo: 1 });
userSchema.index({ resetToken: 1 });
userSchema.index({ whatsapp: 1 });

// Hash da senha antes de salvar
userSchema.pre('save', async function(next) {
  if (!this.isModified('senha')) return next();
  if (!this.senha) return next(); // Se não tem senha (Google OAuth), pula
  try {
    const salt = await bcryptjs.genSalt(10);
    this.senha = await bcryptjs.hash(this.senha, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Método para comparar senhas (nunca lança: hash inválido/migração retorna false)
userSchema.methods.compararSenha = async function(senhaFornecida) {
  if (!this.senha) return false; // usuários com Google OAuth não podem usar senha
  try {
    return await bcryptjs.compare(senhaFornecida, this.senha);
  } catch (_) {
    return false; // hash inválido (ex.: senha em texto plano após migração)
  }
};

// Remover senha e tokens do JSON quando retornar pelo JSON
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.senha;
  delete obj.resetToken;
  delete obj.resetTokenExpires;
  return obj;
};

export default mongoose.model('User', userSchema);
