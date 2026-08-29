const Aluno = require('../models/Aluno');
const ImageProcessor = require('../utils/imageProcessor');
const { saveToGridFS, deleteFile } = require('../utils/gridfs');
const busca = require('../utils/buscaAluno');
const { generateUniqueSecretCode, assignSecretCodes } = require('../utils/secretCodeHelper');
const logger = require('../utils/logger');
const assertAcessoAoAluno = require('../middleware/assertAcessoAoAluno');

// Whitelist de campos permitidos para o Aluno (Prevenção de Injeção de Parâmetros)
const studentWhitelist = [
    'nome',
    'matricula',
    'turma',
    'turmaId',
    'email',
    'telefone',
    'dataNascimento',
    'nascimento',
    'sexo',
    'foto',
    'ativo',
    'observacoes',
    'responsavelNome',
    'responsavelTelefone',
    'responsavel',
    'nivel',
    'nivelBimestre',
    'condicao',
    'condicaoOutro',
    'observacoesBimestre',
    'recuperacaoBimestre',
    'faltasBimestre',
    'deficiencia',
    'pcd',
    'endereco',
    'cpfAluno',
    'nacionalidade',
    'etnia',
    'religiao',
    'responsavelDados',
    'responsaveis',
    'guardaLegal',
    'pessoasAutorizadasRetirada',
    'autorizacoesEscolares',
    'fichaDocumentoStatus',
    'alergiasAlimentos',
    'alergiasRemedio',
    'planoSaude',
    'documentos',
    'lgpdConsentimento',
];

exports.list = async (req, res) => {
    try {
        const { turma, turmaId, q, page = 1, limit = 100 } = req.query;
        const base = { ativo: { $ne: false } };

        // Multi-escola: isola por tenant quando o contexto está resolvido
        if (req.escolaId) base.escolaId = req.escolaId;

        // Filtro de Turma Flexível.
        // A lista fixa de variações que existia aqui ("1C", "1ºC") só acertava
        // as grafias que alguém lembrou de escrever; "1 C" e "1º C" — que a
        // professora digita no cadastro — passavam batido e o aluno sumia da
        // listagem da secretaria. `filtroDeSala` casa qualquer uma delas.
        const condicaoSala = busca.filtroDeSala(turmaId || turma);

        // Busca livre: sem acento, multi-termo, cobrindo nome, sobrenome, RA e
        // sala. Antes era uma regex crua só em `nome` e `matricula` — procurar
        // "joao" não achava "João", e "silva joao" não achava "João da Silva".
        const condicaoBusca = busca.filtroDeBusca(q);

        // Controle de Acesso Horizontal (professor só vê as próprias turmas).
        // Entra como mais uma condição do `$and`: o encadeamento manual de
        // `$or`/`$and` que existia aqui dependia da ordem em que os filtros
        // eram montados e já tinha sobrescrito um filtro anterior.
        const query = busca.combinar(
            base,
            condicaoSala,
            condicaoBusca,
            req.horizontalFilter || null
        );

        // Verificação de segurança extra: se pediu uma turma específica,
        // ela DEVE estar entre as permitidas (req.allowedTurmas)
        if (req.horizontalFilter && (turma || turmaId) && req.allowedTurmas) {
            const requested = busca.normalizarSala(turma || turmaId);
            const isAllowed = req.allowedTurmas.some((t) => busca.normalizarSala(t) === requested);
            if (!isAllowed) {
                query.turma = 'ACESSO_NEGADO';
            }
        }

        const students = await Aluno.find(query)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ nome: 1 })
            .lean();

        // Normalização para o frontend: garante que cada item tenha um campo 'id' e resolve URLs de fotos
        const normalizedStudents = students.map((s) => {
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
                pages: Math.ceil(count / limit),
            },
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
        studentWhitelist.forEach((field) => {
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
                return res.status(400).json({
                    success: false,
                    error: 'A turma é obrigatória para cadastrar um aluno.',
                });
            }
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(targetTurma)) {
                return res.status(403).json({
                    success: false,
                    error: `Acesso negado. Você não tem permissão para cadastrar alunos na turma ${targetTurma}.`,
                });
            }
        }
        // -------------------------------------------------------------------------

        // Conversão automática de imagem para WebP e salvamento no GridFS
        if (filteredBody.foto && ImageProcessor.isBase64Image(filteredBody.foto)) {
            try {
                const base64Data = filteredBody.foto.includes('base64,')
                    ? filteredBody.foto.split('base64,')[1]
                    : filteredBody.foto;
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
            descricao: `Aluno ${student.nome} cadastrado (código secreto gerado).`,
        });

        console.log(`✅ [STUDENT-CREATE] Aluno ${student.nome} criado com sucesso.`);
        res.status(201).json({
            success: true,
            data: student,
            message: 'Estudante cadastrado com sucesso!',
        });
    } catch (error) {
        console.error(`❌ [STUDENT-CREATE] Erro ao criar aluno:`, error.message);
        res.status(400).json({
            success: false,
            error: 'Erro ao cadastrar estudante. Verifique se os dados estão corretos.',
        });
    }
};

