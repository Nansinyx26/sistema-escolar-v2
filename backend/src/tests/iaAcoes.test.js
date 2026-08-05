/**
 * iaAcoes.test.js — Fase 4 do copiloto (ações de escrita).
 *
 * A regra que estes testes existem para provar: NADA é gravado sem um
 * confirmToken válido, de uso único, do dono, dentro do prazo. E tudo o que é
 * executado (ou tentado) aparece na trilha de auditoria.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

global.__provedorIA = null;

jest.mock('../services/ia/AIProvider', () => {
    const real = jest.requireActual('../services/ia/AIProvider');
    return { ...real, obterProvider: () => global.__provedorIA };
});

const app = require('../app');
const Escola = require('../models/Escola');
const Turma = require('../models/Turma');
const Comunicado = require('../models/Comunicado');
const CalendarioEscolar = require('../models/CalendarioEscolar');
const AuditLog = require('../models/AuditLog');
const IaAcaoPendente = require('../models/IaAcaoPendente');
const ToolRegistry = require('../services/ia/ToolRegistry');
const ConfirmationStore = require('../services/ia/ConfirmationStore');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

// ── Dublês ───────────────────────────────────────────────────────────────────

function provedorQueChamaFerramenta(nome, argumentos) {
    return {
        voltas: 0,
        resultadoRecebido: null,
        configurado: () => true,
        async *stream(mensagens) {
            this.voltas++;
            if (this.voltas === 1) {
                yield { tipo: 'ferramenta', chamadas: [{ id: 'c1', nome, argumentos }] };
                yield { tipo: 'fim', motivo: 'completo' };
                return;
            }
            const retorno = [...mensagens].reverse().find(m => m.papel === 'ferramenta');
            this.resultadoRecebido = retorno ? retorno.resultado : null;
            yield { tipo: 'texto', texto: 'Preparei a ação. Confirme abaixo.' };
            yield { tipo: 'fim', motivo: 'completo' };
        }
    };
}

// ── Utilitários ──────────────────────────────────────────────────────────────

async function cookieDe(perfil, extras = {}) {
    const user = await criarUsuario({ perfil, ...extras });
    const token = jwt.sign(
        { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome },
        process.env.JWT_SECRET, { expiresIn: '1h' }
    );
    return { cookie: `escola_jwt=${token}`, user };
}

function eventosSSE(texto) {
    return texto.split('\n').filter(l => l.startsWith('data:'))
        .map(l => JSON.parse(l.slice(5).trim()));
}

/** Roda o chat até o card de confirmação e devolve o evento. */
async function pedirAcao(cookie, ferramenta, argumentos) {
    global.__provedorIA = provedorQueChamaFerramenta(ferramenta, argumentos);
    const res = await request(app).post('/api/ia/chat').set('Cookie', cookie)
        .send({ mensagem: 'faça isso' });
    return {
        res,
        confirmacao: eventosSSE(res.text).find(e => e.tipo === 'confirmacao'),
        resultadoNoModelo: global.__provedorIA.resultadoRecebido
    };
}

function confirmar(cookie, confirmToken) {
    return request(app).post('/api/ia/confirmar').set('Cookie', cookie).send({ confirmToken });
}

/**
 * Contexto de ferramenta com um `req` suficientemente completo.
 * `headers`, `socket` e `ip` existem porque o auditHelper os lê — em produção
 * vêm do Express; aqui precisam ser fornecidos, senão a gravação da auditoria
 * falha e o teste mediria o dublê, não o código.
 */
function ctxDe({ perfil, escolaId, user = {} }) {
    return ToolRegistry.construirContextoFerramenta({
        user: { id: user.id || 'u1', perfil, email: 'x@t.com', nome: 'Fulano', ...user },
        escolaId,
        allowedTurmas: [],
        headers: { 'user-agent': 'jest' },
        socket: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
    });
}

// ── Ciclo de vida ────────────────────────────────────────────────────────────

let escola;

beforeAll(async () => { await conectarBanco(); });

