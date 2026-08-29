/**
 * relatoriosDiarios.test.js — Issue #132
 *
 * O que estes testes travam, na ordem em que a Issue os lista:
 *
 * 1. As rotas de relatório diário EXISTEM. Elas não existiam: `routes/relatorios.js`
 *    só expunha o boletim, então `/api/relatorios` caía no 404 global. O
 *    `db.getByIndex` do front engole o erro e devolve `[]` — a aba parecia
 *    funcionar e não gravava nada.
 * 2. Salvar o mesmo dia duas vezes deixa UM registro. Antes o front baixava a
 *    lista inteira antes de cada gravação para decidir entre criar e atualizar,
 *    e duas gravações rápidas liam "não existe" as duas.
 * 3. A chave do dia não depende do fuso de quem digita.
 * 4. Auto-save por dia: o front não pode ter um temporizador compartilhado.
 * 5. Design system, motion e acessibilidade da aba.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '../../..');
const appJs = fs.readFileSync(path.join(RAIZ, 'js', 'app.js'), 'utf8');
const turmaCss = fs.readFileSync(path.join(RAIZ, 'css', 'turma.css'), 'utf8');
const turmaHtml = fs.readFileSync(path.join(RAIZ, 'html', 'turma.html'), 'utf8');

/**
 * O trecho de `js/app.js` que cobre a aba.
 *
 * O fim é procurado A PARTIR do início: `triggerPhotoUpload` também aparece
 * antes, dentro de um `onclick` em template string, e uma busca no arquivo
 * inteiro devolveria essa primeira ocorrência — recortando um trecho vazio,
 * que faria todas as asserções passarem por engano.
 */
const inicioTrecho = appJs.indexOf('_chaveDoDia(data)');
const trechoRelatorios = appJs.slice(
    inicioTrecho,
    appJs.indexOf('triggerPhotoUpload(alunoId) {', inicioTrecho)
);

/**
 * O bloco de `css/turma.css` da aba, SEM comentários: eles citam o código
 * antigo (`#38bdf8`, `transition: all`) para registrar o que mudou, e uma
 * asserção sobre o texto cru acusaria justamente a explicação.
 */
