/**
 * chatDireto.canalDaFamilia.test.js — a família fala com a SECRETARIA, e só.
 *
 * A POLÍTICA (Issue #204)
 * -----------------------
 * O responsável não conversa com professor nem com a direção pelo chat. O canal
 * dele é a secretaria — e não uma secretaria qualquer: a da escola em que o
 * filho está matriculado. Entre si, professor, direção e secretaria continuam
 * conversando como antes; o que fechou foi a ponta que ligava a família
 * diretamente ao docente e ao diretor.
 *
 * O QUE ESTA SUÍTE PRECISA PROVAR
 * -------------------------------
 *   1. os dois sentidos estão fechados — a autorização roda em quem ENVIA,
 *      então barrar só o responsável deixaria o professor abrir o mesmo canal
 *      pelo outro lado;
 *   2. nada é gravado quando a recusa acontece (403 que ainda persiste a
 *      mensagem não bloqueia nada — só esconde);
 *   3. a secretaria certa é a da escola do filho, não a da sessão. Um
 *      responsável NÃO tem vínculo de equipe, então `filtrarPorEscola` resolve
 *      a escola dele pelo ramo "escola ativa única" da rede — que não é, e não
 *      tem como ser, a matrícula do filho;
 *   4. a regra é reavaliada a cada mensagem, não só na abertura da conversa;
 *   5. a lista de contatos concorda com o envio (o teste de coerência mora em
 *      `chatDiretoContatos.test.js`, este arquivo cobre o envio).
 *
 * Todos os nomes, e-mails e RAs aqui são inventados.
 */
const request = require('supertest');
const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');

const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const Aluno = require('../models/Aluno');
const ChatDireto = require('../models/ChatDireto');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let escola;
let dispensa2FAOriginal;

beforeAll(async () => {
    await conectarBanco();

    // Diretor e secretaria exigem segundo fator por padrão (utils/politica2FA.js):
    // o login responde 200 mas NÃO emite o cookie, e a requisição seguinte cai
    // em 401. Este arquivo testa autorização de conversa, não o segundo fator.
    dispensa2FAOriginal = process.env.DISPENSAR_2FA_EMAIL;
    process.env.DISPENSAR_2FA_EMAIL = 'diretor,secretaria';
});

afterAll(async () => {
    // Restaurado para não vazar a dispensa para outras suítes do mesmo worker.
    if (dispensa2FAOriginal === undefined) delete process.env.DISPENSAR_2FA_EMAIL;
    else process.env.DISPENSAR_2FA_EMAIL = dispensa2FAOriginal;
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({
        nome: 'EE Canal da Familia',
        tipo: 'EMEF',
        bairro: 'Centro',
        codigoSecreto: 'CANAL-A',
        ativo: true,
    });
    // O estado global de escolas fica memoizado por 60s. Aqui a escola é
    // recriada a cada teste, então sem invalidar o cache ele segue apontando
    // para a anterior — já apagada — e quem depende do ramo "escola ativa
    // única" (o responsável) leva 403 por um motivo que nada tem a ver com a
    // política sob teste.
    invalidarCacheEscolas();
});

const MODELO_DO_CARGO = { professor: Professor, diretor: Diretor, secretaria: Secretaria };

/**
 * Cria a conta, o documento de cargo (quando houver) e abre a sessão.
 *
 * O `escolaId` NÃO vai no corpo do login, de propósito: mandá-lo faz o
 * UserController exigir vínculo de equipe, e responsável nunca tem um. Sem o
 * campo, cada requisição resolve a escola no `filtrarPorEscola` — vínculo único
 * para a equipe, escola ativa única para o resto.
 */
async function conta(email, perfil, { escolaDoCargo, ...dadosDoCargo } = {}) {
    const user = await criarUsuario({ email, perfil, escolaId: String(escola._id) });

    const Modelo = MODELO_DO_CARGO[perfil];
    if (Modelo) {
        await Modelo.create({
            idUsuario: String(user._id),
            nome: user.nome,
            email,
            vinculos: [{ escolaId: String(escolaDoCargo || escola._id), cargo: perfil }],
            ativo: true,
            ...dadosDoCargo,
        });
    }

    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(login.status).toBe(200);
    return { agent, user, id: String(user._id), email, perfil };
}

