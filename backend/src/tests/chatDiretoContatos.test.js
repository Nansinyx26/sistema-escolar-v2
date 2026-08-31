/**
 * chatDiretoContatos.test.js — GET /api/chat-direto/contatos (Issue #69).
 *
 * O TESTE QUE IMPORTA É O DE CONSISTÊNCIA
 * ---------------------------------------
 * `listarContatos` responde "quem?" e `podeConversar` responde "este aqui,
 * pode?". São dois caminhos para a MESMA regra, escritos de formas diferentes
 * por causa do custo — um calcula conjuntos de uma vez, o outro confere um par.
 * Regra duplicada é regra que diverge.
 *
 * Por isso o bloco "a lista concorda com o envio" varre todas as contas da
 * escola e, para cada uma, compara a presença na lista com o que o POST
 * /enviar realmente faz. Ele pega divergência que nenhum teste de caso isolado
 * pegaria, porque não depende de eu ter imaginado o caso certo.
 *
 * Todos os nomes e e-mails aqui são inventados.
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
const Usuario = require('../models/Usuario');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let escola;
let dispensa2FAOriginal;

beforeAll(async () => {
    await conectarBanco();
    // Diretor e secretaria exigem segundo fator por padrão; o login devolve 200
    // sem cookie e a requisição seguinte cai em 401. Aqui o assunto é a lista de
    // contatos, não o segundo fator.
    dispensa2FAOriginal = process.env.DISPENSAR_2FA_EMAIL;
    process.env.DISPENSAR_2FA_EMAIL = 'diretor,secretaria';
});

afterAll(async () => {
    if (dispensa2FAOriginal === undefined) delete process.env.DISPENSAR_2FA_EMAIL;
    else process.env.DISPENSAR_2FA_EMAIL = dispensa2FAOriginal;
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({
        nome: 'EE Contatos',
        tipo: 'EMEF',
        bairro: 'Centro',
        codigoSecreto: 'CONT-69-A',
        ativo: true,
    });
    // O estado de escolas é memoizado por 60s e a escola é recriada a cada
    // teste; sem invalidar, quem depende do ramo "escola ativa única" recebe a
    // escola anterior, já apagada.
    invalidarCacheEscolas();
});

const MODELO_DO_CARGO = { professor: Professor, diretor: Diretor, secretaria: Secretaria };

/** Cria a conta, o documento de cargo (quando houver) e abre a sessão. */
async function conta(email, perfil, dadosDoCargo = {}) {
    const user = await criarUsuario({ email, perfil, escolaId: String(escola._id) });

    const Modelo = MODELO_DO_CARGO[perfil];
    if (Modelo) {
        await Modelo.create({
            idUsuario: String(user._id),
            nome: user.nome,
            email,
            vinculos: [{ escolaId: String(escola._id), cargo: perfil }],
            ativo: true,
            ...dadosDoCargo,
        });
    }

    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(login.status).toBe(200);
    return { agent, user, id: String(user._id), email, perfil };
}

const professorDe = (email, salaPrincipal, salasAdicionais = []) =>
    conta(email, 'professor', { salaPrincipal, salasAdicionais });

/** Responsável com um filho na turma. `emailNoAluno` permite testar a caixa. */
async function responsavelDe(email, turma, emailNoAluno = email) {
    const sessao = await conta(email, 'responsavel');
    await Aluno.create({
        escolaId: String(escola._id),
        nome: 'CRIANCA INVENTADA DA SILVA',
        turma,
        responsavel: emailNoAluno,
        ativo: true,
    });
    return sessao;
}

async function contatos(sessao) {
    const res = await sessao.agent.get('/api/chat-direto/contatos');
    expect(res.status).toBe(200);
    return res.body.data;
}

const idsDe = (lista) => lista.map((c) => c.id).sort();

