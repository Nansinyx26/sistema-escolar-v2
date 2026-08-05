const Diretor = require('../models/Diretor');
const ImageProcessor = require('../utils/imageProcessor');

// Filtros de query aceitos na listagem. Qualquer outro parâmetro é ignorado.
// (`idUsuario` é o que o dashboard usa para achar o próprio perfil estendido.)
const ALLOWED_FILTERS = ['nome', 'email', 'idUsuario', 'role', 'ativo'];

// Campos que o próprio diretor pode editar no seu cadastro.
//
// Fora desta lista, DE PROPÓSITO: `vinculos` (decide a qual escola a conta tem
// acesso — ver filtrarPorEscola.vinculosDoUsuario), `permissoes`, `role`,
// `ativo`, `email` e `idUsuario` (identidade). São todos campos de privilégio,
// e só admin os altera.
const CAMPOS_PROPRIOS = ['nome', 'telefone', 'idade', 'biografia', 'foto'];
const CAMPOS_ADMIN = ['email', 'idUsuario', 'escola', 'vinculos', 'permissoes', 'role', 'ativo'];

/** Restringe a consulta à escola ativa (Diretor usa vinculos[].escolaId). */
function escopoEscola(req) {
    if (!req.escolaId || req.user?.perfil === 'admin') return null;
    return { 'vinculos.escolaId': String(req.escolaId) };
}

/** true se o cadastro pertence à escola ativa da sessão (ou não há escopo). */
function pertenceAEscola(req, diretor) {
    if (!req.escolaId || req.user?.perfil === 'admin') return true;
    const vinculos = Array.isArray(diretor.vinculos) ? diretor.vinculos : [];
    if (vinculos.length === 0) return true; // legado sem vínculo — migração pendente
    return vinculos.some(v => String(v.escolaId) === String(req.escolaId));
}

/** true se o usuário logado é o dono deste cadastro de diretor. */
function ehDonoDoCadastro(user, diretor) {
    if (!user || !diretor) return false;
    const meuId = String(user.id || user._id || '');
    if (diretor.idUsuario && String(diretor.idUsuario) === meuId) return true;
    const meuEmail = String(user.email || '').toLowerCase();
    return !!meuEmail && String(diretor.email || '').toLowerCase() === meuEmail;
}

