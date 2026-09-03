/**
 * canal-denuncia.js — o canal de denúncia que o ECA Digital exige que exista
 * e que esteja VISÍVEL.
 *
 * POR QUE UM ARQUIVO PRÓPRIO, E NÃO UM `<a>` para uma página
 * ----------------------------------------------------------
 * A lei não pede uma página de denúncia; pede um canal acessível a partir da
 * tela do aluno e do responsável. Quem precisa denunciar está numa situação
 * ruim, muitas vezes com o celular na mão e pouco tempo — cada navegação a mais
 * é uma chance de desistir. O formulário abre onde a pessoa já está.
 *
 * ACESSIBILIDADE NÃO É ENFEITE AQUI (LBI + eMAG)
 * ----------------------------------------------
 * Este é justamente o componente que não pode excluir ninguém: a pessoa com
 * deficiência visual é estatisticamente mais exposta a bullying, não menos. Por
 * isso o diálogo tem `role="dialog"`, `aria-modal`, rótulo associado, foco
 * levado para dentro ao abrir e DEVOLVIDO ao botão ao fechar, Esc para sair e
 * armadilha de foco no Tab. Sem a devolução do foco, quem navega por teclado
 * fecha o modal e "cai" no topo da página, perdendo o lugar onde estava.
 *
 * SEM `innerHTML` COM DADO DE USUÁRIO
 * -----------------------------------
 * Todo texto vindo da API entra por `textContent`. O relato é escrito pela
 * própria pessoa e volta na resposta; concatenar isso em HTML seria XSS
 * autoinfligido numa tela usada por criança.
 */