describe('quem cada perfil enxerga', () => {
    it('professor vê a equipe e SÓ os responsáveis das turmas dele', async () => {
        const eu = await professorDe('prof.1a@escola.test', '1A');
        const colega = await professorDe('prof.9a@escola.test', '9A');
        const diretor = await conta('diretor@escola.test', 'diretor');
        const secretaria = await conta('secretaria@escola.test', 'secretaria');
        const maeDaMinhaTurma = await responsavelDe('mae.1a@escola.test', '1A');
        const maeDeOutra = await responsavelDe('mae.9a@escola.test', '9A');

        const lista = await contatos(eu);

        expect(idsDe(lista)).toEqual(
            [colega.id, diretor.id, secretaria.id, maeDaMinhaTurma.id].sort()
        );
        expect(idsDe(lista)).not.toContain(maeDeOutra.id);
    });

    it('responsável vê só os professores dos filhos, mais direção e secretaria', async () => {
        const profDoFilho = await professorDe('prof.do.filho@escola.test', '3B');
        const profDeOutra = await professorDe('prof.outra@escola.test', '7A');
        const diretor = await conta('diretor2@escola.test', 'diretor');
        const secretaria = await conta('secretaria2@escola.test', 'secretaria');
        const eu = await responsavelDe('mae@escola.test', '3B');
        const outraMae = await responsavelDe('outra.mae@escola.test', '3B');

        const lista = await contatos(eu);

        expect(idsDe(lista)).toEqual([profDoFilho.id, diretor.id, secretaria.id].sort());
        // Responsável não conversa com responsável, nem da mesma turma: a
        // escola é sempre a intermediária entre duas famílias.
        expect(idsDe(lista)).not.toContain(outraMae.id);
        expect(idsDe(lista)).not.toContain(profDeOutra.id);
    });

    it('diretor e secretaria não têm recorte de turma', async () => {
        const profA = await professorDe('prof.a@escola.test', '1A');
        const profB = await professorDe('prof.b@escola.test', '9A');
        const maeA = await responsavelDe('mae.a@escola.test', '1A');
        const maeB = await responsavelDe('mae.b@escola.test', '9A');
        const secretaria = await conta('sec3@escola.test', 'secretaria');
        const diretor = await conta('dir3@escola.test', 'diretor');

        expect(idsDe(await contatos(diretor))).toEqual(
            [profA.id, profB.id, maeA.id, maeB.id, secretaria.id].sort()
        );
        expect(idsDe(await contatos(secretaria))).toEqual(
            [profA.id, profB.id, maeA.id, maeB.id, diretor.id].sort()
        );
    });

    it('ninguém aparece na própria lista', async () => {
        const eu = await professorDe('sozinho@escola.test', '1A');
        expect(idsDe(await contatos(eu))).not.toContain(eu.id);
    });

    it('conta desativada não aparece', async () => {
        const eu = await professorDe('ativo@escola.test', '1A');
        const desligado = await professorDe('desligado@escola.test', '1A');
        await Usuario.updateOne({ _id: desligado.user._id }, { $set: { ativo: false } });

        expect(idsDe(await contatos(eu))).not.toContain(desligado.id);
    });
});

/**
 * O ADMIN — o caso que a matriz não cobre.
 *
 * `paresPermitidos` libera o admin à parte ("conversa com qualquer perfil"),
 * mas ele não aparece em nenhuma lista da MATRIZ_CONVERSA e não tem coleção de
 * cargo nem vínculo aluno↔responsável. O resultado era o pior dos dois lados:
 * o envio do admin passava e a mensagem era gravada, mas o destinatário não
 * via o admin na lista — não tinha por onde reabrir a conversa, e a mensagem
 * parecia nunca ter chegado.
 */
