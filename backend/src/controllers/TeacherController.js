const Professor = require('../models/Professor');
const ImageProcessor = require('../utils/imageProcessor');

const PERFIS_GESTAO = ['admin', 'diretor', 'secretaria'];

// Filtros de query aceitos na listagem. Qualquer outro parâmetro é ignorado.
const ALLOWED_FILTERS = ['nome', 'email', 'disciplina', 'salaPrincipal', 'tipoEspecial', 'role', 'ativo'];

// Campos que o próprio docente pode editar no seu cadastro. As turmas
// (salaPrincipal/salasAdicionais/turmas) e os vínculos de escola definem o
// escopo horizontal — só a gestão os altera.
const CAMPOS_PROPRIOS = [
    'nome', 'telefone', 'idade', 'biografia', 'atividadesPessoais',
    'ideiasParaAno', 'foto'
];
const CAMPOS_GESTAO = [
    'email', 'disciplina', 'materias', 'tipoAtuacao', 'tipoEspecial', 'professorKey',
    'salaPrincipal', 'salasAdicionais', 'escola', 'vinculos', 'ativo'
];

/** Restringe a consulta à escola ativa (Professor usa vinculos[].escolaId). */
function escopoEscola(req) {
    if (!req.escolaId || req.user?.perfil === 'admin') return null;
    return { 'vinculos.escolaId': String(req.escolaId) };
}

/** true se o cadastro pertence à escola ativa da sessão (ou não há escopo). */
function pertenceAEscola(req, teacher) {
    if (!req.escolaId || req.user?.perfil === 'admin') return true;
    const vinculos = Array.isArray(teacher.vinculos) ? teacher.vinculos : [];
    if (vinculos.length === 0) return true; // legado sem vínculo — migração pendente
    return vinculos.some(v => String(v.escolaId) === String(req.escolaId));
}

/** true se o usuário logado é o dono do cadastro pedagógico. */
function ehDonoDoCadastro(user, teacher) {
    if (!user || !teacher) return false;
    const meuId = String(user.id || user._id || '');
    if (teacher.idUsuario && String(teacher.idUsuario) === meuId) return true;
    const meuEmail = String(user.email || '').toLowerCase();
    return !!meuEmail && String(teacher.email || '').toLowerCase() === meuEmail;
}