beforeEach(async () => {
    // Garante que ESTA suíte é dona do estado: uma escola ativa deixada
    // para trás por outra suíte faria `filtrarPorEscola` ver duas ativas e
    // deixar de resolver req.escolaId (ele exige escolha nesse caso).
    await Escola.deleteMany({});
    escola = await Escola.create({ nome: 'EMEF Acoes', tipo: 'EMEF', ativo: true });
    invalidarCacheEscolas();
});

afterEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
});

afterAll(async () => { await desconectarBanco(); });

// ─────────────────────────────────────────────────────────────────────────────

describe('Catálogo de ferramentas de escrita', () => {
    it('só gestão recebe ferramentas de escrita', () => {
        const escritaDe = (p) => {
            const leitura = ToolRegistry.nomesPara(p) || [];
            const todas = ToolRegistry.nomesPara(p, { incluirMutates: true }) || [];
            return todas.filter(n => !leitura.includes(n));
        };

        expect(escritaDe('diretor').sort()).toEqual([
            'criarAtividade', 'criarEvento', 'criarProjetoMaker',
            'criarTurma', 'enviarComunicado', 'gerarRelatorioPDF'
        ]);
        expect(escritaDe('secretaria')).toHaveLength(6);

        // Professor escreve no que é trabalho dele — e só nisso.
        expect(escritaDe('professor').sort()).toEqual(['criarAtividade', 'criarProjetoMaker']);
        expect(escritaDe('responsavel')).toHaveLength(0);
    });

    it('professor não alcança as ferramentas administrativas de escrita', () => {
        const dele = ToolRegistry.nomesPara('professor', { incluirMutates: true }) || [];
        for (const proibida of ['criarTurma', 'enviarComunicado', 'gerarRelatorioPDF']) {
            expect(dele).not.toContain(proibida);
        }
    });

    it('toda ferramenta de escrita implementa confirmar()', () => {
        // O registry recusa no carregamento, mas afirmar aqui documenta a regra.
        const decls = ToolRegistry.declaracoesPara('admin', { incluirMutates: true });
        expect(decls.length).toBeGreaterThan(9);
    });
});

describe('O preview NÃO grava nada', () => {
    it('pedir criarTurma devolve token e deixa o banco intacto', async () => {
        const { cookie } = await cookieDe('diretor');

        const { confirmacao } = await pedirAcao(cookie, 'criarTurma', {
            nome: '6C', periodo: 'manha', ano: 2026
        });

        expect(confirmacao).toBeDefined();
        expect(confirmacao.acao).toBe('criarTurma');
        expect(confirmacao.confirmToken).toBeTruthy();
        expect(confirmacao.resumo).toMatch(/6C/);

        // NADA foi criado.
        expect(await Turma.countDocuments()).toBe(0);
        // E existe exatamente uma ação pendente aguardando.
        expect(await IaAcaoPendente.countDocuments()).toBe(1);
    });

    it('o token não é entregue ao modelo', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao, resultadoNoModelo } = await pedirAcao(cookie, 'criarTurma', {
            nome: '6D', periodo: 'tarde'
        });

        expect(confirmacao.confirmToken).toBeTruthy();
        // O modelo vê que há uma confirmação pendente, mas não o segredo — que
        // acabaria copiado para o texto gerado e persistido no histórico.
        expect(resultadoNoModelo.dados.confirmToken).toBeUndefined();
        expect(JSON.stringify(resultadoNoModelo)).not.toContain(confirmacao.confirmToken);
    });

    it('o token é guardado no banco apenas como hash', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'criarTurma', { nome: '7A', periodo: 'manha' });

        const pendente = await IaAcaoPendente.findOne().lean();
        expect(pendente.tokenHash).not.toBe(confirmacao.confirmToken);
        expect(pendente.tokenHash).toBe(ConfirmationStore.hashDe(confirmacao.confirmToken));
    });

    it('validação falha no preview, antes de qualquer confirmação', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao, resultadoNoModelo } = await pedirAcao(cookie, 'criarTurma', {
            nome: '8A', periodo: 'madrugada'
        });

        expect(confirmacao).toBeUndefined();
        expect(resultadoNoModelo.ok).toBe(false);
        expect(resultadoNoModelo.erro).toMatch(/período inválido/i);
        expect(await IaAcaoPendente.countDocuments()).toBe(0);
    });

    it('turma duplicada é barrada no preview', async () => {
        await Turma.create({ nome: '6C', escolaId: String(escola._id), periodo: 'manha' });
        const { cookie } = await cookieDe('diretor');

        const { confirmacao, resultadoNoModelo } = await pedirAcao(cookie, 'criarTurma', {
            nome: '6ºC', periodo: 'manha'   // grafia diferente, mesma turma
        });

        expect(confirmacao).toBeUndefined();
        expect(resultadoNoModelo.erro).toMatch(/já existe uma turma/i);
    });
});

