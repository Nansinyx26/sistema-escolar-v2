const Aluno = require('../models/Aluno');
const ImageProcessor = require('../utils/imageProcessor');
const { saveToGridFS, deleteFile } = require('../utils/gridfs');
const escapeRegex = require('../utils/escapeRegex');
const { generateUniqueSecretCode } = require('../utils/secretCodeHelper');
const assertAcessoAoAluno = require('../middleware/assertAcessoAoAluno');

// Whitelist de campos permitidos para o Aluno (Prevenção de Injeção de Parâmetros)
const studentWhitelist = [
    'nome', 'matricula', 'turma', 'turmaId', 'email', 'telefone', 
    'dataNascimento', 'nascimento', 'sexo', 'foto', 'ativo', 'observacoes', 
    'responsavelNome', 'responsavelTelefone', 'responsavel',
    'nivel', 'nivelBimestre', 'condicao', 'condicaoOutro',
    'observacoesBimestre', 'recuperacaoBimestre', 'faltasBimestre',
    'deficiencia', 'pcd',
    'endereco', 'cpfAluno', 'nacionalidade', 'etnia', 'religiao', 
    'responsavelDados', 'responsaveis', 'guardaLegal', 'pessoasAutorizadasRetirada',
    'autorizacoesEscolares', 'fichaDocumentoStatus',
    'alergiasAlimentos', 'alergiasRemedio', 'planoSaude', 
    'documentos', 'lgpdConsentimento'
];