exports.list = async (req, res) => {
    try {
        const filters = { ativo: { $ne: false } };

        // SEGURANÇA: whitelist + coerção para String. Antes, todo parâmetro de
        // query virava filtro Mongo — ?ativo[$ne]=false devolvia a rede inteira.
        Object.keys(req.query).forEach(key => {
            if (!ALLOWED_FILTERS.includes(key)) return;
            const valor = req.query[key];
            if (valor === null || valor === undefined || valor === '' || typeof valor === 'object') return;
            filters[key] = key === 'ativo' || key === 'tipoEspecial'
                ? String(valor) === 'true'
                : String(valor);
        });

        // Mecanismo de auto-correção: garante que todo Usuario com perfil 'professor' tenha um registro na coleção 'professores'
        const Usuario = require('../models/Usuario');
        const mongoose = require('mongoose');
        const filtroUsuarios = { perfil: 'professor', ativo: { $ne: false } };
        if (req.escolaId && req.user?.perfil !== 'admin') filtroUsuarios.escolaId = String(req.escolaId);
        const usuariosProfessores = await Usuario.find(filtroUsuarios).lean();

        for (const u of usuariosProfessores) {
            const existingProf = await Professor.findOne({
                $or: [
                    { idUsuario: u._id.toString() },
                    { email: u.email.toLowerCase() }
                ]
            });

            if (!existingProf) {
                console.log(`🔧 [AUTO-HEAL] Sincronizando perfil pedagógico de Professor em falta para: ${u.nome} (${u.email})`);
                const materiasEspeciais = ['Inglês', 'Educação Física', 'Artes', 'SEBRAE', 'Oficina de Leitura'];
                const disc = u.disciplina || 'Geral';
                const isEspecial = materiasEspeciais.includes(disc);
                const t = u.turma || '';

                const salaPrincipal = isEspecial ? 'VARIADOS' : t;
                const salasAdicionais = isEspecial && t ? [t] : [];
                const materias = [disc];

                await Professor.create({
                    _id: new mongoose.Types.ObjectId().toString(),
                    idUsuario: u._id.toString(),
                    nome: u.nome,
                    email: u.email.toLowerCase(),
                    telefone: u.telefone || '(00) 00000-0000',
                    disciplina: disc,
                    salaPrincipal: salaPrincipal,
                    salasAdicionais: salasAdicionais,
                    turmas: t ? [t] : [],
                    materias: materias,
                    tipoEspecial: isEspecial,
                    role: 'professor',
                    ativo: true,
                    // Multi-escola: herda a escola da conta; nunca grava 'default'
                    escola: u.escolaId ? String(u.escolaId) : undefined,
                    vinculos: u.escolaId ? [{ escolaId: String(u.escolaId), cargo: 'professor' }] : []
                });
            }
        }

        const escopo = escopoEscola(req);
        const teachers = await Professor.find(escopo ? { $and: [filters, escopo] } : filters).lean();

        // Normalização para o frontend. Dados de contato completos só para a
        // gestão; docentes entre si veem o essencial pedagógico.
        const ehGestao = PERFIS_GESTAO.includes(String(req.user?.perfil || '').toLowerCase());
        const normalizedTeachers = teachers.map(t => {
            const base = { ...t, id: t.id || t._id };
            if (!ehGestao) {
                delete base.telefone;
                delete base.cpf;
                delete base.idade;
                delete base.vinculos;
            }
            return base;
        });

        res.json({ success: true, data: normalizedTeachers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.get = async (req, res) => {
    try {
        const teacher = await Professor.findOne({ $or: [{ _id: req.params.id }, { id: req.params.id }] }).lean();
        if (!teacher) return res.status(404).json({ success: false, error: 'Professor não encontrado' });

        // Multi-escola: não devolve cadastro de docente de outra escola
        if (!pertenceAEscola(req, teacher)) {
            return res.status(403).json({ success: false, error: 'Este professor pertence a outra escola.' });
        }

        const ehGestao = PERFIS_GESTAO.includes(String(req.user?.perfil || '').toLowerCase());
        const ehProprio = ehDonoDoCadastro(req.user, teacher);
        const data = { ...teacher };
        if (!ehGestao && !ehProprio) {
            delete data.telefone;
            delete data.idade;
            delete data.vinculos;
        }
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try {
        const dados = {};
        [...CAMPOS_PROPRIOS, ...CAMPOS_GESTAO, 'idUsuario'].forEach(campo => {
            if (req.body[campo] !== undefined) dados[campo] = req.body[campo];
        });

        // Conversão automática de imagem para WebP
        if (dados.foto && ImageProcessor.isBase64Image(dados.foto)) {
            try {
                dados.foto = await ImageProcessor.convertToWebPBase64(dados.foto);
            } catch (imgError) {
                console.warn('Falha ao converter imagem do professor para WebP:', imgError);
            }
        }

        // Calcula turmas unificadas
        const principal = dados.salaPrincipal;
        const adicionais = Array.isArray(dados.salasAdicionais) ? dados.salasAdicionais : [];
        dados.turmas = principal && principal !== 'VARIADOS' ? [principal, ...adicionais] : adicionais;

        // Multi-escola: o novo docente nasce vinculado à escola ativa da sessão.
        // O vínculo NUNCA vem do corpo da requisição.
        if (req.escolaId) {
            dados.vinculos = [{ escolaId: String(req.escolaId), cargo: 'professor' }];
            dados.escola = String(req.escolaId);
        } else {
            delete dados.vinculos;
        }

        const teacher = new Professor(dados);
        await teacher.save();
        res.status(201).json({ success: true, data: teacher });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const existente = await Professor.findOne({
            $or: [{ _id: req.params.id }, { id: req.params.id }]
        }).lean();
        if (!existente) return res.status(404).json({ success: false, error: 'Professor não encontrado' });

        // Multi-escola: nunca edita cadastro de outra escola
        if (!pertenceAEscola(req, existente)) {
            return res.status(403).json({ success: false, error: 'Este professor pertence a outra escola.' });
        }

        const perfil = String(req.user?.perfil || '').toLowerCase();
        const ehGestao = PERFIS_GESTAO.includes(perfil);
        const ehProprio = ehDonoDoCadastro(req.user, existente);

        // SEGURANÇA: um docente só edita o PRÓPRIO cadastro, e apenas campos
        // descritivos. Antes, req.body inteiro ia para o findOneAndUpdate — um
        // professor reescrevia salaPrincipal/salasAdicionais/turmas/vinculos de
        // qualquer registro e passava a enxergar toda a rede.
        if (!ehGestao && !ehProprio) {
            return res.status(403).json({ success: false, error: 'Você só pode editar o seu próprio cadastro.' });
        }

        const permitidos = ehGestao ? [...CAMPOS_PROPRIOS, ...CAMPOS_GESTAO] : CAMPOS_PROPRIOS;
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
                console.warn('Falha ao converter imagem do professor para WebP:', imgError);
            }
        }

        // Só a gestão remonta as turmas (elas definem o escopo de acesso)
        if (ehGestao && (dados.salaPrincipal !== undefined || dados.salasAdicionais !== undefined)) {
            const principal = dados.salaPrincipal !== undefined ? dados.salaPrincipal : existente.salaPrincipal;
            const adicionais = Array.isArray(dados.salasAdicionais)
                ? dados.salasAdicionais
                : (existente.salasAdicionais || []);
            dados.turmas = principal && principal !== 'VARIADOS' ? [principal, ...adicionais] : adicionais;
        }

        // Vínculos de escola só mudam por admin — nem diretor move docente entre escolas pelo body
        if (dados.vinculos !== undefined && perfil !== 'admin') delete dados.vinculos;

        const teacher = await Professor.findOneAndUpdate(
            { $or: [{ _id: req.params.id }, { id: req.params.id }] },
            { $set: dados },
            { new: true }
        );
        if (!teacher) return res.status(404).json({ success: false, error: 'Professor não encontrado' });
        res.json({ success: true, data: teacher });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.delete = async (req, res) => {
    try {
        const existente = await Professor.findOne({
            $or: [{ _id: req.params.id }, { id: req.params.id }]
        }).lean();
        if (!existente) return res.json({ success: true, message: 'Professor removido' });
        if (!pertenceAEscola(req, existente)) {
            return res.status(403).json({ success: false, error: 'Este professor pertence a outra escola.' });
        }
        await Professor.findOneAndDelete({ $or: [{ _id: req.params.id }, { id: req.params.id }] });
        res.json({ success: true, message: 'Professor removido' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