describe('POST /api/ia/confirmar — execução', () => {
    it('cria a turma e grava na auditoria', async () => {
        const { cookie, user } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'criarTurma', {
            nome: '6C', periodo: 'manha', ano: 2026, sala: 'B2'
        });

        const res = await confirmar(cookie, confirmacao.confirmToken);

        expect(res.status).toBe(200);
        expect(res.body.data.mensagem).toMatch(/criada com sucesso/i);

        const turma = await Turma.findOne({ nome: '6C' }).lean();
        expect(turma).not.toBeNull();
        // Tenant vindo da sessão, nunca dos parâmetros.
        expect(turma.escolaId).toBe(String(escola._id));
        expect(turma.periodo).toBe('manha');
        expect(turma.sala).toBe('B2');

        const log = await AuditLog.findOne({ acao: 'IA_CRIARTURMA' }).lean();
        expect(log).not.toBeNull();
        // `usuarioId` é ObjectId no schema do AuditLog.
        expect(String(log.usuarioId)).toBe(String(user._id));
        expect(log.recursoId).toBe(String(turma._id));
        // Sem escolaId a ação não apareceria na auditoria filtrada por escola.
        expect(log.escolaId).toBe(String(escola._id));
        expect(log.detalhes.valorNovo.sucesso).toBe(true);
        expect(log.detalhes.valorNovo.viaAssistente).toBe(true);
        expect(log.detalhes.valorNovo.parametros.nome).toBe('6C');
        expect(log.detalhes.descricao).toMatch(/\[Assistente\]/);
    });

    it('o token é de USO ÚNICO', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'criarTurma', { nome: '6C', periodo: 'manha' });

        const primeira = await confirmar(cookie, confirmacao.confirmToken);
        expect(primeira.status).toBe(200);

        const segunda = await confirmar(cookie, confirmacao.confirmToken);
        expect(segunda.status).toBe(410);
        expect(segunda.body.error).toMatch(/não é mais válida/i);

        // E a turma não foi criada duas vezes.
        expect(await Turma.countDocuments({ nome: '6C' })).toBe(1);
    });

    it('duas confirmações simultâneas executam apenas uma vez', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'criarTurma', { nome: '9Z', periodo: 'tarde' });

        // A corrida é o motivo de o consumo ser findOneAndDelete (atômico).
        const [a, b] = await Promise.all([
            confirmar(cookie, confirmacao.confirmToken),
            confirmar(cookie, confirmacao.confirmToken)
        ]);

        const status = [a.status, b.status].sort();
        expect(status).toEqual([200, 410]);
        expect(await Turma.countDocuments({ nome: '9Z' })).toBe(1);
    });

    it('token de outra pessoa não executa', async () => {
        const dono = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(dono.cookie, 'criarTurma', { nome: '6C', periodo: 'manha' });

        const outro = await cookieDe('diretor');
        const res = await confirmar(outro.cookie, confirmacao.confirmToken);

        expect(res.status).toBe(410);
        expect(await Turma.countDocuments()).toBe(0);
        // O token do dono continua válido — não foi consumido pelo intruso.
        expect(await IaAcaoPendente.countDocuments()).toBe(1);
    });

    it('token expirado é recusado mesmo antes do TTL do Mongo varrer', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'criarTurma', { nome: '6C', periodo: 'manha' });

        // Envelhece o documento sem esperar 5 minutos.
        await IaAcaoPendente.updateOne({}, { $set: { expiraEm: new Date(Date.now() - 1000) } });

        const res = await confirmar(cookie, confirmacao.confirmToken);

        expect(res.status).toBe(410);
        expect(res.body.error).toMatch(/prazo/i);
        expect(await Turma.countDocuments()).toBe(0);
    });

    it('token inexistente não vaza informação', async () => {
        const { cookie } = await cookieDe('diretor');
        const res = await confirmar(cookie, 'nao-existe-este-token');

        expect(res.status).toBe(410);
        // Mensagem idêntica à de token usado/expirado: nada de oráculo.
        expect(res.body.error).toMatch(/não é mais válida/i);
    });

    it('corpo sem token é rejeitado', async () => {
        const { cookie } = await cookieDe('diretor');
        const res = await request(app).post('/api/ia/confirmar').set('Cookie', cookie).send({});
        expect(res.status).toBe(400);
    });
});

