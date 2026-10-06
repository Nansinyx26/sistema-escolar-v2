/**
 * notificacaoDoComunicadoSoAoPublico.test.js — Issue #686
 *
 * Ao publicar um comunicado para uma turma, o `notification:new` (com o
 * conteúdo inteiro) ia para `role:professor` e `role:responsavel` da escola
 * INTEIRA. A #663 fechou o `comunicado:new`; este é o caminho paralelo. Agora a
 * turma é resolvida em contas: professores dela e responsáveis dos alunos dela.
 */
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Professor = require('../models/Professor');
const NotificationService = require('../services/NotificationService');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

let A;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    A = String((await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true }))._id);
});
afterEach(() => {
    delete global.io;
});

async function familia(turma) {
    const email = `fam.${Math.random().toString(36).slice(2)}@escola.test`;
    const usuario = await criarUsuario({ perfil: 'responsavel', email, escolaId: A });
    await Aluno.create({ nome: 'Filho', turma, ativo: true, escolaId: A, responsavel: email });
    return usuario;
}

async function professorDa(turma) {
    const usuario = await criarUsuario({ perfil: 'professor', escolaId: A });
    await Professor.create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        salaPrincipal: turma,
        vinculos: [{ escolaId: A, cargo: 'professor' }],
        ativo: true,
    });
    return usuario;
}

/**
 * Servidor de sockets simulado: cada socket tem as salas do handshake
 * (`user:<id>`, `role:<perfil>`, `escola:<id>`). Registra quem recebeu e o quê.
 */
function servidor(sockets) {
    const recebidos = new Map();
    const registrar = (nome, evento) => recebidos.set(nome, evento);
    global.io = {
        to: (sala) => ({
            emit: (_ev, evento) => {
                const salas = Array.isArray(sala) ? sala : [sala];
                for (const s of sockets) {
                    if (salas.some((x) => s.salas.includes(x))) registrar(s.nome, evento);
                }
            },
        }),
        in: (sala) => ({
            fetchSockets: async () =>
                sockets
                    .filter((s) => s.salas.includes(sala))
                    .map((s) => ({
                        rooms: new Set(s.salas),
                        emit: (_ev, evento) => registrar(s.nome, evento),
                    })),
        }),
    };
    return recebidos;
}

const socketDe = (nome, usuario) => ({
    nome,
    salas: [`user:${usuario._id}`, `role:${usuario.perfil}`, `escola:${A}`],
});

async function escolaConectada() {
    const diretor = await criarUsuario({ perfil: 'diretor', escolaId: A });
    const prof1A = await professorDa('1A');
    const prof2B = await professorDa('2B');
    const fam1A = await familia('1A');
    const fam2B = await familia('2B');
    const recebidos = servidor([
        socketDe('diretor', diretor),
        socketDe('professor-1A', prof1A),
        socketDe('professor-2B', prof2B),
        socketDe('familia-1A', fam1A),
        socketDe('familia-2B', fam2B),
    ]);
    return { recebidos, prof1A, prof2B, fam1A, fam2B };
}

const avisoDaTurma = (destinatarios) =>
    NotificationService.notify({
        tipo: 'informativo',
        titulo: 'Passeio da 1A',
        mensagem: 'Resumo',
        corpoHtml: '<p>Conteúdo inteiro do passeio</p>',
        destinatarios,
        criadoPor: 'diretor',
        escolaId: A,
    });

it('comunicado para turma:1A chega só à família e ao professor da 1A', async () => {
    const { recebidos } = await escolaConectada();

    await avisoDaTurma(['turma:1A']);

    expect([...recebidos.keys()].sort()).toEqual(['familia-1A', 'professor-1A']);
});

it('turma escrita como "1ºA" alcança a mesma turma', async () => {
    const { recebidos } = await escolaConectada();

    await avisoDaTurma(['turma:1ºA']);

    expect([...recebidos.keys()].sort()).toEqual(['familia-1A', 'professor-1A']);
});

it('aviso interno da turma (sem famílias) não chega a responsável', async () => {
    const { recebidos } = await escolaConectada();

    await NotificationService.notify({
        titulo: 'Interno da 1A',
        mensagem: 'Resumo',
        destinatarios: ['turma:1A'],
        paraResponsavel: false,
        criadoPor: 'diretor',
        escolaId: A,
    });

    expect([...recebidos.keys()]).toEqual(['professor-1A']);
});

it('o push da turma vai só para as contas da turma', async () => {
    const { fam1A, prof1A } = await escolaConectada();

    const contas = await NotificationService.getTargetUsers(['turma:1A'], A);

    expect(contas.map((u) => String(u._id)).sort()).toEqual(
        [String(fam1A._id), String(prof1A._id)].sort()
    );
});

it('aviso para todos continua chegando à escola inteira', async () => {
    const { recebidos } = await escolaConectada();

    await avisoDaTurma(['todos']);

    expect([...recebidos.keys()].sort()).toEqual([
        'diretor',
        'familia-1A',
        'familia-2B',
        'professor-1A',
        'professor-2B',
    ]);
});
