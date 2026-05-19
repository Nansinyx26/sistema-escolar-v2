const Aluno = require('../models/Aluno');
const ImageProcessor = require('../utils/imageProcessor');
const { saveToGridFS, deleteFile } = require('../utils/gridfs');
const escapeRegex = require('../utils/escapeRegex');

// Whitelist de campos permitidos para o Aluno (Prevenção de Injeção de Parâmetros)
const studentWhitelist = [
    'nome', 'matricula', 'turma', 'turmaId', 'email', 'telefone', 
    'dataNascimento', 'nascimento', 'sexo', 'foto', 'ativo', 'observacoes', 
    'responsavelNome', 'responsavelTelefone', 'responsavel',
    'nivel', 'nivelBimestre', 'condicao', 'condicaoOutro',
    'observacoesBimestre', 'recuperacaoBimestre', 'faltasBimestre',
    'deficiencia', 'pcd'
];

exports.list = async (req, res) => {
    try {
        const { turma, turmaId, q, page = 1, limit = 100 } = req.query;
        const query = { ativo: { $ne: false } };

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
        const student = await Aluno.findOne({
            $or: [{ _id: req.params.id }, { id: req.params.id }, { matricula: req.params.id }]
        });

        if (!student) return res.status(404).json({ success: false, error: 'Aluno não encontrado' });

        const studentData = student.toObject();
        studentData.id = studentData.id || studentData._id;

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
        res.status(201).json({ success: true, data: student });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
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

        const student = await Aluno.findOneAndUpdate(
            { $or: [{ _id: req.params.id }, { id: req.params.id }] },
            filteredBody,
            { new: true, runValidators: true }
        );
        if (!student) return res.status(404).json({ success: false, error: 'Aluno não encontrado' });
        res.json({ success: true, data: student });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.delete = async (req, res) => {
    try {
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