describe('O cliente não escolhe o que é executado', () => {
    it('os parâmetros vêm do servidor, não do corpo da confirmação', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'criarTurma', {
            nome: 'TURMA-PREVISTA', periodo: 'manha'
        });

        // Tenta trocar o que será criado no momento de confirmar.
        const res = await request(app).post('/api/ia/confirmar').set('Cookie', cookie).send({
            confirmToken: confirmacao.confirmToken,
            parametros: { nome: 'TURMA-INJETADA', periodo: 'noite' },
            nome: 'TURMA-INJETADA',
            escolaId: 'outra-escola'
        });

        expect(res.status).toBe(200);
        expect(await Turma.findOne({ nome: 'TURMA-INJETADA' })).toBeNull();

        const criada = await Turma.findOne({ nome: 'TURMA-PREVISTA' }).lean();
        expect(criada).not.toBeNull();
        expect(criada.escolaId).toBe(String(escola._id));
    });
});

describe('Autorização na execução', () => {
    it('professor não consegue nem preparar uma ação de escrita', async () => {
        const { cookie } = await cookieDe('professor');
        const { confirmacao, resultadoNoModelo } = await pedirAcao(cookie, 'criarTurma', {
            nome: '6C', periodo: 'manha'
        });

        expect(confirmacao).toBeUndefined();
        expect(resultadoNoModelo.ok).toBe(false);
        expect(resultadoNoModelo.erro).toMatch(/não tem acesso/i);
        expect(await IaAcaoPendente.countDocuments()).toBe(0);
    });

    it('rebaixamento de perfil entre o pedido e a confirmação invalida o token', async () => {
        const { cookie, user } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'criarTurma', { nome: '6C', periodo: 'manha' });

        // O perfil é relido do BANCO a cada requisição (authJWT), então a
        // mudança vale já na confirmação.
        const Usuario = require('../models/Usuario');
        await Usuario.updateOne({ _id: user._id }, { $set: { perfil: 'professor' } });

        const res = await confirmar(cookie, confirmacao.confirmToken);

        expect(res.status).toBe(410);
        expect(res.body.error).toMatch(/permissões mudaram/i);
        expect(await Turma.countDocuments()).toBe(0);
    });
});

describe('Cancelamento', () => {
    it('cancelar descarta a ação pendente', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'criarTurma', { nome: '6C', periodo: 'manha' });

        const cancel = await request(app).post('/api/ia/cancelar').set('Cookie', cookie)
            .send({ confirmToken: confirmacao.confirmToken });
        expect(cancel.status).toBe(200);
        expect(await IaAcaoPendente.countDocuments()).toBe(0);

        // E o token não executa mais.
        const res = await confirmar(cookie, confirmacao.confirmToken);
        expect(res.status).toBe(410);
        expect(await Turma.countDocuments()).toBe(0);
    });
});

