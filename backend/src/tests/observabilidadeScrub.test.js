/**
 * observabilidadeScrub.test.js — a barreira de PII antes de sair para terceiros.
 *
 * `observability/scrub.js` é o último ponto de controle entre o sistema e
 * Sentry/Datadog/New Relic. Log interno fica no Render; evento de APM fica num
 * terceiro, sob outra jurisdição. Vazar CPF, endereço ou nome de aluno aqui é
 * um incidente de LGPD, não um bug de telemetria.
 *
 * Estes testes existem porque o defeito que eles cobrem é INVISÍVEL: o sistema
 * funciona igual com o scrub furado, os eventos chegam ao painel normalmente, e
 * ninguém descobre até alguém abrir um evento e ver o CPF de uma criança.
 *
 * (O módulo ficou com 7% de cobertura desde que foi escrito — verificado à mão
 * na época e nunca automatizado. É o tipo de omissão que só aparece quando a
 * medição de cobertura passa a valer de verdade; ver Issue #6.)
 */

const { scrubEvent, scrubObject, scrubUrl, DROP_KEYS } = require('../observability/scrub');

describe('scrubObject — chaves sensíveis', () => {
    test('remove os campos que identificam uma pessoa', () => {
        const saida = scrubObject({
            cpf: '123.456.789-00',
            nome: 'Maria Silva',
            email: 'maria@escola.com',
            telefone: '51999998888',
            endereco: 'Rua X, 123',
            senha: 'segredo',
            token: 'abc123',
        });

        for (const chave of Object.keys(saida)) {
            expect(saida[chave]).toBe('[REDACTED]');
        }
    });

    test('preserva o que é útil para diagnosticar e não identifica ninguém', () => {
        const saida = scrubObject({
            turmaId: '7A',
            escolaId: '507f1f77bcf86cd799439011',
            status: 500,
            rota: '/api/notas',
            tentativas: 3,
        });

        expect(saida).toEqual({
            turmaId: '7A',
            escolaId: '507f1f77bcf86cd799439011',
            status: 500,
            rota: '/api/notas',
            tentativas: 3,
        });
    });

    test('alcança objetos aninhados', () => {
        const saida = scrubObject({
            contexto: { aluno: { cpf: '12345678900', turma: '7A' } },
        });

        expect(saida.contexto.aluno.cpf).toBe('[REDACTED]');
        expect(saida.contexto.aluno.turma).toBe('7A');
    });

    test('alcança objetos dentro de arrays', () => {
        const saida = scrubObject({
            alunos: [
                { nome: 'Ana', turma: '7A' },
                { nome: 'Bruno', turma: '8B' },
            ],
        });

        expect(saida.alunos[0].nome).toBe('[REDACTED]');
        expect(saida.alunos[0].turma).toBe('7A');
        expect(saida.alunos[1].nome).toBe('[REDACTED]');
    });

    test('mascara PII em texto livre, não só em chave nomeada', () => {
        // O caso realista: a PII vem no meio da mensagem de erro, onde nenhum
        // filtro por nome de chave alcançaria.
        const saida = scrubObject({
            mensagem: 'Falha ao salvar o aluno de CPF 123.456.789-00',
        });

        expect(saida.mensagem).not.toContain('123.456.789-00');
    });

    test('não estoura com null, undefined ou tipos primitivos', () => {
        // Um scrub que lança derruba o relato do erro original — o sistema
        // perderia justamente o evento que importa.
        expect(() => scrubObject(null)).not.toThrow();
        expect(() => scrubObject(undefined)).not.toThrow();
        expect(() => scrubObject(42)).not.toThrow();
        expect(() => scrubObject('texto')).not.toThrow();
    });

    test('para de descer em estrutura muito profunda, sem travar', () => {
        // Proteção contra objeto patológico: sem limite de profundidade, um
        // ciclo ou uma árvore gigante travaria o processo dentro do handler
        // de erro.
        let profundo = { fim: true };
        for (let i = 0; i < 30; i++) profundo = { nivel: profundo };

        expect(() => scrubObject(profundo)).not.toThrow();
    });

    test('DROP_KEYS cobre as categorias de PII escolar', () => {
        for (const chave of ['cpf', 'endereco', 'telefone', 'email', 'nome', 'senha']) {
            expect(DROP_KEYS.has(chave)).toBe(true);
        }
    });
});