exports.update = async (req, res) => {
    try {
        console.log(`[Student Update] Updating ID: ${req.params.id}`);

        // Conversão automática de imagem para WebP e salvamento no GridFS
        if (req.body.foto && ImageProcessor.isBase64Image(req.body.foto)) {
            try {
                const base64Data = req.body.foto.includes('base64,')
                    ? req.body.foto.split('base64,')[1]
                    : req.body.foto;
                const buffer = Buffer.from(base64Data, 'base64');

                const sharp = require('sharp');
                const webpBuffer = await sharp(buffer).webp({ quality: 80 }).toBuffer();

                const filename = `aluno_upd_${Date.now()}.webp`;
                const fileId = await saveToGridFS(webpBuffer, filename, 'image/webp');

                // Tenta deletar a foto antiga do GridFS se existir
                const oldStudent = await Aluno.findOne({ _id: req.params.id }).select('foto');
                if (oldStudent && oldStudent.foto && oldStudent.foto.startsWith('gridfs:')) {
                    const oldId = oldStudent.foto.split(':')[1];
                    try {
                        await deleteFile(oldId);
                    } catch (e) {
                        // Não bloqueia a troca de foto, mas cada falha aqui deixa
                        // um arquivo órfão ocupando espaço no GridFS para sempre.
                        logger.warn(
                            'Não foi possível remover a foto antiga do GridFS (arquivo órfão)',
                            {
                                err: e,
                                gridfsId: oldId,
                                action: 'aluno.trocarFoto',
                            }
                        );
                    }
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
        studentWhitelist.forEach((field) => {
            if (req.body[field] !== undefined) filteredBody[field] = req.body[field];
        });

        // Sincronização Obrigatória no Update
        if (filteredBody.turmaId) filteredBody.turma = filteredBody.turmaId;
        else if (filteredBody.turma) filteredBody.turmaId = filteredBody.turma;

        // --- SEGURANÇA: escola (multi-tenant) + turma (professor) ---
        const acesso = await assertAcessoAoAluno(req, req.params.id);
        if (!acesso.ok)
            return res.status(acesso.status).json({ success: false, error: acesso.error });
        const existingStudent = acesso.aluno;

        if (req.user && req.user.perfil === 'professor') {
            const allowed = req.allowedTurmas || [];

            // Se tentar alterar a turma do aluno, valida se a nova turma também é autorizada
            const targetTurma = filteredBody.turma || filteredBody.turmaId;
            if (targetTurma && !allowed.includes(targetTurma)) {
                return res.status(403).json({
                    success: false,
                    error: `Acesso negado. Você não tem permissão para mover alunos para a turma ${targetTurma}.`,
                });
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
        if (!student)
            return res.status(404).json({ success: false, error: 'Aluno não encontrado' });

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
            console.warn(
                '[Student Update] Falha ao sincronizar escola do responsável:',
                syncErr.message
            );
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
        if (!acesso.ok)
            return res.status(acesso.status).json({ success: false, error: acesso.error });
        // -------------------------------------------------------------------------

        // Soft delete preferido via 'ativo: false', mas implementando delete real conforme pedido ou soft se 'ativo' existir
        // O pedido diz "DELETE", mas o schema tem 'ativo'. Vou fazer soft delete se não for especificado hard.
        // Na verdade, DELETE verb usually means delete/archive.
        const student = await Aluno.findOneAndDelete({
            $or: [{ _id: req.params.id }, { id: req.params.id }],
        });
        if (!student)
            return res.status(404).json({ success: false, error: 'Aluno não encontrado' });
        res.json({ success: true, data: { message: 'Aluno removido' } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ─── GET /api/alunos/codigos-secretos ────────────────────────────────────────
// Restrito a diretores/admin/secretaria — lista todos os alunos com seus códigos secretos.
//
// PERFORMANCE: a primeira versão gerava os códigos inline com N+1 queries
// (findById + findOne de unicidade + save POR ALUNO) e travava a rota. A
// segunda passou essa mesma rotina para background (fire-and-forget) e devolvia
// "Gerando..." — mas, sem ninguém observando o resultado, qualquer falha (um
// documento legado reprovando na validação do schema, por exemplo) abortava o
// laço em silêncio e a tela da direção ficava presa em "Gerando..." para
// sempre. Além disso o auto-refresh do front redisparava o laço a cada 5s.
//
// Agora a geração é feita em lote (utils/secretCodeHelper#assignSecretCodes):
// 3 idas ao banco para qualquer quantidade de alunos, rápido o bastante para
// rodar dentro do request. A resposta já sai com os códigos definitivos.
exports.listSecretCodes = async (req, res) => {
    try {
        const { turma, q } = req.query;
        const base = { ativo: { $ne: false } };

        // Multi-escola: códigos visíveis apenas da escola ativa da sessão
        if (req.escolaId) base.escolaId = req.escolaId;

        // ── Turmas da escola ─────────────────────────────────────────────────
        // Carregadas ANTES da busca por duas razões: resolvem o nome de exibição
        // da sala e, quando há filtro por sala, dão os `_id` das turmas que
        // casam — alcançando também o aluno cujo vínculo foi gravado por
        // ObjectId em vez do nome da sala.
        const Turma = require('../models/Turma');
        const turmaQuery = req.escolaId ? { escolaId: req.escolaId } : {};
        const turmas = await Turma.find(turmaQuery).lean();

        const idsDaSala = turma
            ? turmas
                  .filter((t) => busca.salaCasa(t.nome, turma) || busca.salaCasa(t.id, turma))
                  .flatMap((t) => [String(t._id), t.id, t.nome])
                  .filter(Boolean)
            : [];

        // A sala é um filtro (E), a busca livre é outro (E) — nunca um `$or`
        // sobrescrevendo o outro, que era o efeito de montar isso à mão.
        const query = busca.combinar(
            base,
            busca.filtroDeSala(turma, { idsEquivalentes: idsDaSala }),
            // O código secreto entra na busca aqui (e só aqui): esta é a tela
            // que existe para lê-lo.
            busca.filtroDeBusca(q, { incluirCodigo: true })
        );

        // ── Query única ──────────────────────────────────────────────────────
        const students = await Aluno.find(query)
            .select('nome sobrenome turma turmaId codigoSecreto responsavel matricula')
            .sort({ turma: 1, nome: 1 })
            .lean();

        // ── Geração dos códigos faltantes (em lote, dentro do request) ───────
        const missingIds = students
            .filter(
                (s) =>
                    !s.codigoSecreto || ['N/A', 'n/a', ''].includes(String(s.codigoSecreto).trim())
            )
            .map((s) => s._id);

        let novosCodigos = new Map();
        if (missingIds.length > 0) {
            novosCodigos = await assignSecretCodes(missingIds);
            logger.info(
                `[SECRET-CODES] ${novosCodigos.size}/${missingIds.length} código(s) gerado(s).`
            );
        }

        // ── Mapear turmas para exibição ──────────────────────────────────────
        // A chave é a forma canônica da sala (`1º A`, `1ºA` e `1A` colapsam em
        // "1A"). Com `.toUpperCase()` puro, o aluno cadastrado pela professora
        // como "1ºA" não encontrava a turma "1A" e caía no ramo de fallback,
        // aparecendo com o ano errado na lista de códigos.
        const turmaMap = {};
        turmas.forEach((t) => {
            [t.nome, t.id].forEach((valor) => {
                const key = busca.normalizarSala(valor);
                if (key && !turmaMap[key]) turmaMap[key] = t;
            });
        });

        // ── Montar resposta ──────────────────────────────────────────────────
        // Pendente = aluno que entrou sem código E cuja gravação não confirmou.
        // Nesse caso o problema é o documento em si (não uma espera), então o
        // front precisa dizer isso em vez de ficar recarregando para sempre.
        const naoGerados = missingIds.filter((id) => !novosCodigos.has(String(id)));
        const falhouSet = new Set(naoGerados.map(String));
        if (naoGerados.length > 0) {
            logger.warn(`[SECRET-CODES] ${naoGerados.length} aluno(s) sem código após a geração.`, {
                ids: naoGerados.map(String).slice(0, 20),
            });
        }

        const data = students.map((s) => {
            const studentTurmaKey = busca.normalizarSala(s.turma || s.turmaId || '');
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

            const codigoExibido =
                novosCodigos.get(String(s._id)) ||
                (falhouSet.has(String(s._id)) ? null : s.codigoSecreto) ||
                null;

            return {
                id: s._id,
                // Cadastros legados podem estar sem `nome`; concatenar direto
                // imprimia a string "undefined" na tela da direção.
                nome: [s.nome, s.sobrenome].filter(Boolean).join(' ') || '(sem nome)',
                ano,
                turma: turmaNome,
                // Sala como está gravada no aluno: é por ela que o filtro do
                // modal pergunta, então é ela que a tela precisa mostrar.
                sala: s.turma || s.turmaId || '',
                codigoSecreto: codigoExibido,
                codigoFalhou: falhouSet.has(String(s._id)),
                matricula: s.matricula || '-',
                vinculado: !!s.responsavel,
                responsavelEmail: s.responsavel || null,
            };
        });

        // ── Salas disponíveis para o filtro ──────────────────────────────────
        // Vai junto da listagem, e SEM os filtros aplicados: um seletor que
        // encolhe conforme o que já foi filtrado deixa a secretaria sem como
        // voltar para outra sala. Inclui as salas que só existem no cadastro do
        // aluno (turma digitada pela professora, sem documento `Turma`), senão
        // essas turmas ficam invisíveis no filtro.
        const salasDeTurmas = turmas.map((t) => t.nome || t.id).filter(Boolean);
        const salasDeAlunos = await Aluno.distinct('turma', {
            ...(req.escolaId ? { escolaId: req.escolaId } : {}),
            ativo: { $ne: false },
        });
        const salas = [];
        const vistas = new Set();
        salasDeTurmas.concat(salasDeAlunos).forEach((valor) => {
            const chave = busca.normalizarSala(valor);
            if (!chave || vistas.has(chave)) return;
            vistas.add(chave);
            salas.push(String(valor));
        });
        salas.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));

        // `pendingCodes` fica para clientes antigos que ainda fazem polling —
        // false porque não há mais nada sendo gerado em background.
        res.json({
            success: true,
            data,
            salas,
            pendingCodes: false,
            failedCodes: naoGerados.length,
        });
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
            $or: [{ _id: req.params.id }, { id: req.params.id }],
        });
        if (!aluno) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        // Multi-escola: só regenera código de aluno da escola ativa
        if (req.escolaId && aluno.escolaId && String(aluno.escolaId) !== String(req.escolaId)) {
            return res
                .status(403)
                .json({ success: false, error: 'Este aluno pertence a outra escola.' });
        }

        const codigoAnterior = aluno.codigoSecreto;
        aluno.codigoSecreto = await generateUniqueSecretCode();
        await aluno.save();

        const { logAction } = require('../utils/auditHelper');
        await logAction(req, 'REGENERATE_STUDENT_CODE', 'Aluno', {
            recursoId: aluno._id,
            descricao: `Código secreto do aluno "${aluno.nome}" regenerado (anterior invalidado).`,
        });

        res.json({
            success: true,
            message: 'Novo código gerado. O código anterior deixou de funcionar.',
            data: {
                alunoId: aluno._id,
                nome: `${aluno.nome}${aluno.sobrenome ? ' ' + aluno.sobrenome : ''}`,
                codigoSecreto: aluno.codigoSecreto,
                codigoAnteriorInvalidado: !!codigoAnterior,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