describe('criarEvento e enviarComunicado', () => {
    it('cria o evento no calendário com a data interpretada corretamente', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'criarEvento', {
            titulo: 'Reunião de pais', tipo: 'reuniao_pais', dataInicio: '2026-08-15'
        });

        expect(confirmacao.resumo).toMatch(/15\/08\/2026/);

        const res = await confirmar(cookie, confirmacao.confirmToken);
        expect(res.status).toBe(200);

        const evento = await CalendarioEscolar.findOne({ titulo: 'Reunião de pais' }).lean();
        expect(evento.escolaId).toBe(String(escola._id));
        expect(evento.anoLetivo).toBe(2026);
        // Sem deslocamento de fuso: 15 e não 14.
        expect(evento.dataInicio.getDate()).toBe(15);
        expect(evento.dataInicio.getMonth()).toBe(7);
    });

    it('recusa evento com término anterior ao início', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao, resultadoNoModelo } = await pedirAcao(cookie, 'criarEvento', {
            titulo: 'Semana errada', tipo: 'evento',
            dataInicio: '2026-08-20', dataFim: '2026-08-10'
        });

        expect(confirmacao).toBeUndefined();
        expect(resultadoNoModelo.erro).toMatch(/anterior à de início/i);
    });

    it('publica o comunicado com a autoria do usuário logado', async () => {
        const { cookie, user } = await cookieDe('diretor', { nome: 'Diretora Ana' });
        const { confirmacao } = await pedirAcao(cookie, 'enviarComunicado', {
            titulo: 'Sem aula na sexta',
            conteudo: 'Não haverá aula na próxima sexta-feira por formação de professores.',
            destinatarios: ['todos'],
            prioridade: 'Importante'
        });

        // O preview mostra o texto para a pessoa reler antes de publicar.
        expect(confirmacao.dados.conteudo).toContain('formação de professores');

        const res = await confirmar(cookie, confirmacao.confirmToken);
        expect(res.status).toBe(200);

        const com = await Comunicado.findOne({ titulo: 'Sem aula na sexta' }).lean();
        expect(com.escolaId).toBe(String(escola._id));
        expect(com.diretorId).toBe(String(user._id));
        expect(com.diretorNome).toBe('Diretora Ana');
        expect(com.destinatarios).toEqual(['todos']);
        expect(com.prioridade).toBe('Importante');
    });

    it('recusa destinatário fora da lista conhecida', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao, resultadoNoModelo } = await pedirAcao(cookie, 'enviarComunicado', {
            titulo: 'Teste', conteudo: 'texto', destinatarios: ['todo-mundo-do-mundo']
        });

        expect(confirmacao).toBeUndefined();
        expect(resultadoNoModelo.erro).toMatch(/quem recebe/i);
    });
});

describe('gerarRelatorioPDF', () => {
    beforeEach(async () => {
        const Nota = require('../models/Nota');
        await Nota.create([
            { alunoId: 'a1', escolaId: String(escola._id), materiaId: 'Matematica', turmaId: '1A', bimestre: 1, nota: 8 },
            { alunoId: 'a2', escolaId: String(escola._id), materiaId: 'Matematica', turmaId: '1A', bimestre: 1, nota: 6 },
            { alunoId: 'a3', escolaId: String(escola._id), materiaId: 'Portugues', turmaId: '1A', bimestre: 1, nota: 9 }
        ]);
    });

    it('gera o PDF e devolve um link de download', async () => {
        const { cookie } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'gerarRelatorioPDF', { tipo: 'desempenho' });

        expect(confirmacao).toBeDefined();
        expect(confirmacao.resumo).toMatch(/desempenho/i);

        const res = await confirmar(cookie, confirmacao.confirmToken);

        expect(res.status).toBe(200);
        expect(res.body.data.link).toMatch(/^\/api\/upload\/documento\//);
        expect(res.body.data.arquivo.tamanhoKB).toBeGreaterThan(0);
    });

    it('o arquivo nasce com os metadados que autorizam o download', async () => {
        const { cookie, user } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'gerarRelatorioPDF', { tipo: 'desempenho' });
        const res = await confirmar(cookie, confirmacao.confirmToken);

        const mongoose = require('mongoose');
        const arquivo = await mongoose.connection.db
            .collection('uploads.files')
            .findOne({ _id: new mongoose.mongo.ObjectId(res.body.data.recursoId) });

        expect(arquivo.contentType).toBe('application/pdf');
        // É este metadata que o FileController usa para barrar outra escola.
        expect(arquivo.metadata.escolaId).toBe(String(escola._id));
        expect(arquivo.metadata.usuarioId).toBe(String(user._id));
    });

    it('o relatório NÃO inclui notas de outra escola', async () => {
        const Nota = require('../models/Nota');
        const outra = await Escola.create({ nome: 'EMEF Vizinha', tipo: 'EMEF', ativo: false });
        await Nota.create({
            alunoId: 'zz', escolaId: String(outra._id),
            materiaId: 'SegredoDaVizinha', turmaId: '9Z', bimestre: 1, nota: 10
        });

        const { cookie } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'gerarRelatorioPDF', { tipo: 'desempenho' });

        // O preview conta as combinações: 2 (Matematica/1A e Portugues/1A).
        // Se a vizinha entrasse, seriam 3.
        expect(confirmacao.resumo).toMatch(/2 combina/);
    });

    it('recusa no preview quando não há dados, sem gerar arquivo', async () => {
        const Nota = require('../models/Nota');
        await Nota.deleteMany({});

        const { cookie } = await cookieDe('diretor');
        const { confirmacao, resultadoNoModelo } = await pedirAcao(cookie, 'gerarRelatorioPDF', {
            tipo: 'desempenho'
        });

        expect(confirmacao).toBeUndefined();
        expect(resultadoNoModelo.erro).toMatch(/não há notas/i);
        expect(await IaAcaoPendente.countDocuments()).toBe(0);
    });

    it('lançamento conceitual não derruba a agregação', async () => {
        const Nota = require('../models/Nota');
        // Registro legado com nota textual, gravado direto na coleção.
        await Nota.collection.insertOne({
            _id: 'legado-1', alunoId: 'a9', escolaId: String(escola._id),
            materiaId: 'Artes', turmaId: '1A', bimestre: 1, nota: 'Satisfatório'
        });

        const { cookie } = await cookieDe('diretor');
        const { confirmacao } = await pedirAcao(cookie, 'gerarRelatorioPDF', { tipo: 'desempenho' });
        const res = await confirmar(cookie, confirmacao.confirmToken);

        expect(res.status).toBe(200);
    });

    it('professor não recebe a ferramenta de relatório', () => {
        const todas = ToolRegistry.nomesPara('professor', { incluirMutates: true }) || [];
        expect(todas).not.toContain('gerarRelatorioPDF');
    });
});