exports.list = async (req, res) => {
    try {
        const filters = { ativo: { $ne: false } };

        // SEGURANÇA: whitelist + coerção para String. Antes, TODO parâmetro de
        // query virava filtro Mongo — filtro arbitrário por campo sobre uma
        // coleção com e-mail e telefone de toda a rede.
        Object.keys(req.query).forEach(key => {
            if (!ALLOWED_FILTERS.includes(key)) return;
            const valor = req.query[key];
            if (valor === null || valor === undefined || valor === '' || typeof valor === 'object') return;
            filters[key] = key === 'ativo' ? String(valor) === 'true' : String(valor);
        });

        // SEGURANÇA (multi-tenant): sem este escopo a rota devolvia nome, e-mail,
        // telefone e foto de TODOS os diretores da rede para o diretor de
        // qualquer escola — e era daí que saíam os `_id` usados para editar o
        // cadastro alheio pelo PUT.
        const escopo = escopoEscola(req);
        const directors = await Diretor.find(escopo ? { $and: [filters, escopo] } : filters).lean();

        // Normalização para o frontend
        const normalizedDirs = directors.map(d => ({
            ...d,
            id: d.id || d._id
        }));

        res.json({ success: true, data: normalizedDirs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.get = async (req, res) => {
    try {
        const id = req.params.id;
        const doc = await Diretor.findOne({
            $or: [{ _id: id }, { id: id }]
        }).lean();

        if (!doc) {
            return res.status(404).json({ success: false, error: 'Diretor não encontrado' });
        }

        // Multi-escola: nunca lê cadastro de outra escola
        if (!pertenceAEscola(req, doc)) {
            return res.status(403).json({ success: false, error: 'Este diretor pertence a outra escola.' });
        }

        res.json({ success: true, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try {
        const ehAdmin = String(req.user?.perfil || '').toLowerCase() === 'admin';

        // SEGURANÇA: `new Diretor(req.body)` aceitava o corpo inteiro — inclusive
        // `vinculos`, que é o que decide a quais escolas a conta tem acesso.
        const permitidos = ehAdmin ? [...CAMPOS_PROPRIOS, ...CAMPOS_ADMIN] : CAMPOS_PROPRIOS;
        const dados = {};
        permitidos.forEach(campo => {
            if (req.body[campo] !== undefined) dados[campo] = req.body[campo];
        });

        // Conversão automática de imagem para WebP
        if (dados.foto && ImageProcessor.isBase64Image(dados.foto)) {
            try {
                dados.foto = await ImageProcessor.convertToWebPBase64(dados.foto);
            } catch (imgError) {
                console.warn('Falha ao converter imagem do diretor para WebP:', imgError);
            }
        }

        // Quem não é admin só cria o PRÓPRIO perfil estendido: identidade e
        // vínculo vêm da sessão, nunca do corpo.
        if (!ehAdmin) {
            dados.idUsuario = String(req.user.id || req.user._id || '');
            dados.email = String(req.user.email || '').toLowerCase();
            dados.role = 'director';
            if (req.escolaId) {
                dados.vinculos = [{ escolaId: String(req.escolaId), cargo: 'diretor' }];
            }
        }

        const doc = new Diretor(dados);
        await doc.save();
        res.status(201).json({ success: true, data: doc });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

// ============================================
// ESCALADA CROSS-TENANT — o que esta função permitia
// ============================================
// `req.body` inteiro ia para o findOneAndUpdate, sem whitelist, sem checagem de
// dono e sem checagem de escola. A rota é aberta a `diretor`, então:
//
//   1. o diretor da Escola A pegava o próprio `_id` (ou o de qualquer colega,
//      que a listagem entregava) e fazia
//         PUT /api/diretores/<id>  { "vinculos": [{ "escolaId": "<escolaB>" }] }
//   2. `vinculosDoUsuario()` (middleware/filtrarPorEscola) passava a devolver a
//      Escola B para aquela conta;
//   3. `POST /api/escolas/trocar/<escolaB>` então APROVAVA a troca — a checagem
//      de vínculo consultava exatamente o campo recém-forjado;
//   4. a partir daí `req.escolaId` era B e todo o `escolaMatch` do sistema
//      entregava os dados da outra escola.
//
// Ele também reescrevia ou desativava (`ativo: false`) o cadastro de qualquer
// outro diretor da rede.
//
// É a mesma falha já corrigida no equivalente de professores — ver
// TeacherController.update. Agora: dono OU admin, e whitelist por papel.
// ============================================
exports.update = async (req, res) => {
    try {
        const id = req.params.id;

        const existente = await Diretor.findOne({
            $or: [{ _id: id }, { id: id }]
        }).lean();
        if (!existente) {
            return res.status(404).json({ success: false, error: 'Diretor não encontrado' });
        }

        // Multi-escola: nunca edita cadastro de outra escola
        if (!pertenceAEscola(req, existente)) {
            return res.status(403).json({ success: false, error: 'Este diretor pertence a outra escola.' });
        }

        const ehAdmin = String(req.user?.perfil || '').toLowerCase() === 'admin';

        // Um diretor edita o PRÓPRIO cadastro e nada mais. Não existe caso de uso
        // em que um diretor precise alterar o registro de outro — para isso há o
        // admin, que é global por definição.
        if (!ehAdmin && !ehDonoDoCadastro(req.user, existente)) {
            return res.status(403).json({ success: false, error: 'Você só pode editar o seu próprio cadastro.' });
        }

        const permitidos = ehAdmin ? [...CAMPOS_PROPRIOS, ...CAMPOS_ADMIN] : CAMPOS_PROPRIOS;
        const dados = {};
        permitidos.forEach(campo => {
            if (req.body[campo] !== undefined) dados[campo] = req.body[campo];
        });

        // Conversão automática de imagem para WebP
        if (dados.foto && ImageProcessor.isBase64Image(dados.foto)) {
            try {
                if (!dados.foto.startsWith('data:image/webp')) {
                    dados.foto = await ImageProcessor.convertToWebPBase64(dados.foto);
                }
            } catch (imgError) {
                console.warn('Falha ao converter imagem do diretor para WebP:', imgError);
            }
        }

        const doc = await Diretor.findOneAndUpdate(
            { $or: [{ _id: id }, { id: id }] },
            { $set: dados },
            { new: true, runValidators: true }
        );

        if (!doc) {
            return res.status(404).json({ success: false, error: 'Diretor não encontrado' });
        }

        res.json({ success: true, data: doc });
    } catch (error) {
        console.error('Erro ao atualizar diretor:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.delete = async (req, res) => {
    try {
        const id = req.params.id;
        const doc = await Diretor.findOneAndDelete({
            $or: [{ _id: id }, { id: id }]
        });

        if (!doc) {
            return res.status(404).json({ success: false, error: 'Diretor não encontrado' });
        }

        res.json({ success: true, message: 'Diretor removido com sucesso' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