describe('admin', () => {
    it('enxerga a escola inteira', async () => {
        const prof = await professorDe('adm.prof@escola.test', '1A');
        const dir = await conta('adm.dir@escola.test', 'diretor');
        const sec = await conta('adm.sec@escola.test', 'secretaria');
        const mae = await responsavelDe('adm.mae@escola.test', '1A');
        const admin = await conta('admin@escola.test', 'admin');

        expect(idsDe(await contatos(admin))).toEqual([prof.id, dir.id, sec.id, mae.id].sort());
    });

    it('aparece na lista de quem já recebeu mensagem dele', async () => {
        const admin = await conta('admin2@escola.test', 'admin');
        const mae = await responsavelDe('mae.suporte@escola.test', '2B');

        const envio = await admin.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: mae.id, mensagem: 'oi' });
        expect(envio.status).toBe(200);

        const lista = await contatos(mae);
        expect(idsDe(lista)).toContain(admin.id);
        expect(lista.find((c) => c.id === admin.id).naoLidas).toBe(1);
    });

    it('aparece também para quem escreveu para ele primeiro', async () => {
        const admin = await conta('admin3@escola.test', 'admin');
        const prof = await professorDe('prof.suporte@escola.test', '4C');

        const envio = await prof.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: admin.id, mensagem: 'preciso de ajuda' });
        expect(envio.status).toBe(200);

        expect(idsDe(await contatos(prof))).toContain(admin.id);
    });

    it('não aparece para quem nunca conversou com ele', async () => {
        const admin = await conta('admin4@escola.test', 'admin');
        const prof = await professorDe('prof.sem.suporte@escola.test', '5A');

        // Sem histórico, a conta de suporte não é enumerável: listar todos os
        // admins da rede para toda família entregaria o time de suporte a quem
        // nunca falou com ele.
        expect(idsDe(await contatos(prof))).not.toContain(admin.id);
    });
});

describe('a lista concorda com o envio', () => {
    /**
     * Para cada conta da escola: se ela está na lista, o envio tem de passar;
     * se não está, o envio tem de ser recusado.
     *
     * É o teste que amarra `listarContatos` a `podeConversar`. Sem ele as duas
     * podem divergir sem nada quebrar — e a divergência aparece só em produção,
     * como "esse contato não abre" ou, pior, como contato faltando.
     */
    async function conferirCoerencia(sessao, todasAsContas) {
        const naLista = new Set(idsDe(await contatos(sessao)));
        const divergencias = [];

        for (const outra of todasAsContas) {
            if (outra.id === sessao.id) continue;

            const envio = await sessao.agent
                .post('/api/chat-direto/enviar')
                .send({ destinatarioId: outra.id, mensagem: 'oi' });

            const envioPermitido = envio.status === 200;
            if (envioPermitido !== naLista.has(outra.id)) {
                divergencias.push(
                    `${sessao.perfil} → ${outra.perfil} (${outra.email}): ` +
                        `lista=${naLista.has(outra.id)} envio=${envio.status}`
                );
            }
        }
        return divergencias;
    }

    it('bate para todos os perfis, em todas as direções', async () => {
        const todas = [
            await professorDe('c.prof1@escola.test', '1A'),
            await professorDe('c.prof2@escola.test', '9A'),
            await professorDe('c.prof3@escola.test', '1A', ['9A']),
            await conta('c.dir@escola.test', 'diretor'),
            await conta('c.sec@escola.test', 'secretaria'),
            await responsavelDe('c.mae1@escola.test', '1A'),
            await responsavelDe('c.mae2@escola.test', '9A'),
        ];

        const divergencias = [];
        for (const sessao of todas) {
            divergencias.push(...(await conferirCoerencia(sessao, todas)));
        }

        expect(divergencias).toEqual([]);
    });
});