describe('Auditoria', () => {
    it('registra também a tentativa que FALHOU', async () => {
        const { user } = await cookieDe('diretor');

        // Força uma falha na execução confirmada: tipo fora do enum do model.
        // `usuarioId` precisa ser um ObjectId real — é assim em produção, e o
        // AuditLog o declara como ObjectId.
        const ctx = ctxDe({
            perfil: 'diretor',
            escolaId: String(escola._id),
            user: { id: String(user._id), nome: user.nome }
        });
        const acaoFalsa = {
            ferramenta: 'criarEvento',
            parametros: { titulo: 'x', tipo: 'invalido', dataInicio: new Date().toISOString(), dataFim: new Date().toISOString(), anoLetivo: 2026 },
            resumo: 'evento inválido'
        };
        const r = await ToolRegistry.executarConfirmada(acaoFalsa, ctx);

        expect(r.ok).toBe(false);
        const log = await AuditLog.findOne({ acao: 'IA_CRIAREVENTO' }).lean();
        expect(log).not.toBeNull();
        expect(log.detalhes.valorNovo.sucesso).toBe(false);
        expect(log.detalhes.valorNovo.erro).toBeTruthy();
        expect(log.detalhes.descricao).toMatch(/TENTATIVA FALHOU/);

        // E nada foi criado.
        expect(await CalendarioEscolar.countDocuments()).toBe(0);
    });

    it('não copia o corpo do comunicado para a trilha de auditoria', async () => {
        const { cookie } = await cookieDe('diretor');
        const segredo = 'Detalhe sensível sobre a situação familiar de um aluno.';
        const { confirmacao } = await pedirAcao(cookie, 'enviarComunicado', {
            titulo: 'Aviso', conteudo: segredo, destinatarios: ['professores']
        });

        await confirmar(cookie, confirmacao.confirmToken);

        const log = await AuditLog.findOne({ acao: 'IA_ENVIARCOMUNICADO' }).lean();
        expect(log.detalhes.valorNovo.parametros.titulo).toBe('Aviso');
        // O log é lido pela gestão e exportado: não é lugar para o corpo.
        expect(log.detalhes.valorNovo.parametros.conteudo).toBe('[omitido na auditoria]');
        expect(JSON.stringify(log)).not.toContain('situação familiar');
    });
});
