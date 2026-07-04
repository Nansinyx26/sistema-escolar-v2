const mongoose = require('mongoose');

/**
 * Escola — entidade central do suporte multi-escola.
 * `ativo: false` = exibida com cadeado no modal da landing (não clicável).
 * `codigoSecreto` = código de cadastro POR ESCOLA (nunca exposto em rotas públicas).
 */
const EscolaSchema = new mongoose.Schema({
    nome: { type: String, required: true, unique: true, trim: true },
    tipo: { type: String, enum: ['EMEF', 'CIEP'], required: true },
    endereco: { type: String, default: '' },
    bairro: { type: String, default: '' },
    municipio: { type: String, default: 'Americana' },
    codigoSecreto: { type: String, select: false },
    ativo: { type: Boolean, default: false },
    criadoEm: { type: Date, default: Date.now }
}, { collection: 'escolas' });

EscolaSchema.index({ ativo: 1, tipo: 1 });

module.exports = mongoose.model('Escola', EscolaSchema);