describe('scrubUrl — querystring', () => {
    test('mascara os parâmetros que identificam alguém', () => {
        const url = scrubUrl('/api/alunos?cpf=12345678900&email=a@b.com&turma=7A');

        expect(url).not.toContain('12345678900');
        expect(url).not.toContain('a@b.com');
        expect(url).toContain('turma=7A');
    });

    test('mascara token e senha', () => {
        const url = scrubUrl('/api/login?token=abc123&senha=xyz');

        expect(url).not.toContain('abc123');
        expect(url).not.toContain('xyz');
    });

    test('deixa intacta a URL sem parâmetro sensível', () => {
        expect(scrubUrl('/api/turmas?ano=2026')).toBe('/api/turmas?ano=2026');
    });

    test('tolera entrada que não é string', () => {
        expect(() => scrubUrl(null)).not.toThrow();
        expect(() => scrubUrl(undefined)).not.toThrow();
    });
});

describe('scrubEvent — o evento que sai para o provedor', () => {
    test('reduz a identidade a id, perfil e escola', () => {
        const evento = scrubEvent({
            user: {
                id: 'u1',
                perfil: 'aluno',
                escolaId: 'e1',
                nome: 'Maria Silva',
                email: 'maria@escola.com',
                cpf: '12345678900',
            },
        });

        expect(evento.user).toEqual({ id: 'u1', perfil: 'aluno', escolaId: 'e1' });
    });

    test('descarta cookies, authorization e corpo da requisição', () => {
        const evento = scrubEvent({
            request: {
                url: '/api/notas',
                cookies: { sessao: 'abc' },
                data: { cpf: '12345678900' },
                headers: {
                    authorization: 'Bearer token',
                    cookie: 'sessao=abc',
                    'x-csrf-token': 'csrf',
                    accept: 'application/json',
                },
            },
        });

        expect(evento.request.cookies).toBeUndefined();
        expect(evento.request.data).toBeUndefined();
        expect(evento.request.headers.authorization).toBeUndefined();
        expect(evento.request.headers.cookie).toBeUndefined();
        expect(evento.request.headers['x-csrf-token']).toBeUndefined();
        // O que não identifica ninguém continua: é o que torna o evento útil.
        expect(evento.request.headers.accept).toBe('application/json');
    });

    test('limpa a querystring da URL da requisição', () => {
        const evento = scrubEvent({ request: { url: '/api/alunos?cpf=12345678900' } });
        expect(evento.request.url).not.toContain('12345678900');
    });

    test('limpa extra, tags e contexts', () => {
        const evento = scrubEvent({
            extra: { cpf: '12345678900', turma: '7A' },
            tags: { nome: 'Maria', ambiente: 'producao' },
            contexts: { aluno: { email: 'a@b.com', serie: '7' } },
        });

        expect(evento.extra.cpf).toBe('[REDACTED]');
        expect(evento.extra.turma).toBe('7A');
        expect(evento.tags.nome).toBe('[REDACTED]');
        expect(evento.tags.ambiente).toBe('producao');
        expect(evento.contexts.aluno.email).toBe('[REDACTED]');
    });

    test('limpa a mensagem e os breadcrumbs', () => {
        const evento = scrubEvent({
            message: 'erro no aluno de CPF 123.456.789-00',
            breadcrumbs: [{ message: 'login de maria@escola.com', data: { cpf: '12345678900' } }],
        });

        expect(evento.message).not.toContain('123.456.789-00');
        expect(evento.breadcrumbs[0].data.cpf).toBe('[REDACTED]');
    });

    test('limpa a mensagem dentro da exceção', () => {
        // O stack e a mensagem da exceção são o lugar MAIS comum de vazar PII,
        // porque ninguém escreve `throw` pensando em LGPD.
        const evento = scrubEvent({
            exception: {
                values: [{ type: 'Error', value: 'aluno 123.456.789-00 não encontrado' }],
            },
        });

        expect(evento.exception.values[0].value).not.toContain('123.456.789-00');
    });

    test('DESCARTA o evento inteiro se a higienização falhar', () => {
        // A regra mais importante do módulo: vazar é pior que perder
        // telemetria. Um getter que lança simula um evento malformado vindo
        // do SDK.
        const evento = {};
        Object.defineProperty(evento, 'user', {
            get() {
                throw new Error('evento malformado');
            },
            enumerable: true,
        });

        expect(scrubEvent(evento)).toBeNull();
    });

    test('tolera evento vazio ou nulo', () => {
        expect(scrubEvent(null)).toBeNull();
        expect(() => scrubEvent({})).not.toThrow();
    });
});
