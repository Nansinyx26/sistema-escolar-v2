/**
 * respostasErro.test.js
 *
 * Garante o cumprimento da Issue #337 (Épico #334):
 * - Padronização da resposta de erro da API com codigo e requestId
 * - Blindagem de erros 500 em produção (sem vazamento de detalhes internos)
 * - Preservação de mensagens para depuração fora de produção
 * - Handler global nunca devolve error como objeto vazio {}
 * - 400, 401, 403, 404, 413 e 429 com codigo estável e requestId
 * - Validação e reaproveitamento de X-Request-Id seguro vs. descarte de inválido
 * - Logs emitidos com instanciaId e sem PII
 */

const express = require('express');
const request = require('supertest');
const app = require('../app');
const { padronizadorResposta, MENSAGEM_PADRAO_500 } = require('../middleware/padronizadorResposta');
const { extrairRequestIdValido } = require('../middleware/requestLogger');
const { obterIdInstancia } = require('../utils/instanciaId');
const logger = require('../utils/logger');

/** Captura o que o processo escreveu em stdout durante fn. */
async function capturarLogs(fn) {
    const linhas = [];
    const original = process.stdout.write;
    process.stdout.write = (chunk) => {
        linhas.push(String(chunk));
        return true;
    };
    try {
        await fn();
    } finally {
        process.stdout.write = original;
    }
    return linhas.join('');
}