/** Responsável com um filho matriculado. `semFilho` cria a conta órfã. */
async function responsavelDe(email, { turma = '3B', semFilho = false } = {}) {
    const sessao = await conta(email, 'responsavel');
    if (!semFilho) {
        await Aluno.create({
            escolaId: String(escola._id),
            nome: 'CRIANCA INVENTADA DA SILVA',
            turma,
            responsavel: email,
            ativo: true,
        });
    }
    return sessao;
}

const enviar = (sessao, paraId) =>
    sessao.agent
        .post('/api/chat-direto/enviar')
        .send({ destinatarioId: paraId, mensagem: 'Bom dia, tudo bem?' });

describe('professor, direção e suporte estão fechados para a família', () => {
    it.each(['professor', 'diretor', 'admin'])(
        'BARRA responsável → %s, e não grava nada',
        async (perfil) => {
            const equipe = await conta(`${perfil}.fechado@escola.test`, perfil);
            const mae = await responsavelDe(`mae.para.${perfil}@escola.test`);

            const res = await enviar(mae, equipe.id);

            expect(res.status).toBe(403);
            expect(await ChatDireto.countDocuments()).toBe(0);
        }
    );

    it.each(['professor', 'diretor', 'admin'])('BARRA também %s → responsável', async (perfil) => {
        const equipe = await conta(`${perfil}.fechado2@escola.test`, perfil);
        const mae = await responsavelDe(`mae.de.${perfil}@escola.test`);

        const res = await enviar(equipe, mae.id);

        expect(res.status).toBe(403);
        expect(await ChatDireto.countDocuments()).toBe(0);
    });

    it('a recusa diz PARA ONDE ir, sem revelar quem existe do outro lado', async () => {
        const professor = await conta('prof.recusa@escola.test', 'professor');
        const mae = await responsavelDe('mae.recusa@escola.test');

        const res = await enviar(mae, professor.id);

        expect(res.body.error).toMatch(/secretaria/i);
        // Nem o nome da turma nem o do aluno podem vazar na mensagem de erro:
        // quem sonda a lista de alunos aprenderia pela própria recusa.
        expect(res.body.error).not.toMatch(/3B|CRIANCA/i);
    });

    it('BARRA o par mesmo com o professor da turma do filho', async () => {
        // O recorte por turma em comum (Issue #68) autorizava exatamente este
        // par. A política atual não o reabre — o par inteiro deixou de existir.
        const professor = await conta('prof.da.turma@escola.test', 'professor', {
            salaPrincipal: '3B',
        });
        const mae = await responsavelDe('mae.da.turma@escola.test', { turma: '3B' });

        expect((await enviar(mae, professor.id)).status).toBe(403);
        expect((await enviar(professor, mae.id)).status).toBe(403);
    });

    it('responsável continua sem falar com responsável', async () => {
        const mae = await responsavelDe('mae.a@escola.test');
        const pai = await responsavelDe('pai.b@escola.test');

        expect((await enviar(mae, pai.id)).status).toBe(403);
    });
});

describe('a equipe escolar continua conversando entre si', () => {
    it.each([
        ['professor', 'diretor'],
        ['professor', 'secretaria'],
        ['diretor', 'secretaria'],
        ['professor', 'professor'],
        // O suporte segue alcançável por quem trabalha na escola — o que a
        // política fechou foi a ponta da família, não o canal de suporte.
        ['admin', 'professor'],
        ['admin', 'secretaria'],
    ])('%s ↔ %s', async (perfilA, perfilB) => {
        const a = await conta(`${perfilA}.eq1.${perfilB}@escola.test`, perfilA);
        const b = await conta(`${perfilB}.eq2.${perfilA}@escola.test`, perfilB);

        expect((await enviar(a, b.id)).status).toBe(200);
        expect((await enviar(b, a.id)).status).toBe(200);
    });
});