exports.list = async (req, res) => {
    try {
        const { turma, turmaId, q, page = 1, limit = 100 } = req.query;
        const query = { ativo: { $ne: false } };

        // Multi-escola: isola por tenant quando o contexto está resolvido
        if (req.escolaId) query.escolaId = req.escolaId;

        // Filtro de Turma Flexível: busca em ambos os campos e aceita variações (1C vs 1ºC)
        if (turmaId || turma) {
            const val = turmaId || turma;
            const norm = val.replace('º', '');
            const variations = [val, norm];
            if (norm.length >= 2) variations.push(`${norm[0]}º${norm.slice(1)}`);
            
            query.$or = [
                { turmaId: { $in: variations } },
                { turma: { $in: variations } }
            ];
        }

        // Aplica Controle de Acesso Horizontal (Professores veem apenas suas turmas)
        if (req.horizontalFilter) {
            // Se já existir um $or (do filtro de turma acima), precisamos combinar
            if (query.$or) {
                query.$and = [
                    { $or: query.$or },
                    req.horizontalFilter
                ];
                delete query.$or;
            } else {
                Object.assign(query, req.horizontalFilter);
            }
            
            // Verificação de segurança extra: se pediu uma turma específica, 
            // ela DEVE estar entre as permitidas (req.allowedTurmas)
            if ((turma || turmaId) && req.allowedTurmas) {
                const requested = (turma || turmaId).replace('º', '');
                const isAllowed = req.allowedTurmas.some(t => t.replace('º', '') === requested);
                if (!isAllowed) {
                    query.turma = "ACESSO_NEGADO";
                }
            }
        }
        if (q) {
            const safeQ = escapeRegex(q);
            const searchFilter = {
                $or: [
                    { nome: { $regex: safeQ, $options: 'i' } },
                    { matricula: { $regex: safeQ, $options: 'i' } }
                ]
            };

            if (query.$and) {
                query.$and.push(searchFilter);
            } else if (query.$or) {
                // Se já tem um $or (filtro de turma), precisamos mover para um $and
                query.$and = [
                    { $or: query.$or },
                    searchFilter
                ];
                delete query.$or;
            } else {
                query.$or = searchFilter.$or;
            }
        }

        const students = await Aluno.find(query)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ nome: 1 })
            .lean();

        // Normalização para o frontend: garante que cada item tenha um campo 'id' e resolve URLs de fotos
        const normalizedStudents = students.map(s => {
            const student = { ...s, id: s.id || s._id };

            // Nunca em listagem genérica: quem tem o código vincula o aluno
            delete student.codigoSecreto;

            // Se a foto for um ID do GridFS, converte para URL
            if (student.foto && student.foto.length > 20 && !student.foto.startsWith('data:')) {
                student.foto = `/api/upload/photo/${student.foto}`;
            }
            
            return student;
        });

        const count = await Aluno.countDocuments(query);

        res.json({
            success: true,
            data: normalizedStudents,
            pagination: {
                total: count,
                page: Number(page),
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.get = async (req, res) => {
    try {
        // SEGURANÇA: uma única verificação cobre escola (multi-tenant), turma
        // (professor) e vínculo (responsável). Antes só o perfil 'professor'
        // era checado e não havia filtro de escola — qualquer conta logada lia
        // a ficha completa de qualquer aluno da rede.
        const acesso = await assertAcessoAoAluno(req, req.params.id);
        if (!acesso.ok) {
            return res.status(acesso.status).json({ success: false, error: acesso.error });
        }

        const studentData = { ...acesso.aluno };
        studentData.id = studentData.id || studentData._id;

        // O código secreto habilita o vínculo de responsável: só a gestão o vê,
        // e apenas pela rota dedicada /api/alunos/codigos-secretos.
        delete studentData.codigoSecreto;

        // Resolve URL da foto se estiver no GridFS
        if (studentData.foto && studentData.foto.startsWith('gridfs:')) {
            const fileId = studentData.foto.split(':')[1];
            studentData.foto = `/api/upload/photo/${fileId}`;
        }

        res.json({ success: true, data: studentData });
    } catch (error) {
        // Se falhar cast para ObjectId, tenta buscar por outros campos se não foi tentado
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try {
        // Whitelist: Filtra apenas campos permitidos
        const filteredBody = {};
        studentWhitelist.forEach(field => {
            if (req.body[field] !== undefined) filteredBody[field] = req.body[field];
        });

        // Sincronização Obrigatória
        if (filteredBody.turmaId) filteredBody.turma = filteredBody.turmaId;
        else if (filteredBody.turma) filteredBody.turmaId = filteredBody.turma;

        // Gerar código secreto de forma randômica e automática
        filteredBody.codigoSecreto = await generateUniqueSecretCode();

        // Multi-escola: novo aluno pertence à escola ativa da sessão
        if (req.escolaId) filteredBody.escolaId = req.escolaId;

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const targetTurma = filteredBody.turma || filteredBody.turmaId;
            if (!targetTurma) {
                return res.status(400).json({ success: false, error: 'A turma é obrigatória para cadastrar um aluno.' });
            }
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(targetTurma)) {
                return res.status(403).json({ success: false, error: `Acesso negado. Você não tem permissão para cadastrar alunos na turma ${targetTurma}.` });
            }
        }
        // -------------------------------------------------------------------------

        // Conversão automática de imagem para WebP e salvamento no GridFS
        if (filteredBody.foto && ImageProcessor.isBase64Image(filteredBody.foto)) {
            try {
                const base64Data = filteredBody.foto.includes('base64,') ? filteredBody.foto.split('base64,')[1] : filteredBody.foto;
                const buffer = Buffer.from(base64Data, 'base64');
                const sharp = require('sharp');
                const webpBuffer = await sharp(buffer).webp({ quality: 80 }).toBuffer();
                const filename = `aluno_${Date.now()}.webp`;
                const fileId = await saveToGridFS(webpBuffer, filename, 'image/webp');
                filteredBody.foto = `gridfs:${fileId}`;
            } catch (imgError) {
                console.warn('Falha ao processar imagem para GridFS:', imgError);
            }
        }

        const student = new Aluno(filteredBody);
        await student.save();

        // SEGURANÇA: o código secreto NUNCA entra em log de auditoria nem em
        // stdout — ele é a credencial que vincula um responsável ao aluno, e
        // agregadores de log (Render) o exporiam a quem tem acesso à esteira.
        const { logAction } = require('../utils/auditHelper');
        await logAction(req, 'CREATE_STUDENT', 'Alunos', {
            recursoId: student._id,
            valorNovo: { nome: student.nome },
            descricao: `Aluno ${student.nome} cadastrado (código secreto gerado).`
        });

        console.log(`✅ [STUDENT-CREATE] Aluno ${student.nome} criado com sucesso.`);
        res.status(201).json({ success: true, data: student, message: 'Estudante cadastrado com sucesso!' });
    } catch (error) {
        console.error(`❌ [STUDENT-CREATE] Erro ao criar aluno:`, error.message);
        res.status(400).json({ success: false, error: 'Erro ao cadastrar estudante. Verifique se os dados estão corretos.' });
    }
};

exports.update = async (req, res) => {
    try {
        console.log(`[Student Update] Updating ID: ${req.params.id}`);

        // Conversão automática de imagem para WebP e salvamento no GridFS
        if (req.body.foto && ImageProcessor.isBase64Image(req.body.foto)) {
            try {
                const base64Data = req.body.foto.includes('base64,') ? req.body.foto.split('base64,')[1] : req.body.foto;
                const buffer = Buffer.from(base64Data, 'base64');
                
                const sharp = require('sharp');
                const webpBuffer = await sharp(buffer).webp({ quality: 80 }).toBuffer();
                
                const filename = `aluno_upd_${Date.now()}.webp`;
                const fileId = await saveToGridFS(webpBuffer, filename, 'image/webp');

                // Tenta deletar a foto antiga do GridFS se existir
                const oldStudent = await Aluno.findOne({ _id: req.params.id }).select('foto');
                if (oldStudent && oldStudent.foto && oldStudent.foto.startsWith('gridfs:')) {
                    const oldId = oldStudent.foto.split(':')[1];
                    try { await deleteFile(oldId); } catch (e) { /* ignore */ }
                }
                
                req.body.foto = `gridfs:${fileId}`;
            } catch (imgError) {
                console.warn('Falha ao processar imagem do aluno no update:', imgError);
            }
        }

        delete req.body._id; 
        delete req.body.id;  

        // SEGURANÇA: Whitelist de campos permitidos (previne injeção de parâmetros)
        const filteredBody = {};
        studentWhitelist.forEach(field => {
            if (req.body[field] !== undefined) filteredBody[field] = req.body[field];
        });

        // Sincronização Obrigatória no Update
        if (filteredBody.turmaId) filteredBody.turma = filteredBody.turmaId;
        else if (filteredBody.turma) filteredBody.turmaId = filteredBody.turma;

        // --- SEGURANÇA: escola (multi-tenant) + turma (professor) ---
        const acesso = await assertAcessoAoAluno(req, req.params.id);
        if (!acesso.ok) return res.status(acesso.status).json({ success: false, error: acesso.error });
        const existingStudent = acesso.aluno;

        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];

            // Se tentar alterar a turma do aluno, valida se a nova turma também é autorizada
            const targetTurma = filteredBody.turma || filteredBody.turmaId;
            if (targetTurma && !allowed.includes(targetTurma)) {
                return res.status(403).json({ success: false, error: `Acesso negado. Você não tem permissão para mover alunos para a turma ${targetTurma}.` });
            }
        }
        // -------------------------------------------------------------------------

        // Multi-escola: transferir o aluno para outra escola é permitido apenas
        // à equipe gestora (admin/diretor/secretaria). Professores nunca alteram
        // escolaId. O nome do campo NÃO está na whitelist geral de propósito.
        if (req.body.escolaId && ['admin', 'diretor', 'secretaria'].includes(req.user?.perfil)) {
            filteredBody.escolaId = String(req.body.escolaId);
        }

        const student = await Aluno.findOneAndUpdate(
            { $or: [{ _id: req.params.id }, { id: req.params.id }] },
            filteredBody,
            { new: true, runValidators: true }
        );
        if (!student) return res.status(404).json({ success: false, error: 'Aluno não encontrado' });

        // Mantém a escola do RESPONSÁVEL em sincronia com a do aluno: se o aluno
        // mudou de escola, o responsável vinculado passa a pertencer à mesma escola.
        try {
            if (student.escolaId && student.responsavel) {
                const Usuario = require('../models/Usuario');
                await Usuario.updateOne(
                    { email: String(student.responsavel).toLowerCase(), perfil: 'responsavel' },
                    { $set: { escolaId: String(student.escolaId) } }
                );
            }
        } catch (syncErr) {
            console.warn('[Student Update] Falha ao sincronizar escola do responsável:', syncErr.message);
        }

        res.json({ success: true, data: student });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.delete = async (req, res) => {
    try {
        // --- SEGURANÇA: escola (multi-tenant) + turma (professor) ---
        const acesso = await assertAcessoAoAluno(req, req.params.id);
        if (!acesso.ok) return res.status(acesso.status).json({ success: false, error: acesso.error });
        // -------------------------------------------------------------------------

        // Soft delete preferido via 'ativo: false', mas implementando delete real conforme pedido ou soft se 'ativo' existir
        // O pedido diz "DELETE", mas o schema tem 'ativo'. Vou fazer soft delete se não for especificado hard.
        // Na verdade, DELETE verb usually means delete/archive.
        const student = await Aluno.findOneAndDelete({ $or: [{ _id: req.params.id }, { id: req.params.id }] });
        if (!student) return res.status(404).json({ success: false, error: 'Aluno não encontrado' });
        res.json({ success: true, data: { message: 'Aluno removido' } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ─── GET /api/alunos/codigos-secretos ────────────────────────────────────────
// Restrito a diretores/admin — lista todos os alunos com seus códigos secretos
exports.listSecretCodes = async (req, res) => {
    try {
        const { turma, q } = req.query;
        const query = { ativo: { $ne: false } };

        // Multi-escola: códigos visíveis apenas da escola ativa da sessão
        if (req.escolaId) query.escolaId = req.escolaId;

        if (turma) {
            if (turma.startsWith('SERIE_')) {
                const serie = turma.replace('SERIE_', '');
                query.$or = [
                    { turmaId: { $regex: `^${serie}`, $options: 'i' } },
                    { turma: { $regex: `^${serie}`, $options: 'i' } }
                ];
            } else {
                const norm = turma.replace('º', '');
                const variations = [turma, norm];
                if (norm.length >= 2) variations.push(`${norm[0]}º${norm.slice(1)}`);
                query.$or = [
                    { turmaId: { $in: variations } },
                    { turma: { $in: variations } }
                ];
            }
        }

        if (q) {
            const safeQ = escapeRegex(q);
            const searchFilter = {
                $or: [
                    { nome: { $regex: safeQ, $options: 'i' } },
                    { matricula: { $regex: safeQ, $options: 'i' } },
                    { codigoSecreto: { $regex: safeQ, $options: 'i' } }
                ]
            };
            if (query.$or) {
                query.$and = [{ $or: query.$or }, searchFilter];
                delete query.$or;
            } else {
                query.$or = searchFilter.$or;
            }
        }

        const students = await Aluno.find(query)
            .select('nome sobrenome turma turmaId codigoSecreto responsavel matricula')
            .sort({ turma: 1, nome: 1 })
            .lean();

        const missingCodeStudents = students.filter(student => !student.codigoSecreto || ['N/A', 'n/a', ''].includes(String(student.codigoSecreto).trim()));
        if (missingCodeStudents.length > 0) {
            for (const student of missingCodeStudents) {
                const studentDoc = await Aluno.findById(student._id);
                if (studentDoc) {
                    studentDoc.codigoSecreto = undefined;
                    await studentDoc.save();
                }
            }
        }

        const studentsWithCodes = await Aluno.find(query)
            .select('nome sobrenome turma turmaId codigoSecreto responsavel matricula')
            .sort({ turma: 1, nome: 1 })
            .lean();

        const Turma = require('../models/Turma');
        const turmas = await Turma.find({}).lean();
        const turmaMap = {};
        turmas.forEach(t => {
            const key = (t.nome || t.id || '').toUpperCase();
            if (key) {
                turmaMap[key] = t;
            }
        });

        const data = studentsWithCodes.map(s => {
            const studentTurmaKey = (s.turma || s.turmaId || '').toUpperCase();
            const tInfo = turmaMap[studentTurmaKey] || {};
            
            let ano = '-';
            let turmaNome = s.turma || s.turmaId || '-';
            
            if (tInfo.ano) {
                ano = `${tInfo.ano}º ano`;
                turmaNome = tInfo.sala || s.turma || s.turmaId || '-';
            } else if (studentTurmaKey) {
                const match = studentTurmaKey.match(/^(\d+)(º)?\s*([A-Za-z]+)$/);
                if (match) {
                    ano = `${match[1]}º ano`;
                    turmaNome = match[3];
                }
            }

            return {
                id: s._id,
                nome: `${s.nome}${s.sobrenome ? ' ' + s.sobrenome : ''}`,
                ano,
                turma: turmaNome,
                codigoSecreto: s.codigoSecreto || 'N/A',
                matricula: s.matricula || '-',
                vinculado: !!s.responsavel,
                responsavelEmail: s.responsavel || null
            };
        });

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Regenera o código secreto de um aluno (usado pelo responsável no
 * primeiro acesso). Invalida o código anterior imediatamente.
 * Restrito a admin/diretor/secretaria (authorize na rota) e à escola
 * ativa da sessão (multi-tenant).
 */
exports.regenerateSecretCode = async (req, res) => {
    try {
        const aluno = await Aluno.findOne({
            $or: [{ _id: req.params.id }, { id: req.params.id }]
        });
        if (!aluno) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        // Multi-escola: só regenera código de aluno da escola ativa
        if (req.escolaId && aluno.escolaId && String(aluno.escolaId) !== String(req.escolaId)) {
            return res.status(403).json({ success: false, error: 'Este aluno pertence a outra escola.' });
        }

        const codigoAnterior = aluno.codigoSecreto;
        aluno.codigoSecreto = await generateUniqueSecretCode();
        await aluno.save();

        const { logAction } = require('../utils/auditHelper');
        await logAction(req, 'REGENERATE_STUDENT_CODE', 'Aluno', {
            recursoId: aluno._id,
            descricao: `Código secreto do aluno "${aluno.nome}" regenerado (anterior invalidado).`
        });

        res.json({
            success: true,
            message: 'Novo código gerado. O código anterior deixou de funcionar.',
            data: {
                alunoId: aluno._id,
                nome: `${aluno.nome}${aluno.sobrenome ? ' ' + aluno.sobrenome : ''}`,
                codigoSecreto: aluno.codigoSecreto,
                codigoAnteriorInvalidado: !!codigoAnterior
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