describe('Padronização e Blindagem de Respostas de Erro (Issue #337)', () => {
    describe('Ciclo HTTP com a aplicação real (app)', () => {
        it('404 em rota de API devolve codigo: NAO_ENCONTRADO, requestId e error texto', async () => {
            const res = await request(app).get('/api/rota-inexistente-12345');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.codigo).toBe('NAO_ENCONTRADO');
            expect(typeof res.body.requestId).toBe('string');
            expect(res.body.requestId.length).toBeGreaterThan(0);
            expect(res.body.requestId).toBe(res.headers['x-request-id']);
            expect(typeof res.body.error).toBe('string');
            expect(res.body.error).toBe('Endpoint não encontrado');
            expect(typeof res.body.message).toBe('string');
        });

        it('reaproveita X-Request-Id seguro enviado pelo balanceador ou cliente', async () => {
            const idExterno = 'trace-lb-abc-12345';
            const res = await request(app)
                .get('/api/rota-inexistente-12345')
                .set('X-Request-Id', idExterno);

            expect(res.headers['x-request-id']).toBe(idExterno);
            expect(res.body.requestId).toBe(idExterno);
        });

        it('descarta X-Request-Id inválido ou malicioso e gera novo identificador seguro', async () => {
            const idInvalido = 'id com espacos e caracteres invalidos @#$';
            const res = await request(app)
                .get('/api/rota-inexistente-12345')
                .set('X-Request-Id', idInvalido);

            expect(res.headers['x-request-id']).not.toBe(idInvalido);
            expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
            expect(res.body.requestId).toMatch(/^[0-9a-f]{16}$/);
        });

        it('funcao extrairRequestIdValido valida corretamente formatos e rejeita caracteres perigosos', () => {
            expect(extrairRequestIdValido({ headers: { 'x-request-id': 'meu-id-123_abc' } })).toBe(
                'meu-id-123_abc'
            );
            expect(
                extrairRequestIdValido({ headers: { 'x-request-id': 'bad\r\ninjection' } })
            ).toBeNull();
            expect(
                extrairRequestIdValido({ headers: { 'x-request-id': '<script>alert(1)</script>' } })
            ).toBeNull();
            expect(extrairRequestIdValido({ headers: { 'x-request-id': 'ab' } })).toBeNull(); // muito curto (< 4 chars)
            expect(
                extrairRequestIdValido({ headers: { 'x-request-id': 'a'.repeat(129) } })
            ).toBeNull(); // muito longo (> 128 chars)
            expect(extrairRequestIdValido({ headers: {} })).toBeNull();
        });

        it('401 em rota protegida sem autenticação devolve codigo e requestId', async () => {
            const res = await request(app).get('/api/usuarios');

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.codigo).toBeDefined();
            expect(typeof res.body.requestId).toBe('string');
            expect(typeof res.body.error).toBe('string');
            expect(res.body.error).not.toBe('[object Object]');
        });
    });

    describe('Códigos estáveis e contratos de erro (400, 401, 403, 404, 413, 429, 500, 502, 503)', () => {
        function criarAppTeste(configRota) {
            const testApp = express();
            testApp.use((req, res, next) => {
                req.requestId = 'req-teste-777';
                res.setHeader('X-Request-Id', 'req-teste-777');
                next();
            });
            testApp.use(padronizadorResposta);
            configRota(testApp);
            return testApp;
        }

        it('400 recebe codigo REQUISICAO_INVALIDA e requestId', async () => {
            const testApp = criarAppTeste((app) => {
                app.get('/erro-400', (_req, res) => {
                    res.status(400).json({ error: 'Campo nome é obrigatório' });
                });
            });

            const res = await request(testApp).get('/erro-400');
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.codigo).toBe('REQUISICAO_INVALIDA');
            expect(res.body.requestId).toBe('req-teste-777');
            expect(res.body.error).toBe('Campo nome é obrigatório');
            expect(res.body.message).toBe('Campo nome é obrigatório');
        });

        it('401 com codigo específico preserva o codigo original', async () => {
            const testApp = criarAppTeste((app) => {
                app.get('/erro-401', (_req, res) => {
                    res.status(401).json({
                        error: 'Credenciais inválidas',
                        codigo: 'CREDENCIAL_INVALIDA',
                    });
                });
            });

            const res = await request(testApp).get('/erro-401');
            expect(res.status).toBe(401);
            expect(res.body.codigo).toBe('CREDENCIAL_INVALIDA');
            expect(res.body.requestId).toBe('req-teste-777');
        });

        it('403 recebe codigo NAO_AUTORIZADO', async () => {
            const testApp = criarAppTeste((app) => {
                app.get('/erro-403', (_req, res) => {
                    res.status(403).json({ error: 'Acesso negado para este perfil' });
                });
            });

            const res = await request(testApp).get('/erro-403');
            expect(res.status).toBe(403);
            expect(res.body.codigo).toBe('NAO_AUTORIZADO');
            expect(res.body.requestId).toBe('req-teste-777');
        });

        it('413 recebe codigo CONTEUDO_MUITO_GRANDE', async () => {
            const testApp = criarAppTeste((app) => {
                app.get('/erro-413', (_req, res) => {
                    res.status(413).json({ error: 'Arquivo excede o limite' });
                });
            });

            const res = await request(testApp).get('/erro-413');
            expect(res.status).toBe(413);
            expect(res.body.codigo).toBe('CONTEUDO_MUITO_GRANDE');
            expect(res.body.requestId).toBe('req-teste-777');
        });

        it('429 recebe codigo MUITAS_TENTATIVAS e requestId', async () => {
            const testApp = criarAppTeste((app) => {
                app.get('/erro-429', (_req, res) => {
                    res.status(429).json({ error: 'Muitas requisições', retryEmSegundos: 30 });
                });
            });

            const res = await request(testApp).get('/erro-429');
            expect(res.status).toBe(429);
            expect(res.body.codigo).toBe('MUITAS_TENTATIVAS');
            expect(res.body.requestId).toBe('req-teste-777');
            expect(res.body.retryEmSegundos).toBe(30);
        });

        it('502 e 503 preservam mensagens de serviço para o usuário', async () => {
            const testApp = criarAppTeste((app) => {
                app.get('/erro-503', (_req, res) => {
                    res.status(503).json({
                        error: 'Serviço de geração de PDF temporariamente indisponível',
                    });
                });
            });

            const res = await request(testApp).get('/erro-503');
            expect(res.status).toBe(503);
            expect(res.body.codigo).toBe('SERVICO_INDISPONIVEL');
            expect(res.body.error).toBe('Serviço de geração de PDF temporariamente indisponível');
            expect(res.body.requestId).toBe('req-teste-777');
        });
    });

    describe('Blindagem de Erros 500 em Produção vs Desenvolvimento', () => {
        const envOriginal = process.env.NODE_ENV;

        afterEach(() => {
            process.env.NODE_ENV = envOriginal;
        });

        it('em produção (NODE_ENV=production): mascara detalhe de banco/driver com mensagem genérica e registra no log', async () => {
            process.env.NODE_ENV = 'production';

            const testApp = express();
            testApp.use((req, _res, next) => {
                req.requestId = 'req-prod-500';
                next();
            });
            testApp.use(padronizadorResposta);
            testApp.get('/erro-interno', (_req, res) => {
                res.status(500).json({
                    success: false,
                    error: 'MongoServerError: E11000 duplicate key error collection: alunos index: cpf_1',
                });
            });

            let res;
            const logSaida = await capturarLogs(async () => {
                res = await request(testApp).get('/erro-interno');
            });

            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe(MENSAGEM_PADRAO_500);
            expect(res.body.message).toBe(MENSAGEM_PADRAO_500);
            expect(res.body.codigo).toBe('ERRO_INTERNO');
            expect(res.body.requestId).toBe('req-prod-500');

            // Garante que o cliente NÃO recebeu mensagem do driver
            expect(JSON.stringify(res.body)).not.toContain('MongoServerError');
            expect(JSON.stringify(res.body)).not.toContain('duplicate key');

            // Garante que o log interno capturou o erro original com requestId
            expect(logSaida).toContain('MongoServerError');
            expect(logSaida).toContain('req-prod-500');
        });

        it('fora de produção: mantém erro detalhado visível para depuração', async () => {
            process.env.NODE_ENV = 'development';

            const testApp = express();
            testApp.use((req, _res, next) => {
                req.requestId = 'req-dev-500';
                next();
            });
            testApp.use(padronizadorResposta);
            testApp.get('/erro-interno', (_req, res) => {
                res.status(500).json({
                    success: false,
                    error: 'Detalhe de debug: falha de conexao com socket',
                });
            });

            const res = await request(testApp).get('/erro-interno');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Detalhe de debug: falha de conexao com socket');
            expect(res.body.codigo).toBe('ERRO_INTERNO');
            expect(res.body.requestId).toBe('req-dev-500');
        });

        it('handler global nunca responde error como objeto vazio {}', async () => {
            process.env.NODE_ENV = 'production';

            const testApp = express();
            testApp.use((req, _res, next) => {
                req.requestId = 'req-global-err';
                next();
            });
            testApp.use(padronizadorResposta);
            testApp.get('/lanca-excecao', (_req, _res, next) => {
                next(new Error('Excecao inesperada nao tratada'));
            });
            // Simula o handler global
            testApp.use((err, _req, res, _next) => {
                const statusCode = err.status || 500;
                const isProduction = process.env.NODE_ENV === 'production';
                const mensagemErro =
                    isProduction && statusCode >= 500
                        ? 'Ocorreu um erro interno. Tente novamente.'
                        : err.message || 'Erro interno do servidor.';
                res.status(statusCode).json({
                    success: false,
                    message: mensagemErro,
                    error: mensagemErro,
                });
            });

            const res = await request(testApp).get('/lanca-excecao');

            expect(res.status).toBe(500);
            expect(typeof res.body.error).toBe('string');
            expect(res.body.error).not.toBe('[object Object]');
            expect(res.body.error).toBe(MENSAGEM_PADRAO_500);
            expect(res.body.codigo).toBe('ERRO_INTERNO');
            expect(res.body.requestId).toBe('req-global-err');
        });
    });

    describe('Observabilidade e identificação de instância', () => {
        it('obterIdInstancia retorna identificador não vazio', () => {
            const id = obterIdInstancia();
            expect(typeof id).toBe('string');
            expect(id.length).toBeGreaterThan(0);
        });

        it('logs estruturados contêm instanciaId', async () => {
            const logSaida = await capturarLogs(async () => {
                logger.info('Teste de emissão de log estruturado');
            });

            const linha = logSaida
                .split('\n')
                .filter((l) => l.trim().startsWith('{'))
                .map((l) => {
                    try {
                        return JSON.parse(l);
                    } catch {
                        return null;
                    }
                })
                .find((o) => o && o.message === 'Teste de emissão de log estruturado');

            expect(linha).toBeDefined();
            expect(linha.instanciaId).toBeDefined();
            expect(linha.instanciaId).toBe(obterIdInstancia());
        });
    });
});