describe('a secretaria é a da escola do filho', () => {
    it('LIBERA nos dois sentidos quando o filho estuda na escola dela', async () => {
        const secretaria = await conta('sec.certa@escola.test', 'secretaria');
        const mae = await responsavelDe('mae.certa@escola.test');

        expect((await enviar(mae, secretaria.id)).status).toBe(200);
        expect((await enviar(secretaria, mae.id)).status).toBe(200);
        expect(await ChatDireto.countDocuments()).toBe(2);
    });

    it('BARRA a secretaria de OUTRA escola da rede', async () => {
        // A escola do filho e a escola da secretaria são unidades diferentes.
        // A sessão do responsável não distingue as duas sozinha: sem vínculo de
        // equipe, `filtrarPorEscola` resolve a escola dele pela escola ATIVA da
        // rede — por isso a segunda unidade nasce inativa aqui, como acontece
        // durante a implantação de uma escola nova.
        const outra = await Escola.create({
            nome: 'EE Vizinha',
            tipo: 'EMEF',
            bairro: 'Sul',
            codigoSecreto: 'CANAL-B',
            ativo: false,
        });
        invalidarCacheEscolas();

        const secretariaVizinha = await conta('sec.vizinha@escola.test', 'secretaria', {
            escolaDoCargo: String(outra._id),
        });
        const mae = await responsavelDe('mae.daqui@escola.test');

        const res = await enviar(mae, secretariaVizinha.id);

        expect(res.status).toBe(403);
        expect(await ChatDireto.countDocuments()).toBe(0);
    });

    it('BARRA o responsável SEM filho cadastrado — falha fechada', async () => {
        const secretaria = await conta('sec.sem.filho@escola.test', 'secretaria');
        const semFilho = await responsavelDe('mae.sem.filho@escola.test', { semFilho: true });

        expect((await enviar(semFilho, secretaria.id)).status).toBe(403);
        expect((await enviar(secretaria, semFilho.id)).status).toBe(403);
    });

    it('LIBERA o filho de cadastro LEGADO, sem escolaId', async () => {
        // Aluno anterior ao multi-escola: não há escola para comparar, e negar
        // por isso bloquearia a rede inteira enquanto a migração não roda. O
        // recorte que vale nesse caso é o da sessão, conferido antes.
        const secretaria = await conta('sec.legado@escola.test', 'secretaria');
        const mae = await conta('mae.legado@escola.test', 'responsavel');
        await Aluno.create({
            nome: 'CRIANCA INVENTADA DA SILVA',
            turma: '3B',
            responsavel: 'mae.legado@escola.test',
            ativo: true,
        });

        expect((await enviar(mae, secretaria.id)).status).toBe(200);
    });

    it('reavalia a CADA mensagem, não só na primeira', async () => {
        const secretaria = await conta('sec.transf@escola.test', 'secretaria');
        const mae = await responsavelDe('mae.transf@escola.test');

        expect((await enviar(mae, secretaria.id)).status).toBe(200);

        // O aluno é transferido para outra unidade no meio do ano. A conversa
        // já existe, mas a próxima mensagem tem de ser barrada — autorizar só
        // na abertura deixaria o canal aberto para sempre.
        const outra = await Escola.create({
            nome: 'EE Destino',
            tipo: 'CIEP',
            bairro: 'Norte',
            codigoSecreto: 'CANAL-C',
            ativo: false,
        });
        await Aluno.updateMany({}, { $set: { escolaId: String(outra._id) } });

        expect((await enviar(mae, secretaria.id)).status).toBe(403);
        expect(await ChatDireto.countDocuments()).toBe(1);
    });
});

/**
 * A CONVERSA ANTERIOR TAMBÉM SOME.
 *
 * Fechar só o envio deixaria a política pela metade: as conversas com professor,
 * direção e suporte EXISTEM no banco, e um GET no histórico as devolveria
 * inteiras para os dois lados. Aqui as mensagens são gravadas direto no modelo,
 * sem passar pelo envio, justamente porque o envio já não as aceitaria — é o
 * histórico legado que estes casos representam.
 */