(function () {
    'use strict';

    var CATEGORIAS = [
        { valor: 'bullying', rotulo: 'Bullying' },
        { valor: 'ciberbullying', rotulo: 'Cyberbullying (pela internet)' },
        { valor: 'assedio', rotulo: 'Assédio' },
        { valor: 'discriminacao', rotulo: 'Discriminação ou preconceito' },
        { valor: 'violencia', rotulo: 'Violência ou ameaça' },
        { valor: 'automutilacao', rotulo: 'Automutilação ou risco à vida' },
        { valor: 'outro', rotulo: 'Outro' },
    ];

    var FOCAVEIS =
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

    var dialogo = null;
    var origemDoFoco = null;

    function elemento(tag, props, filhos) {
        var el = document.createElement(tag);
        Object.keys(props || {}).forEach(function (chave) {
            if (chave.indexOf('aria-') === 0 || chave === 'role' || chave === 'for') {
                el.setAttribute(chave, props[chave]);
            } else if (chave === 'texto') {
                el.textContent = props[chave];
            } else {
                el[chave] = props[chave];
            }
        });
        (filhos || []).forEach(function (filho) {
            el.appendChild(filho);
        });
        return el;
    }

    function fechar() {
        if (!dialogo) return;
        dialogo.remove();
        dialogo = null;
        document.removeEventListener('keydown', aoTeclar, true);
        // Devolve o foco a quem abriu: sem isso, quem usa teclado ou leitor de
        // tela é jogado para o início do documento.
        if (origemDoFoco && typeof origemDoFoco.focus === 'function') origemDoFoco.focus();
    }

    function aoTeclar(evento) {
        if (!dialogo) return;
        if (evento.key === 'Escape') {
            evento.preventDefault();
            fechar();
            return;
        }
        if (evento.key !== 'Tab') return;

        // Armadilha de foco: o Tab não pode sair do diálogo e continuar
        // navegando a página que está atrás, invisível para quem enxerga.
        var focaveis = Array.prototype.slice.call(dialogo.querySelectorAll(FOCAVEIS));
        if (focaveis.length === 0) return;
        var primeiro = focaveis[0];
        var ultimo = focaveis[focaveis.length - 1];
        if (evento.shiftKey && document.activeElement === primeiro) {
            evento.preventDefault();
            ultimo.focus();
        } else if (!evento.shiftKey && document.activeElement === ultimo) {
            evento.preventDefault();
            primeiro.focus();
        }
    }

    function abrir(botaoDeOrigem) {
        if (dialogo) return;
        origemDoFoco = botaoDeOrigem || document.activeElement;

        var titulo = elemento('h2', {
            id: 'denuncia-titulo',
            texto: 'Denunciar bullying, assédio ou discriminação',
            className: 'denuncia-titulo',
        });

        var explicacao = elemento('p', {
            className: 'denuncia-ajuda',
            texto:
                'Conte o que aconteceu. Sua denúncia vai para a equipe da escola, ' +
                'que é quem vai apurar. A pessoa denunciada não é avisada por aqui.',
        });

        var rotuloTipo = elemento('label', {
            htmlFor: 'denuncia-categoria',
            texto: 'Tipo da denúncia',
        });
        var select = elemento('select', { id: 'denuncia-categoria', required: true });
        CATEGORIAS.forEach(function (categoria) {
            select.appendChild(
                elemento('option', { value: categoria.valor, texto: categoria.rotulo })
            );
        });

        var rotuloRelato = elemento('label', {
            htmlFor: 'denuncia-relato',
            texto: 'O que aconteceu?',
        });
        var textarea = elemento('textarea', {
            id: 'denuncia-relato',
            rows: 6,
            maxLength: 2000,
            required: true,
            placeholder: 'Descreva com suas palavras. Se puder, diga quando e onde aconteceu.',
        });

        // `aria-live` para que o leitor de tela anuncie o resultado sem que a
        // pessoa precise sair procurando o que mudou na tela.
        var aviso = elemento('p', { className: 'denuncia-aviso', role: 'status' });
        aviso.setAttribute('aria-live', 'polite');

        var enviar = elemento('button', {
            type: 'submit',
            className: 'btn btn-accent',
            texto: 'Enviar denúncia',
        });
        var cancelar = elemento('button', {
            type: 'button',
            className: 'btn btn-secondary',
            texto: 'Cancelar',
        });
        cancelar.addEventListener('click', fechar);

        var formulario = elemento('form', { className: 'denuncia-form' }, [
            rotuloTipo,
            select,
            rotuloRelato,
            textarea,
            aviso,
            elemento('div', { className: 'denuncia-acoes' }, [cancelar, enviar]),
        ]);

        formulario.addEventListener('submit', function (evento) {
            evento.preventDefault();
            enviar.disabled = true;
            aviso.textContent = 'Enviando...';

            window
                .apiFetch('/moderacao/denunciar', {
                    method: 'POST',
                    body: JSON.stringify({ categoria: select.value, relato: textarea.value }),
                })
                .then(function (resposta) {
                    if (resposta?.success) {
                        aviso.textContent =
                            'Denúncia registrada. Protocolo: ' +
                            ((resposta.data && resposta.data.protocolo) || '—');
                        textarea.disabled = true;
                        select.disabled = true;
                        cancelar.textContent = 'Fechar';
                    } else {
                        aviso.textContent =
                            (resposta && resposta.error) || 'Não foi possível registrar agora.';
                        enviar.disabled = false;
                    }
                })
                .catch(function () {
                    aviso.textContent = 'Falha de conexão. Tente novamente.';
                    enviar.disabled = false;
                });
        });

        var caixa = elemento(
            'div',
            {
                className: 'denuncia-caixa',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'denuncia-titulo',
            },
            [titulo, explicacao, formulario]
        );

        dialogo = elemento('div', { className: 'denuncia-overlay' }, [caixa]);
        dialogo.addEventListener('click', function (evento) {
            if (evento.target === dialogo) fechar();
        });

        document.body.appendChild(dialogo);
        document.addEventListener('keydown', aoTeclar, true);
        select.focus();
    }

    /**
     * Cria o botão e o coloca no container indicado por
     * `[data-canal-denuncia]`. Sem container na página, o botão não aparece —
     * é a página que decide onde ele fica, não este arquivo.
     */
    function montar() {
        var containers = document.querySelectorAll('[data-canal-denuncia]');
        Array.prototype.forEach.call(containers, function (container) {
            if (container.querySelector('.btn-denuncia')) return;
            var botao = elemento('button', {
                type: 'button',
                className: 'btn btn-secondary btn-sm btn-denuncia',
                title: 'Denunciar bullying, assédio ou discriminação',
            });
            botao.setAttribute('aria-haspopup', 'dialog');
            var icone = elemento('i', { className: 'bi bi-shield-exclamation' });
            icone.setAttribute('aria-hidden', 'true');
            botao.appendChild(icone);
            botao.appendChild(elemento('span', { texto: 'Denunciar' }));
            botao.addEventListener('click', function () {
                abrir(botao);
            });
            container.appendChild(botao);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', montar);
    } else {
        montar();
    }

    window.canalDenuncia = { abrir: abrir, fechar: fechar, CATEGORIAS: CATEGORIAS };
})();