const blocoCss = turmaCss
    .slice(
        // A partir da ABERTURA do comentário de cabeçalho: começar no meio dele
        // deixaria o `/*` para trás, e o texto do próprio cabeçalho — que cita
        // as cores antigas — sobreviveria à limpeza.
        turmaCss.indexOf('/* ==========================================\n   RELATÓRIOS DIÁRIOS'),
        turmaCss.indexOf('/* Níveis de Leitura - Cores */')
    )
    .replace(/\/\*[\s\S]*?\*\//g, '');

describe('rotas de relatório diário (Issue #132)', () => {
    const rotas = fs.readFileSync(path.join(RAIZ, 'backend/src/routes/relatorios.js'), 'utf8');

    test('a listagem e a gravação existem — antes só havia o boletim', () => {
        expect(rotas).toMatch(/router\.get\(\s*'\/'/);
        expect(rotas).toMatch(/router\.put\(\s*'\/diario'/);
    });

    test('a gravação é PUT idempotente, não POST que cria', () => {
        // É o que garante "um dia salvo duas vezes continua com um registro".
        expect(rotas).not.toMatch(/router\.post\(\s*'\/diario'/);

        const controller = fs.readFileSync(
            path.join(RAIZ, 'backend/src/controllers/ReportController.js'),
            'utf8'
        );
        expect(controller).toContain('findOneAndUpdate');
        expect(controller).toContain('upsert: true');
    });

    test('responsável não escreve relatório de turma', () => {
        const perfis = rotas.match(/const PODEM_ESCREVER = \[([^\]]+)\]/);
        expect(perfis).not.toBeNull();
        expect(perfis[1]).not.toMatch(/responsavel/);
        expect(perfis[1]).toMatch(/professor/);
    });

    test('o autor vem da sessão, nunca do corpo da requisição', () => {
        const controller = fs.readFileSync(
            path.join(RAIZ, 'backend/src/controllers/ReportController.js'),
            'utf8'
        );
        expect(controller).toMatch(/const autor = String\(req\.user/);
        expect(controller).not.toMatch(/autor: req\.body/);
    });
});

describe('upsert por dia normaliza a data (Issue #132)', () => {
    // A função é interna ao controller; o comportamento é reproduzido aqui para
    // travar a REGRA: a chave é o dia, não o instante.
    const inicioDoDia = (valor) => {
        const d = new Date(valor);
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    };

    test('duas horas do mesmo dia caem na mesma chave', () => {
        expect(inicioDoDia('2026-08-29T00:00:00Z').getTime()).toBe(
            inicioDoDia('2026-08-29T23:59:59Z').getTime()
        );
    });

    test('a chave é sempre meia-noite UTC', () => {
        const d = inicioDoDia('2026-08-29T14:32:10Z');
        expect(d.toISOString()).toBe('2026-08-29T00:00:00.000Z');
    });
});

describe('auto-save da aba de relatórios (Issue #132)', () => {
    test('o temporizador é POR DIA, não um só compartilhado', () => {
        // O defeito: um `saveTimeout` para os 15 campos. Digitar no dia 12
        // cancelava o salvamento pendente do dia 11.
        expect(trechoRelatorios).not.toMatch(/let saveTimeout/);
        expect(trechoRelatorios).toMatch(/timers: new Map\(\)/);
        expect(trechoRelatorios).toMatch(/estado\.timers\.set\(/);
    });

    test('a chave do dia é montada em hora local, sem toISOString', () => {
        // `toISOString` sobre data local joga o cartão da noite para o dia
        // seguinte em qualquer fuso a oeste de Greenwich.
        const chave = trechoRelatorios.slice(
            trechoRelatorios.indexOf('_chaveDoDia(data)'),
            trechoRelatorios.indexOf('_salvarRelatorioDiario')
        );
        expect(chave).toMatch(/getFullYear\(\)/);
        expect(chave).not.toMatch(/toISOString/);
    });

    test('não busca a lista inteira antes de cada gravação', () => {
        expect(trechoRelatorios).not.toMatch(/getByIndex\('relatorios'/);
        expect(trechoRelatorios).toMatch(/relatorios\/diario/);
    });

    test('o que está no debounce é gravado ao trocar de quinzena e ao sair', () => {
        expect(trechoRelatorios).toMatch(/_descarregarRelatoriosPendentes/);
        expect(trechoRelatorios).toMatch(/visibilitychange/);
        expect(trechoRelatorios).toMatch(/beforeunload/);
    });

    test('não estoura sem sessão — o `_id` do usuário saiu do caminho', () => {
        // `auth.getCurrentUser()._id` derrubava a aba quando não havia sessão.
        // O autor passou a vir do servidor.
        expect(trechoRelatorios).not.toMatch(/getCurrentUser\(\)\._id/);
    });

    test('"Próxima" fica desabilitado na quinzena corrente', () => {
        expect(trechoRelatorios).toMatch(/naQuinzenaCorrente = quinzenaOffset >= 0/);
        expect(trechoRelatorios).toMatch(/naQuinzenaCorrente \? 'disabled/);
    });

    test('o estado do save é texto e é anunciado', () => {
        expect(trechoRelatorios).toMatch(/salvando: 'Salvando/);
        expect(trechoRelatorios).toMatch(/salvo: 'Salvo'/);
        expect(trechoRelatorios).toMatch(/'nao-salvo': 'Não salvo'/);
        expect(trechoRelatorios).toMatch(/erro: 'Erro ao salvar'/);
        expect(trechoRelatorios).toMatch(/aria-live="polite"/);
    });

    test('carrega com skeleton, não com tela em branco', () => {
        expect(trechoRelatorios).toMatch(/Motion\?\.skeleton|Motion\.skeleton/);
        expect(trechoRelatorios).toMatch(/skeleton report-card-skeleton/);
    });

    test('cada textarea tem rótulo associado', () => {
        expect(trechoRelatorios).toMatch(/<label class="sr-only" for="\$\{idCampo\}"/);
    });
});

describe('design system e motion da aba (Issue #132)', () => {
    test('nenhuma cor fora dos tokens no bloco de relatórios', () => {
        expect(blocoCss).not.toMatch(/#38bdf8/); // azul-céu
        expect(blocoCss).not.toMatch(/#818cf8/); // índigo
        expect(blocoCss).not.toMatch(/124,\s*58,\s*237/); // sombra roxa
        expect(blocoCss).not.toMatch(/#555\b/);
    });

    test('o título não usa gradiente recortado', () => {
        expect(blocoCss).not.toMatch(/background-clip:\s*text/);
        expect(blocoCss).not.toMatch(/text-fill-color/);
    });

    test('nada de `transition: all` nem duração acima de 180ms', () => {
        expect(blocoCss).not.toMatch(/transition:\s*all/);

        const duracoes = [...blocoCss.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));
        expect(duracoes.length).toBeGreaterThan(0);
        expect(Math.max(...duracoes)).toBeLessThanOrEqual(180);
        expect(blocoCss).not.toMatch(/\b0?\.[3-9]\d*s\b/); // 0.3s, 0.4s…
    });

    test('o cartão não se move sob o cursor', () => {
        // É uma área de digitação: o ponteiro passa por ela o tempo todo.
        const hover = blocoCss.slice(blocoCss.indexOf('.report-card:hover'));
        expect(hover.slice(0, 120)).not.toMatch(/translateY/);
    });

    test('respeita prefers-reduced-motion', () => {
        expect(blocoCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    });
});

describe('semântica de abas em turma.html (Issue #132)', () => {
    test('o contêiner é um tablist e cada botão é uma tab', () => {
        expect(turmaHtml).toMatch(/id="viewTabs"[^>]*role="tablist"/);
        expect((turmaHtml.match(/role="tab"/g) || []).length).toBe(3);
    });

    test('cada aba declara seleção e o painel que controla', () => {
        expect(turmaHtml).toMatch(/aria-selected="true"[^>]*aria-controls="painelNotas"/);
        expect(turmaHtml).toMatch(/aria-controls="painelFaltas"/);
        expect(turmaHtml).toMatch(/aria-controls="painelRelatorios"/);
    });

    test('cada painel é um tabpanel rotulado pela própria aba', () => {
        expect((turmaHtml.match(/role="tabpanel"/g) || []).length).toBe(3);
        expect(turmaHtml).toMatch(/id="painelNotas"[^>]*aria-labelledby="tabNotas"/);
    });

    test('as setas navegam entre as abas — a semântica não é só decorativa', () => {
        const abas = appJs.slice(appJs.indexOf('Abas de visão'), appJs.indexOf('Adicionar aluno'));
        expect(abas).toMatch(/ArrowRight/);
        expect(abas).toMatch(/ArrowLeft/);
        expect(abas).toMatch(/aria-selected/);
        expect(abas).toMatch(/tabIndex/);
    });
});
