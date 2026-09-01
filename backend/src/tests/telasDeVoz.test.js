/**
 * telasDeVoz.test.js — as quatro telas onde se escolhe a voz do narrador.
 *
 * Escolher voz acontece em quatro lugares independentes, e nenhum deles chama
 * os outros:
 *
 *   1. a barra lateral (`js/sidebar-voice.js`), que também é o CATÁLOGO;
 *   2. a gaveta de configurações (`js/settings-drawer.js`), em ~44 páginas;
 *   3. a página do assistente (`js/ia/pagina-ia-assistant.js`);
 *   4. o portal do responsável (`portal-responsavel/`), que é outro bundle.
 *
 * O que este arquivo fixa são as três coisas que já divergiram entre eles e
 * que nenhum teste de unidade pegaria, porque cada tela funciona sozinha:
 *
 *   - o significado de cada chave do localStorage (nome de voz numa, liga e
 *     desliga na outra);
 *   - a prévia — trocar de voz sem ouvi-la é escolher no escuro;
 *   - o rótulo da voz, que era diferente em cada tela para a mesma voz.
 *
 * A leitura é do TEXTO dos arquivos: são módulos de navegador, sem `require`
 * possível daqui, e o que precisa valer em produção é o que está escrito neles.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..', '..');

function fonte(relativo) {
    return fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
}

/**
 * Descrições do catálogo (`window.Vozes.LISTA`). É a fonte da verdade dos
 * rótulos; as listas escritas à mão têm de repetir estas mesmas palavras.
 */
const DESCRICOES = {
    brian: 'Grave e tranquila',
    adam: 'Firme e direta',
    eric: 'Suave e natural',
    george: 'Calorosa e pausada',
};

describe('Telas de escolha de voz', () => {
    describe('significado das chaves do navegador', () => {
        it('a página do assistente grava liga/desliga — não o nome da voz — em user_voice_preference', () => {
            const pagina = fonte('js/ia/pagina-ia-assistant.js');

            // A chave guarda 'male' ou 'off'. Gravar 'eric' ali fazia o
            // controller parar de atualizar o `voiceGender` legado e o portal
            // do responsável ler um valor que ele não conhece.
            expect(pagina).toContain(
                "localStorage.setItem('user_voice_preference', preferenciaDeNarracao(cfg.voice))"
            );
            expect(pagina).not.toContain(
                "localStorage.setItem('user_voice_preference', cfg.voice)"
            );
        });

        it('a página do assistente não manda o nome da voz como voicePreference ao servidor', () => {
            const pagina = fonte('js/ia/pagina-ia-assistant.js');
            expect(pagina).toContain('voicePreference: preferenciaDeNarracao(cfg.voice)');
            expect(pagina).not.toContain('voicePreference: cfg.voice');
        });

        it('desligar a narração não grava "off" como se fosse uma voz', () => {
            const pagina = fonte('js/ia/pagina-ia-assistant.js');
            // A voz escolhida sobrevive ao desligamento e volta ao religar.
            expect(pagina).not.toContain('elevenlabsVoice: cfg.voice,');
            expect(pagina).toContain("cfg.voice === 'off' ? {} : { elevenlabsVoice: cfg.voice }");
        });
    });

    describe('prévia ao trocar de voz', () => {
        it('a barra lateral e o chatbot pedem prévia ao catálogo', () => {
            expect(fonte('js/sidebar-voice.js')).toContain('{ previa: true }');
            expect(fonte('js/chatbot-ia.js')).toContain('{ previa: true }');
        });

        it('a gaveta de configurações pede prévia ao catálogo', () => {
            expect(fonte('js/settings-drawer.js')).toContain(
                'window.Vozes.definir(chosen, { previa: true })'
            );
        });

        it('a página do assistente narra a voz nova ao salvar', () => {
            const pagina = fonte('js/ia/pagina-ia-assistant.js');
            expect(pagina).toContain("window.speak('Voz alterada com sucesso!')");
            // Só quando a voz mudou: salvar idioma ou narração automática não
            // pode virar uma frase falada a cada visita à gaveta.
            expect(pagina).toContain('cfg.voice !== vozAnterior');
        });

        it('o portal do responsável toca a prévia ao registrar a escolha', () => {
            const catalogo = fonte('portal-responsavel/src/constants/vozes.ts');

            // A prévia mora em `definirVoz`, e não nos dois seletores que a
            // chamam (cabeçalho e chatbot): é assim que os dois ganham som sem
            // que nenhum precise lembrar de pedir — que foi como o portal ficou
            // sem prévia enquanto os três perfis em HTML puro tinham.
            expect(catalogo).toContain("const FRASE_PREVIA = 'Voz alterada com sucesso!'");
            expect(catalogo).toContain('void tocarPrevia()');
            expect(catalogo).toContain("await import('../services/ttsService')");

            for (const tela of [
                'portal-responsavel/src/components/Header.tsx',
                'portal-responsavel/src/components/ChatbotIA.tsx',
            ]) {
                expect(fonte(tela)).toContain('definirVoz(');
            }
        });
    });

    describe('rótulos iguais para a mesma voz', () => {
        it.each(Object.entries(DESCRICOES))(
            '%s tem a mesma descrição no catálogo e no portal',
            (nome, descricao) => {
                expect(fonte('js/sidebar-voice.js')).toContain(
                    `{ nome: '${nome}', rotulo: '${nome[0].toUpperCase()}${nome.slice(1)}', descricao: '${descricao}' }`
                );
                expect(fonte('portal-responsavel/src/constants/vozes.ts')).toContain(
                    `{ nome: '${nome}', rotulo: '${nome[0].toUpperCase()}${nome.slice(1)}', descricao: '${descricao}' }`
                );
            }
        );

        it.each(Object.entries(DESCRICOES))(
            '%s tem a mesma descrição nas duas listas escritas à mão',
            (nome, descricao) => {
                const rotulo = `${nome[0].toUpperCase()}${nome.slice(1)} — ${descricao}`;
                // A gaveta roda em telas sem `sidebar-voice.js`; a página do
                // assistente tem "Desativada", que não é voz. Por isso as duas
                // seguem à mão — mas com o texto do catálogo.
                expect(fonte('js/settings-drawer.js')).toContain(rotulo);
                expect(fonte('html/direcao/ia-assistant.html')).toContain(rotulo);
            }
        );
    });
});