describe('o histórico de um par fechado deixa de ser alcançável', () => {
    /** Grava uma conversa antiga entre dois usuários, sem passar pela API. */
    const conversaAntiga = (de, para) =>
        ChatDireto.create({
            remetenteId: de.id,
            destinatarioId: para.id,
            escolaId: String(escola._id),
            mensagem: 'combinamos a reunião de quinta',
        });

    it.each(['professor', 'diretor', 'admin'])(
        'responsável não lê o histórico com %s',
        async (perfil) => {
            const equipe = await conta(`${perfil}.hist@escola.test`, perfil);
            const mae = await responsavelDe(`mae.hist.${perfil}@escola.test`);
            await conversaAntiga(equipe, mae);

            const res = await mae.agent.get(`/api/chat-direto/historico/${equipe.id}`);

            expect(res.status).toBe(403);
            expect(res.body.data).toBeUndefined();
        }
    );

    it('e o outro lado também não — a regra é do par', async () => {
        const professor = await conta('prof.hist2@escola.test', 'professor');
        const mae = await responsavelDe('mae.hist2@escola.test');
        await conversaAntiga(mae, professor);

        expect((await professor.agent.get(`/api/chat-direto/historico/${mae.id}`)).status).toBe(
            403
        );
    });

    it('a conversa com a secretaria continua legível', async () => {
        const secretaria = await conta('sec.hist@escola.test', 'secretaria');
        const mae = await responsavelDe('mae.hist.sec@escola.test');
        await conversaAntiga(secretaria, mae);

        const res = await mae.agent.get(`/api/chat-direto/historico/${secretaria.id}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });

    it('reagir a uma mensagem do fio fechado é recusado', async () => {
        // `editarMensagem` se resolve sozinho pela janela de 15 minutos; reagir
        // não tem prazo, e sem barreira seria a última forma de a família ainda
        // alcançar o professor.
        const professor = await conta('prof.reacao@escola.test', 'professor');
        const mae = await responsavelDe('mae.reacao@escola.test');
        const msg = await conversaAntiga(professor, mae);

        const res = await mae.agent
            .post('/api/chat-direto/reagir')
            .send({ mensagemId: String(msg._id), emoji: '👍' });

        expect(res.status).toBe(403);
        expect((await ChatDireto.findById(msg._id)).reacoes).toHaveLength(0);
    });

    it('o selo de não lidas não conta o que a família não pode abrir', async () => {
        const professor = await conta('prof.selo@escola.test', 'professor');
        const admin = await conta('admin.selo@escola.test', 'admin');
        const secretaria = await conta('sec.selo@escola.test', 'secretaria');
        const mae = await responsavelDe('mae.selo@escola.test');

        await conversaAntiga(professor, mae);
        await conversaAntiga(admin, mae);
        await conversaAntiga(secretaria, mae);

        const res = await mae.agent.get('/api/chat-direto/nao-lidas');

        // Só a da secretaria. Sem o filtro o selo mostraria 3 e levaria a uma
        // tela sem contato nenhum para abrir — um número que nunca zera.
        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(1);
    });

    it('o selo da equipe não muda: o professor continua contando o suporte', async () => {
        const professor = await conta('prof.selo2@escola.test', 'professor');
        const admin = await conta('admin.selo2@escola.test', 'admin');
        const colega = await conta('prof.selo3@escola.test', 'professor');

        await conversaAntiga(admin, professor);
        await conversaAntiga(colega, professor);

        const res = await professor.agent.get('/api/chat-direto/nao-lidas');

        expect(res.body.data.total).toBe(2);
    });
});

describe('a política vale em todas as portas do chat, não só no envio', () => {
    it('encaminhar não contorna a matriz', async () => {
        const secretaria = await conta('sec.enc@escola.test', 'secretaria');
        const professor = await conta('prof.enc@escola.test', 'professor');
        const mae = await responsavelDe('mae.enc@escola.test');

        const enviada = await enviar(secretaria, mae.id);
        expect(enviada.status).toBe(200);
        const mensagemIds = [String(enviada.body.data._id)];

        // A mãe tenta repassar ao professor a mensagem que recebeu da escola.
        const res = await mae.agent
            .post('/api/chat-direto/encaminhar')
            .send({ mensagemIds, destinatarioIds: [professor.id] });

        expect(res.status).toBe(403);
        // O encaminhamento não cria mensagem nenhuma: só a original existe.
        expect(await ChatDireto.countDocuments()).toBe(1);
    });

    it('a presença do professor não é consultável pela família', async () => {
        const professor = await conta('prof.presenca@escola.test', 'professor');
        const mae = await responsavelDe('mae.presenca@escola.test');

        const res = await mae.agent.get(`/api/chat-direto/presenca/${professor.id}`);

        expect(res.status).toBe(403);
    });
});
