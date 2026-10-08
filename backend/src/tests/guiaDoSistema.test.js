/**
 * guiaDoSistema.test.js — Issue #702
 *
 * O copiloto responde "onde fica…" e "como faço…" com o guia de telas de cada
 * perfil. Um menu citado que não existe é pior que nenhuma resposta: a pessoa
 * procura e não acha. Por isso cada rótulo do guia é conferido contra o menu
 * REAL daquele perfil:
 *   - equipe: o menu lateral de `html/dashboard.html`, que mostra e esconde
 *     itens por perfil pelas classes `director-only`, `teacher-only`,
 *     `secretaria-only` e `director-teacher-shared` (`js/dashboard.js`);
 *   - responsável: as abas do portal (`PortalTabs.tsx`).
 */

const fs = require('node:fs');
const path = require('node:path');
const { TELAS_POR_PERFIL, guiaPara } = require('../services/ia/guiaDoSistema');
const { montarSystemPrompt } = require('../services/ia/ContextBuilder');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/**
 * Itens do menu lateral do painel: rótulo e classes de perfil. O rótulo é o
 * primeiro `<span>` do item; os seguintes são etiquetas ("IA") e contadores.
 */
function itensDoMenu() {
    const html = fonte('html/dashboard.html');
    const nav = html.slice(html.indexOf('<nav class="sidebar-nav"'), html.indexOf('</nav>'));
    const itens = [];
    for (const m of nav.matchAll(/<a\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
        const rotulo = (m[2].match(/<span>([^<]+)<\/span>/) || [])[1];
        if (rotulo) itens.push({ classes: m[1].split(/\s+/), rotulo: rotulo.trim() });
    }
    return itens;
}

/** Mesma regra de `atualizarVisibilidadeSidebar` (js/dashboard.js). */
const VISIVEL = {
    diretor: ['director-only', 'director-teacher-shared', 'director-secretaria-shared'],
    secretaria: ['secretaria-only', 'director-teacher-shared', 'director-secretaria-shared'],
    professor: ['teacher-only', 'director-teacher-shared'],
};
const RESTRITAS = [
    'director-only',
    'teacher-only',
    'secretaria-only',
    'director-teacher-shared',
    'director-secretaria-shared',
];

function menuDo(perfil) {
    return new Set(
        itensDoMenu()
            .filter((item) => {
                const restrita = item.classes.filter((c) => RESTRITAS.includes(c));
                return restrita.length === 0 || restrita.some((c) => VISIVEL[perfil].includes(c));
            })
            .map((item) => item.rotulo)
    );
}

describe('cada tela do guia existe no menu do perfil', () => {
    it.each(['diretor', 'secretaria', 'professor'])('%s', (perfil) => {
        const menu = menuDo(perfil);
        expect(menu.size).toBeGreaterThan(5); // sanidade do leitor de HTML

        const inexistentes = TELAS_POR_PERFIL[perfil]
            .map((t) => t.menu)
            .filter((rotulo) => !menu.has(rotulo));
        expect(inexistentes).toEqual([]);
    });

    it('responsável: as abas do portal', () => {
        const abas = fonte('portal-responsavel/src/components/PortalTabs.tsx');
        for (const { menu } of TELAS_POR_PERFIL.responsavel) {
            expect(abas).toContain(`label: '${menu}'`);
        }
    });

    it('o guia do professor não cita tela só da direção', () => {
        const daDirecao = itensDoMenu()
            .filter((i) => i.classes.includes('director-only'))
            .map((i) => i.rotulo);
        const doProfessor = TELAS_POR_PERFIL.professor.map((t) => t.menu);
        // "Frequência" existe nos dois menus, com telas diferentes.
        expect(doProfessor.filter((m) => daDirecao.includes(m) && m !== 'Frequência')).toEqual([]);
    });
});

describe('prompt do copiloto', () => {
    const contexto = (perfil) => ({
        usuario: { nome: 'Fulano', tratamento: 'professor(a)', perfil },
        escola: { nome: 'EMEF Alfa' },
        agora: new Date('2026-10-07T12:00:00Z'),
        academico: {},
        turmas: [],
        disciplinas: [],
        modulos: [],
        temFerramentas: true,
    });

    it('traz o guia do perfil e proíbe inventar menu', () => {
        const prompt = montarSystemPrompt(contexto('professor'));

        expect(prompt).toContain('ONDE FICA CADA COISA NO SISTEMA');
        expect(prompt).toContain('- Meu Horário: sua grade semanal de aulas.');
        expect(prompt).toContain('Nunca invente nome de menu');
    });

    it('o responsável recebe só as abas do portal', () => {
        const prompt = montarSystemPrompt(contexto('responsavel'));

        expect(prompt).toContain('- Boletim:');
        expect(prompt).not.toContain('Gerenciar Secretaria');
        expect(prompt).not.toContain('Códigos Secretos');
    });

    it('o admin usa o guia da direção', () => {
        expect(guiaPara('admin')).toBe(TELAS_POR_PERFIL.diretor);
    });
});