describe('fronteira da escola', () => {
    it('não lista ninguém de outra escola', async () => {
        const outra = await Escola.create({
            nome: 'EE Vizinha',
            tipo: 'EMEF',
            bairro: 'Sul',
            codigoSecreto: 'CONT-69-B',
            ativo: true,
        });

        const forasteiro = await criarUsuario({
            email: 'prof.vizinha@escola.test',
            perfil: 'professor',
            escolaId: String(outra._id),
        });
        await Professor.create({
            idUsuario: String(forasteiro._id),
            nome: forasteiro.nome,
            email: 'prof.vizinha@escola.test',
            salaPrincipal: '1A',
            vinculos: [{ escolaId: String(outra._id), cargo: 'professor' }],
            ativo: true,
        });
        await Aluno.create({
            escolaId: String(outra._id),
            nome: 'ALUNO DA VIZINHA',
            turma: '1A',
            responsavel: 'mae.vizinha@escola.test',
            ativo: true,
        });
        await criarUsuario({
            email: 'mae.vizinha@escola.test',
            perfil: 'responsavel',
            escolaId: String(outra._id),
        });

        // O professor resolve a escola pelo vínculo, então a segunda escola
        // ativa não atrapalha a sessão dele.
        const eu = await professorDe('prof.daqui@escola.test', '1A');
        const lista = await contatos(eu);

        expect(lista.map((c) => c.id)).not.toContain(String(forasteiro._id));
        // A turma "1A" existe nas duas escolas — se o filtro de escola caísse,
        // a mãe da vizinha entraria pela coincidência de nome de turma.
        expect(lista.some((c) => c.nome && c.perfil === 'responsavel')).toBe(false);
    });
});

describe('e-mail do responsável com caixa diferente', () => {
    it('encontra o responsável mesmo com maiúsculas no cadastro do aluno', async () => {
        // `Usuario.email` não é normalizado no schema e o e-mail no cadastro do
        // aluno é digitado à mão. Comparar literal faria a família sumir da
        // lista enquanto o envio continuaria permitido.
        const professor = await professorDe('prof.caixa@escola.test', '2A');
        const mae = await responsavelDe('mae.caixa@escola.test', '2A', 'Mae.Caixa@Escola.Test');

        expect(idsDe(await contatos(professor))).toContain(mae.id);
    });
});

describe('não lidas e ordenação', () => {
    it('conta as mensagens recebidas e põe quem tem pendência na frente', async () => {
        const eu = await professorDe('destino@escola.test', '1A');
        const colegaCalado = await professorDe('calado@escola.test', '1A');
        const colegaFalante = await professorDe('falante@escola.test', '1A');

        await colegaFalante.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: eu.id, mensagem: 'primeira' });
        await colegaFalante.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: eu.id, mensagem: 'segunda' });

        const lista = await contatos(eu);
        const porId = new Map(lista.map((c) => [c.id, c]));

        expect(porId.get(colegaFalante.id).naoLidas).toBe(2);
        expect(porId.get(colegaCalado.id).naoLidas).toBe(0);
        expect(lista[0].id).toBe(colegaFalante.id);
    });

    it('mensagem que EU enviei não conta como não lida para mim', async () => {
        const eu = await professorDe('remetente@escola.test', '1A');
        const outro = await professorDe('receptor@escola.test', '1A');

        await eu.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: outro.id, mensagem: 'oi' });

        const lista = await contatos(eu);
        expect(lista.find((c) => c.id === outro.id).naoLidas).toBe(0);
        expect(await ChatDireto.countDocuments()).toBe(1);
    });
});

describe('presença vem pronta para a tela', () => {
    it('traz status, texto legível e o bruto', async () => {
        const eu = await professorDe('presenca1@escola.test', '1A');
        await professorDe('presenca2@escola.test', '1A');

        const [contato] = await contatos(eu);

        // Ninguém conectou por socket nesta suíte, então todos estão offline.
        expect(contato.presenca.status).toBe('offline');
        expect(contato.presenca.texto).toBe('offline');
        expect(contato.presenca).toHaveProperty('ultimoAcesso');
    });
});

describe('autenticação', () => {
    it('exige sessão', async () => {
        const res = await request(app).get('/api/chat-direto/contatos');
        expect(res.status).toBe(401);
    });
});
