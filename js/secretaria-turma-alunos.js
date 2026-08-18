/**
 * secretaria-turma-alunos.js — tela da turma na Secretaria.
 *
 * Dois fluxos: cadastro/vínculo individual de aluno e importação em lote
 * (upload → pré-visualização → confirmação), com desfazer por 24 h.
 *
 * ─── MOTION (AGENTS.md §8 · skill design-motion-principles) ──────────────────
 * Weighting: Emil (primário) · Jakub (secundário). Este arquivo NÃO define
 * animação: ele só troca `data-state` / `data-loading` e as transições vêm de
 * css/motion.css, que já respeita `prefers-reduced-motion`.
 *
 * O que anima e por quê:
 *   - Modal e backdrop: superfície grande, uso ocasional → --motion-surface.
 *   - Skeleton → tabela: entrada de conteúdo, nunca spinner solto.
 *   - Barra de progresso do upload: feedback funcional (parse de PDF leva
 *     segundos); sem ela o usuário acha que travou.
 * O que NÃO anima, de propósito:
 *   - Lista do autocomplete: se refaz a cada tecla, é alta frequência.
 *   - Checkbox de cada linha da pré-visualização: o usuário marca dezenas.
 *   - Redesenho da tabela após salvar: ação de alta frequência da secretaria.
 *
 * ─── SEGURANÇA ──────────────────────────────────────────────────────────────
 * Todo texto vindo do servidor ou do arquivo entra no DOM por `textContent`.
 * Um nome de aluno contendo HTML no arquivo importado não pode virar XSS
 * armazenado — por isso não existe `innerHTML` com dado nesta tela.
 */
(function () {
    'use strict';

    var API = function () {
        return window.API_BASE_URL || '/api';
    };

    // Parse de PDF com 30+ alunos leva alguns segundos, e o plano free do
    // Render ainda pode estar em cold start. 60 s é folga, não otimismo.
    var TIMEOUT_UPLOAD_MS = 60000;
    var DEBOUNCE_BUSCA_MS = 300;
    var MINIMO_BUSCA = 3;
    var TAMANHO_MAXIMO = 5 * 1024 * 1024;

    var UFS = [
        'AC',
        'AL',
        'AM',
        'AP',
        'BA',
        'CE',
        'DF',
        'ES',
        'GO',
        'MA',
        'MG',
        'MS',
        'MT',
        'PA',
        'PB',
        'PE',
        'PI',
        'PR',
        'RJ',
        'RN',
        'RO',
        'RR',
        'RS',
        'SC',
        'SE',
        'SP',
        'TO',
    ];

    var SITUACOES = [
        ['ativo', 'Ativo'],
        ['transferido', 'Transferido'],
        ['abandono', 'Abandono'],
        ['nao_compareceu', 'Não compareceu'],
        ['remanejado', 'Remanejado'],
        ['outros', 'Outros'],
    ];

    var ROTULO_STATUS = {
        novo: ['Novo', 'chip-verde'],
        existente: ['Já cadastrado', 'chip-azul'],
        ja_na_turma: ['Já está na turma', 'chip-cinza'],
        divergente: ['Divergente', 'chip-amarelo'],
        duplicado_no_arquivo: ['Repetido no arquivo', 'chip-amarelo'],
        erro: ['Com erro', 'chip-vermelho'],
    };

    var IMPORTAVEIS = { novo: true, existente: true, divergente: true };

    // ── Estado da tela ───────────────────────────────────────────────────────
    var turmaId = new URLSearchParams(window.location.search).get('turmaId') || '';
    var anoLetivo = new URLSearchParams(window.location.search).get('anoLetivo') || '';
    var alunoVinculandoId = null; // preenchido ao escolher no autocomplete
    var importacaoAtual = null; // { importacaoId, linhas, ... }
    var loteDesfazivel = null; // importacaoId ainda dentro das 24 h
    var enviando = false;

    var $ = function (id) {
        return document.getElementById(id);
    };

    // ═════════════════════════════════════════════════════════════════════════
    // Utilidades
    // ═════════════════════════════════════════════════════════════════════════

    function toast(mensagem, tipo) {
        var area = $('areaToast');
        if (!area) return;
        var caixa = document.createElement('div');
        caixa.className = 'toast toast-' + (tipo || 'ok');
        caixa.textContent = mensagem;
        area.appendChild(caixa);
        window.setTimeout(function () {
            caixa.remove();
        }, 5000);
    }

    /** Cria um elemento com texto seguro (textContent, nunca innerHTML). */
    function elemento(tag, classe, texto) {
        var no = document.createElement(tag);
        if (classe) no.className = classe;
        if (texto !== undefined && texto !== null) no.textContent = String(texto);
        return no;
    }

    function celula(texto, rotulo) {
        var td = elemento('td', null, texto);
        if (rotulo) td.setAttribute('data-rotulo', rotulo); // usado no layout de cards (mobile)
        return td;
    }

    function limpar(no) {
        while (no && no.firstChild) no.removeChild(no.firstChild);
    }

    async function chamarApi(caminho, opcoes) {
        var configuracao = Object.assign({ credentials: 'include' }, opcoes || {});
        var resposta = await fetch(API() + caminho, configuracao);
        var corpo = null;
        try {
            corpo = await resposta.json();
        } catch {
            corpo = null;
        }
        if (!resposta.ok || !corpo || corpo.success === false) {
            var erro = new Error((corpo && corpo.error) || 'Não foi possível concluir a operação.');
            erro.status = resposta.status;
            erro.corpo = corpo;
            throw erro;
        }
        return corpo.data;
    }

    // ── Máscaras e formatação ────────────────────────────────────────────────

    /** Mantém só dígitos e corta em 12 — aceita colar RA com pontos e traços. */
    function mascararRa(valor) {
        return String(valor || '')
            .replace(/\D/g, '')
            .slice(0, 12);
    }

    function mascararData(valor) {
        var digitos = String(valor || '')
            .replace(/\D/g, '')
            .slice(0, 8);
        if (digitos.length <= 2) return digitos;
        if (digitos.length <= 4) return digitos.slice(0, 2) + '/' + digitos.slice(2);
        return digitos.slice(0, 2) + '/' + digitos.slice(2, 4) + '/' + digitos.slice(4);
    }

    /**
     * Formata uma data ISO. Devolve string VAZIA (não '—') quando não dá para
     * formatar, para que quem chama consiga cair no valor bruto do arquivo —
     * numa linha com erro é justamente o texto original que o usuário precisa
     * ver para corrigir.
     */
    function formatarDataIso(iso) {
        if (!iso) return '';
        var data = new Date(iso);
        if (Number.isNaN(data.getTime())) return '';
        var dia = String(data.getUTCDate()).padStart(2, '0');
        var mes = String(data.getUTCMonth() + 1).padStart(2, '0');
        return dia + '/' + mes + '/' + data.getUTCFullYear();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Modal: abrir/fechar, foco preso, Esc
    // ═════════════════════════════════════════════════════════════════════════

    var focoAnterior = null;

    function abrirModal(id) {
        var fundo = $(id);
        if (!fundo) return;
        focoAnterior = document.activeElement;
        fundo.hidden = false;

        // Um frame antes de trocar o estado: o browser precisa registrar o
        // estado inicial "closed" para que a transição de fato aconteça.
        window.requestAnimationFrame(function () {
            fundo.setAttribute('data-state', 'open');
            var caixa = fundo.querySelector('[data-motion="modal"]');
            if (caixa) caixa.setAttribute('data-state', 'open');
            var primeiro = fundo.querySelector('input:not([hidden]), button, select, textarea');
            if (primeiro) primeiro.focus();
        });
    }

    function fecharModal(id) {
        var fundo = $(id);
        if (!fundo || fundo.hidden) return;
        var caixa = fundo.querySelector('[data-motion="modal"]');

        fundo.setAttribute('data-state', 'closed');
        if (caixa) caixa.setAttribute('data-state', 'closed');

        // Espera a transição de saída antes de esconder. Com
        // prefers-reduced-motion o CSS zera a duração e isto vira ~imediato.
        var duracao = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240;
        window.setTimeout(function () {
            fundo.hidden = true;
            if (focoAnterior && focoAnterior.focus) focoAnterior.focus();
        }, duracao);
    }

    /** Prende o Tab dentro do modal aberto e fecha no Esc. */
    function instalarAcessibilidadeDeModal() {
        document.addEventListener('keydown', function (evento) {
            var aberto = document.querySelector('.modal-backdrop:not([hidden])');
            if (!aberto) return;

            if (evento.key === 'Escape') {
                evento.preventDefault();
                fecharModal(aberto.id);
                return;
            }
            if (evento.key !== 'Tab') return;

            var focaveis = aberto.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            var visiveis = Array.prototype.filter.call(focaveis, function (no) {
                return no.offsetParent !== null;
            });
            if (visiveis.length === 0) return;

            var primeiro = visiveis[0];
            var ultimo = visiveis[visiveis.length - 1];
            if (evento.shiftKey && document.activeElement === primeiro) {
                evento.preventDefault();
                ultimo.focus();
            } else if (!evento.shiftKey && document.activeElement === ultimo) {
                evento.preventDefault();
                primeiro.focus();
            }
        });

        document.addEventListener('click', function (evento) {
            if (evento.target.closest('[data-fechar-modal]')) {
                var fundo = evento.target.closest('.modal-backdrop');
                if (fundo) fecharModal(fundo.id);
            }
            // Clique no fundo (fora da caixa) fecha.
            if (evento.target.classList && evento.target.classList.contains('modal-backdrop')) {
                fecharModal(evento.target.id);
            }
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Lista de alunos da turma
    // ═════════════════════════════════════════════════════════════════════════

    async function carregarTurma() {
        var area = $('areaAlunos');
        try {
            var consulta = anoLetivo ? '?anoLetivo=' + encodeURIComponent(anoLetivo) : '';
            var dados = await chamarApi(
                '/secretaria/turmas/' + encodeURIComponent(turmaId) + '/alunos' + consulta
            );

            anoLetivo = String(dados.anoLetivo);
            $('tituloTurma').textContent = 'Turma ' + (dados.turma.nome || '');
            document.title = 'Turma ' + (dados.turma.nome || '') + ' - Secretaria';

            var sub = $('subtituloTurma');
            limpar(sub);
            if (dados.turma.sala)
                sub.appendChild(elemento('span', null, 'Sala ' + dados.turma.sala));
            if (dados.turma.periodo) sub.appendChild(elemento('span', null, dados.turma.periodo));
            sub.appendChild(elemento('span', null, 'Ano letivo ' + dados.anoLetivo));

            desenharAlunos(dados.alunos);
            area.setAttribute('data-loading', 'false');
        } catch (erro) {
            area.setAttribute('data-loading', 'false');
            toast(erro.message, 'erro');
        }
    }

    function desenharAlunos(alunos) {
        var corpo = $('corpoTabelaAlunos');
        limpar(corpo);

        $('contadorAlunos').textContent =
            alunos.length + (alunos.length === 1 ? ' aluno' : ' alunos');
        $('estadoVazio').hidden = alunos.length > 0;

        alunos.forEach(function (aluno) {
            var linha = document.createElement('tr');
            linha.appendChild(celula(aluno.numeroChamada || '—', 'Nº'));
            linha.appendChild(celula(aluno.nomeExibicao || aluno.nome, 'Nome'));
            linha.appendChild(
                celula(
                    aluno.ra ? aluno.ra + (aluno.raDigito ? '-' + aluno.raDigito : '') : '—',
                    'RA'
                )
            );
            linha.appendChild(celula(aluno.nascimentoFormatado || '—', 'Nascimento'));

            var tdSituacao = elemento('td', null);
            tdSituacao.setAttribute('data-rotulo', 'Situação');
            var etiqueta = elemento(
                'span',
                'chip ' + (aluno.situacao === 'ativo' ? 'chip-verde' : 'chip-cinza'),
                aluno.situacaoRotulo
            );
            tdSituacao.appendChild(etiqueta);
            if (aluno.possuiDeficiencia) {
                tdSituacao.appendChild(document.createTextNode(' '));
                tdSituacao.appendChild(elemento('span', 'chip chip-azul', 'PCD'));
            }
            linha.appendChild(tdSituacao);

            var tdAcoes = elemento('td', null);
            var remover = elemento('button', 'sec-btn sec-btn-danger');
            remover.type = 'button';
            remover.setAttribute('data-remover', aluno.id);
            remover.setAttribute(
                'aria-label',
                'Remover ' + (aluno.nomeExibicao || aluno.nome) + ' da turma'
            );
            remover.appendChild(elemento('i', 'bi bi-person-dash'));
            tdAcoes.appendChild(remover);
            linha.appendChild(tdAcoes);

            corpo.appendChild(linha);
        });
    }

    async function removerAluno(alunoId, botao) {
        botao.disabled = true;
        try {
            await chamarApi(
                '/secretaria/turmas/' +
                    encodeURIComponent(turmaId) +
                    '/alunos/' +
                    encodeURIComponent(alunoId) +
                    '?anoLetivo=' +
                    encodeURIComponent(anoLetivo),
                { method: 'DELETE', headers: window.csrfHeaders(false) }
            );
            toast('Aluno removido da turma. O cadastro dele na escola foi mantido.', 'ok');
            await carregarTurma();
        } catch (erro) {
            botao.disabled = false;
            toast(erro.message, 'erro');
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FLUXO A — adicionar aluno
    // ═════════════════════════════════════════════════════════════════════════

    function montarSelects() {
        var uf = $('campoUf');
        UFS.forEach(function (sigla) {
            var opcao = elemento('option', null, sigla);
            opcao.value = sigla;
            if (sigla === 'SP') opcao.selected = true;
            uf.appendChild(opcao);
        });

        var situacao = $('campoSituacao');
        SITUACOES.forEach(function (par) {
            var opcao = elemento('option', null, par[1]);
            opcao.value = par[0];
            situacao.appendChild(opcao);
        });
    }

    function limparFormulario() {
        $('formAluno').reset();
        alunoVinculandoId = null;
        ['campoNome', 'campoRa', 'campoDigito', 'campoNascimento'].forEach(function (id) {
            $(id).readOnly = false;
        });
        $('campoUf').value = 'SP';
        $('campoSerie').value = '';
        limpar($('alunoSelecionado'));
        limpar($('avisoFormulario'));
        ['erroNome', 'erroRa', 'erroDigito', 'erroNascimento'].forEach(function (id) {
            $(id).textContent = '';
        });
        $('areaTranstornos').hidden = true;
        $('rotuloSalvar').textContent = 'Cadastrar e vincular';
        $('listaBusca').hidden = true;
        $('buscaAluno').value = '';
        $('buscaAluno').setAttribute('aria-expanded', 'false');
    }

    /** Preenche e trava os campos quando o usuário escolhe um aluno existente. */
    function selecionarAlunoExistente(aluno) {
        alunoVinculandoId = aluno.id;
        $('campoNome').value = aluno.nome || '';
        $('campoRa').value = aluno.ra || '';
        $('campoDigito').value = aluno.raDigito || '';
        $('campoUf').value = aluno.raUf || 'SP';
        $('campoNascimento').value = aluno.nascimentoFormatado || '';
        $('campoDeficiencia').checked = !!aluno.possuiDeficiencia;

        ['campoNome', 'campoRa', 'campoDigito', 'campoNascimento'].forEach(function (id) {
            $(id).readOnly = true;
        });

        var area = $('alunoSelecionado');
        limpar(area);
        var caixa = elemento('div', 'alerta alerta-ok');
        caixa.appendChild(elemento('i', 'bi bi-check-circle'));
        caixa.appendChild(
            elemento(
                'span',
                null,
                'Vinculando ' +
                    (aluno.nomeExibicao || aluno.nome) +
                    ' — os dados vêm do cadastro existente.'
            )
        );
        var trocar = elemento('button', 'sec-btn sec-btn-ghost', 'Trocar');
        trocar.type = 'button';
        trocar.id = 'btnLimparSelecao';
        trocar.style.marginInlineStart = 'auto';
        caixa.appendChild(trocar);
        area.appendChild(caixa);

        $('rotuloSalvar').textContent = 'Vincular à turma';
        $('listaBusca').hidden = true;
        $('buscaAluno').setAttribute('aria-expanded', 'false');
    }

    function instalarAutocomplete() {
        var campo = $('buscaAluno');
        var lista = $('listaBusca');
        var temporizador = null;

        campo.addEventListener('input', function () {
            window.clearTimeout(temporizador);
            var termo = campo.value.trim();

            if (termo.length < MINIMO_BUSCA) {
                lista.hidden = true;
                campo.setAttribute('aria-expanded', 'false');
                return;
            }

            // Debounce de 300 ms: sem ele cada tecla vira uma consulta ao banco.
            temporizador = window.setTimeout(async function () {
                try {
                    var dados = await chamarApi(
                        '/secretaria/alunos/buscar?q=' + encodeURIComponent(termo)
                    );
                    desenharResultadosBusca(dados.alunos);
                } catch {
                    lista.hidden = true;
                    campo.setAttribute('aria-expanded', 'false');
                }
            }, DEBOUNCE_BUSCA_MS);
        });

        // Fecha a lista ao sair do campo, mas depois do clique no item.
        campo.addEventListener('blur', function () {
            window.setTimeout(function () {
                lista.hidden = true;
                campo.setAttribute('aria-expanded', 'false');
            }, 150);
        });

        lista.addEventListener('click', function (evento) {
            var item = evento.target.closest('[data-aluno]');
            if (!item) return;
            selecionarAlunoExistente(JSON.parse(item.getAttribute('data-aluno')));
        });
    }

    function desenharResultadosBusca(alunos) {
        var lista = $('listaBusca');
        limpar(lista);

        if (!alunos.length) {
            lista.appendChild(
                elemento(
                    'p',
                    'autocomplete-vazio',
                    'Nenhum aluno encontrado. Preencha os campos abaixo para cadastrar.'
                )
            );
        } else {
            alunos.forEach(function (aluno) {
                var item = elemento('button', 'autocomplete-item');
                item.type = 'button';
                item.setAttribute('role', 'option');
                item.setAttribute('data-aluno', JSON.stringify(aluno));
                item.appendChild(document.createTextNode(aluno.nomeExibicao || aluno.nome));
                var detalhe = elemento(
                    'small',
                    null,
                    'RA ' +
                        (aluno.ra || '—') +
                        (aluno.turmaAtual ? ' · turma ' + aluno.turmaAtual : '')
                );
                item.appendChild(detalhe);
                lista.appendChild(item);
            });
        }

        lista.hidden = false;
        $('buscaAluno').setAttribute('aria-expanded', 'true');
    }

    /** Validação de espelho do servidor — o servidor revalida tudo de qualquer forma. */
    function validarFormulario() {
        var erros = 0;
        var definir = function (id, mensagem) {
            $(id).textContent = mensagem || '';
            if (mensagem) erros++;
        };

        var nome = $('campoNome').value.trim().replace(/\s+/g, ' ');
        definir(
            'erroNome',
            !nome
                ? 'Informe o nome.'
                : nome.length < 3
                  ? 'Nome muito curto.'
                  : nome.indexOf(' ') === -1
                    ? 'Informe nome e sobrenome.'
                    : ''
        );

        var ra = mascararRa($('campoRa').value);
        definir('erroRa', ra.length !== 12 ? 'O RA deve ter 12 dígitos.' : '');

        var digito = $('campoDigito').value.trim().toUpperCase();
        definir('erroDigito', /^[0-9X]$/.test(digito) ? '' : 'Use 0-9 ou X.');

        var nascimento = $('campoNascimento').value.trim();
        definir(
            'erroNascimento',
            /^\d{2}\/\d{2}\/\d{4}$/.test(nascimento) ? '' : 'Use dd/mm/aaaa.'
        );

        return erros === 0;
    }

    async function salvarAluno(evento) {
        evento.preventDefault();
        if (enviando) return;

        // Vincular aluno existente não passa pela validação de cadastro novo.
        if (!alunoVinculandoId && !validarFormulario()) {
            toast('Confira os campos destacados.', 'erro');
            return;
        }

        var botao = $('btnSalvarAluno');
        enviando = true;
        botao.disabled = true;

        var corpo = alunoVinculandoId
            ? {
                  alunoId: alunoVinculandoId,
                  anoLetivo: Number(anoLetivo),
                  numeroChamada: $('campoChamada').value,
                  serie: $('campoSerie').value,
              }
            : {
                  nome: $('campoNome').value.trim(),
                  ra: mascararRa($('campoRa').value),
                  raDigito: $('campoDigito').value.trim().toUpperCase(),
                  raUf: $('campoUf').value,
                  dataNascimento: $('campoNascimento').value.trim(),
                  serie: $('campoSerie').value.trim(),
                  numeroChamada: $('campoChamada').value,
                  situacao: $('campoSituacao').value,
                  possuiDeficiencia: $('campoDeficiencia').checked,
                  transtornos: $('campoDeficiencia').checked ? $('campoTranstornos').value : '',
                  anoLetivo: Number(anoLetivo),
              };

        try {
            var dados = await chamarApi(
                '/secretaria/turmas/' + encodeURIComponent(turmaId) + '/alunos',
                {
                    method: 'POST',
                    headers: window.csrfHeaders(true),
                    body: JSON.stringify(corpo),
                }
            );

            fecharModal('modalAdicionar');
            toast(
                dados.vinculado
                    ? 'Aluno vinculado à turma.'
                    : 'Aluno cadastrado e vinculado à turma.',
                'ok'
            );
            if (dados.avisos && dados.avisos.length) toast(dados.avisos[0], 'aviso');
            await carregarTurma();
        } catch (erro) {
            // 409 com alunoId: o RA já existe. Em vez de um erro sem saída,
            // oferecemos o vínculo direto com o cadastro que já está lá.
            if (erro.status === 409 && erro.corpo && erro.corpo.data && erro.corpo.data.alunoId) {
                oferecerVinculo(erro.corpo.data, erro.message);
            } else {
                mostrarErroFormulario(erro);
            }
        } finally {
            enviando = false;
            botao.disabled = false;
        }
    }

    function oferecerVinculo(dados, mensagem) {
        var area = $('avisoFormulario');
        limpar(area);
        var caixa = elemento('div', 'alerta alerta-atencao');
        caixa.appendChild(elemento('span', null, mensagem));
        var vincular = elemento('button', 'sec-btn sec-btn-primary', 'Vincular a esta turma');
        vincular.type = 'button';
        vincular.style.marginInlineStart = 'auto';
        vincular.addEventListener('click', function () {
            alunoVinculandoId = dados.alunoId;
            $('rotuloSalvar').textContent = 'Vincular à turma';
            $('formAluno').requestSubmit();
        });
        caixa.appendChild(vincular);
        area.appendChild(caixa);
    }

    function mostrarErroFormulario(erro) {
        var area = $('avisoFormulario');
        limpar(area);
        var caixa = elemento('div', 'alerta alerta-erro');
        caixa.appendChild(elemento('span', null, erro.message));
        area.appendChild(caixa);

        var detalhes = erro.corpo && erro.corpo.detalhes;
        if (Array.isArray(detalhes)) {
            var itens = elemento('ul');
            itens.style.margin = '0.4rem 0 0 1rem';
            detalhes.forEach(function (texto) {
                itens.appendChild(elemento('li', null, texto));
            });
            caixa.appendChild(itens);
        }
        toast(erro.message, 'erro');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FLUXO B — importação em lote
    // ═════════════════════════════════════════════════════════════════════════

    function irParaPasso(numero) {
        [1, 2, 3].forEach(function (n) {
            var secao = document.querySelector('[data-passo="' + n + '"]');
            if (secao) secao.hidden = n !== numero;
            var barra = document.querySelector('[data-passo-barra="' + n + '"]');
            if (barra)
                barra.className = 'passo' + (n === numero ? ' ativo' : n < numero ? ' feito' : '');
        });

        $('btnConfirmarImportacao').hidden = numero !== 2;
        $('btnDesfazerImportacao').hidden = numero !== 3 || !loteDesfazivel;
        $('btnCancelarImportacao').textContent = numero === 3 ? 'Fechar' : 'Cancelar';
    }

    function baixarModeloCsv() {
        var conteudo =
            '﻿nome;ra;dig ra;uf ra;data de nascimento;nr;serie\n' +
            'MARIA EXEMPLO DA SILVA;000000000001;X;SP;10/03/2015;1;5\n';
        var blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'modelo_importacao_alunos.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    /**
     * Envia o arquivo com XHR (e não fetch) por um motivo só: `upload.onprogress`.
     * Sem barra, o parse de um PDF de 30 alunos parece travamento.
     */
    function enviarArquivo(arquivo) {
        return new Promise(function (resolver, rejeitar) {
            var formulario = new FormData();
            formulario.append('arquivo', arquivo);
            formulario.append('anoLetivo', String(anoLetivo));

            var requisicao = new XMLHttpRequest();
            requisicao.open(
                'POST',
                API() +
                    '/secretaria/turmas/' +
                    encodeURIComponent(turmaId) +
                    '/alunos/importar/preview'
            );
            requisicao.withCredentials = true;
            requisicao.timeout = TIMEOUT_UPLOAD_MS;

            var cabecalhos = window.csrfHeaders(false);
            Object.keys(cabecalhos).forEach(function (chave) {
                requisicao.setRequestHeader(chave, cabecalhos[chave]);
            });

            var barra = $('barraProgresso');
            requisicao.upload.onprogress = function (evento) {
                if (!evento.lengthComputable) return;
                var fracao = evento.loaded / evento.total;
                // A API da barra em css/motion.css é a variável --motion-progress
                // (0 a 1); o `> i` a lê com scaleX, que não causa reflow.
                barra.style.setProperty('--motion-progress', String(fracao));
                barra.setAttribute('aria-valuenow', String(Math.round(fracao * 100)));
                if (fracao >= 1)
                    $('textoProgresso').textContent =
                        'Lendo o arquivo — isso pode levar alguns segundos.';
            };

            requisicao.onload = function () {
                var corpo = null;
                try {
                    corpo = JSON.parse(requisicao.responseText);
                } catch {
                    corpo = null;
                }
                if (requisicao.status >= 200 && requisicao.status < 300 && corpo && corpo.success)
                    return resolver(corpo.data);
                var erro = new Error((corpo && corpo.error) || 'Não foi possível ler o arquivo.');
                erro.status = requisicao.status;
                erro.corpo = corpo;
                rejeitar(erro);
            };
            requisicao.onerror = function () {
                rejeitar(new Error('Falha de rede ao enviar o arquivo.'));
            };
            requisicao.ontimeout = function () {
                rejeitar(new Error('O servidor demorou demais para responder. Tente novamente.'));
            };

            requisicao.send(formulario);
        });
    }

    async function processarArquivo(arquivo) {
        if (!arquivo) return;
        if (arquivo.size > TAMANHO_MAXIMO) return toast('Arquivo acima do limite de 5 MB.', 'erro');

        $('areaProgresso').hidden = false;
        $('textoProgresso').textContent = 'Enviando o arquivo…';
        $('dropzone').setAttribute('aria-disabled', 'true');

        try {
            importacaoAtual = await enviarArquivo(arquivo);
            desenharPreview(importacaoAtual);
            irParaPasso(2);
        } catch (erro) {
            toast(erro.message, 'erro');
        } finally {
            $('areaProgresso').hidden = true;
            $('dropzone').removeAttribute('aria-disabled');
            $('inputArquivo').value = '';
        }
    }

    function desenharPreview(dados) {
        // ── Alertas (conferência de totais e de turma) ───────────────────────
        var alertas = $('alertasPreview');
        limpar(alertas);

        if (dados.conferenciaTotais && dados.conferenciaTotais.confere === true) {
            var ok = elemento('div', 'alerta alerta-ok');
            ok.appendChild(elemento('i', 'bi bi-check-circle'));
            ok.appendChild(elemento('span', null, dados.conferenciaTotais.mensagem));
            alertas.appendChild(ok);
        }

        (dados.avisos || []).forEach(function (texto) {
            var aviso = elemento('div', 'alerta alerta-atencao');
            aviso.appendChild(elemento('i', 'bi bi-exclamation-triangle'));
            aviso.appendChild(elemento('span', null, texto));
            alertas.appendChild(aviso);
        });

        // ── Cabeçalho lido do arquivo ────────────────────────────────────────
        var cabecalho = $('cabecalhoArquivo');
        limpar(cabecalho);
        var campos = [
            ['Escola', dados.cabecalho && dados.cabecalho.nomeEscola],
            ['Classe', dados.cabecalho && dados.cabecalho.codigoClasse],
            ['Turma no arquivo', dados.cabecalho && dados.cabecalho.turma],
            ['Tipo de ensino', dados.cabecalho && dados.cabecalho.tipoEnsino],
            ['Arquivo', dados.nomeArquivo],
            ['Declarados no relatório', dados.totalDeclarado],
        ];
        campos.forEach(function (par) {
            if (!par[1]) return;
            cabecalho.appendChild(elemento('dt', null, par[0]));
            cabecalho.appendChild(elemento('dd', null, par[1]));
        });
        cabecalho.hidden = !cabecalho.firstChild;

        // ── Cards-resumo ─────────────────────────────────────────────────────
        var cards = $('cardsResumo');
        limpar(cards);
        var resumo = dados.resumo || {};
        [
            ['novos', 'Novos'],
            ['existentes', 'Já cadastrados'],
            ['divergentes', 'Divergentes'],
            ['jaNaTurma', 'Já na turma'],
            ['duplicados', 'Repetidos'],
            ['comErro', 'Com erro'],
        ].forEach(function (par) {
            if (!resumo[par[0]]) return;
            var card = elemento('div', 'card-resumo');
            card.appendChild(elemento('strong', null, resumo[par[0]]));
            card.appendChild(elemento('span', null, par[1]));
            cards.appendChild(card);
        });

        // ── Tabela de linhas ─────────────────────────────────────────────────
        var corpo = $('corpoPreview');
        limpar(corpo);

        (dados.linhas || []).forEach(function (linha) {
            var normalizado = linha.dadosNormalizados || {};
            var bruto = linha.dadosBrutos || {};
            var tr = document.createElement('tr');
            if (linha.status === 'erro') tr.className = 'linha-erro';

            var tdMarcar = elemento('td', null);
            tdMarcar.setAttribute('data-rotulo', 'Importar');
            var marcar = document.createElement('input');
            marcar.type = 'checkbox';
            marcar.style.width = '16px';
            marcar.style.height = '16px';
            marcar.style.accentColor = '#10b981';
            marcar.setAttribute('data-indice', String(linha.indice));
            marcar.checked = !!IMPORTAVEIS[linha.status];
            marcar.disabled = !IMPORTAVEIS[linha.status];
            marcar.setAttribute(
                'aria-label',
                'Importar ' + (normalizado.nome || bruto.nome || 'linha ' + (linha.indice + 1))
            );
            tdMarcar.appendChild(marcar);
            tr.appendChild(tdMarcar);

            tr.appendChild(celula(normalizado.numeroChamada || bruto.numeroChamada || '—', 'Nº'));

            // Nome + badge de status + mensagens + divergências, tudo em texto.
            var tdNome = elemento('td', null);
            tdNome.setAttribute('data-rotulo', 'Nome');
            var caixaNome = elemento('div');
            caixaNome.appendChild(elemento('span', null, normalizado.nome || bruto.nome || '—'));
            caixaNome.appendChild(document.createTextNode(' '));
            var rotulo = ROTULO_STATUS[linha.status] || ['—', 'chip-cinza'];
            caixaNome.appendChild(elemento('span', 'chip ' + rotulo[1], rotulo[0]));
            tdNome.appendChild(caixaNome);

            (linha.mensagens || []).forEach(function (mensagem) {
                tdNome.appendChild(elemento('div', 'linha-mensagens', mensagem.texto));
            });

            (linha.divergencias || []).forEach(function (divergencia) {
                var texto = elemento('div', 'divergencia');
                texto.appendChild(document.createTextNode(divergencia.rotulo + ' — cadastro: '));
                texto.appendChild(elemento('b', null, divergencia.atual));
                texto.appendChild(document.createTextNode(' · arquivo: '));
                texto.appendChild(elemento('b', null, divergencia.arquivo));
                tdNome.appendChild(texto);

                var opcao = elemento('label', 'linha-mensagens');
                opcao.style.cursor = 'pointer';
                var atualizar = document.createElement('input');
                atualizar.type = 'checkbox';
                atualizar.setAttribute('data-atualizar', String(linha.indice));
                atualizar.style.accentColor = '#fbbf24';
                opcao.appendChild(atualizar);
                opcao.appendChild(
                    document.createTextNode(' Atualizar o cadastro com o dado do arquivo')
                );
                tdNome.appendChild(opcao);
            });

            tr.appendChild(tdNome);
            tr.appendChild(celula(normalizado.ra || bruto.ra || '—', 'RA'));
            tr.appendChild(celula(normalizado.raDigito || bruto.raDigito || '—', 'Dig.'));
            tr.appendChild(
                celula(
                    formatarDataIso(normalizado.dataNascimento) || bruto.dataNascimento || '—',
                    'Nascimento'
                )
            );
            tr.appendChild(celula(bruto.situacao || 'Ativo', 'Situação'));

            corpo.appendChild(tr);
        });

        $('rotuloConfirmar').textContent =
            'Confirmar ' +
            (resumo.importaveis || 0) +
            (resumo.importaveis === 1 ? ' aluno' : ' alunos');
        $('btnConfirmarImportacao').disabled = !resumo.importaveis;
        $('marcarTodos').checked = !!resumo.importaveis;
    }

    async function confirmarImportacao() {
        if (!importacaoAtual || enviando) return;

        var indices = Array.prototype.map.call(
            document.querySelectorAll('#corpoPreview input[data-indice]:checked'),
            function (caixa) {
                return Number(caixa.getAttribute('data-indice'));
            }
        );
        if (!indices.length) return toast('Selecione ao menos uma linha para importar.', 'erro');

        var atualizarCadastro = Array.prototype.map.call(
            document.querySelectorAll('#corpoPreview input[data-atualizar]:checked'),
            function (caixa) {
                return Number(caixa.getAttribute('data-atualizar'));
            }
        );

        var botao = $('btnConfirmarImportacao');
        enviando = true;
        botao.disabled = true; // trava o duplo clique — o servidor também é idempotente
        var rotulo = $('rotuloConfirmar').textContent;
        $('rotuloConfirmar').textContent = 'Gravando…';

        try {
            var resultado = await chamarApi(
                '/secretaria/turmas/' +
                    encodeURIComponent(turmaId) +
                    '/alunos/importar/' +
                    encodeURIComponent(importacaoAtual.importacaoId) +
                    '/confirmar',
                {
                    method: 'POST',
                    headers: window.csrfHeaders(true),
                    body: JSON.stringify({
                        indices: indices,
                        atualizarCadastro: atualizarCadastro,
                    }),
                }
            );

            loteDesfazivel = resultado.importacaoId;
            desenharResultado(resultado);
            irParaPasso(3);
            toast(
                resultado.criados +
                    ' aluno(s) criado(s), ' +
                    resultado.vinculados +
                    ' vinculado(s).',
                'ok'
            );
            await carregarTurma();
        } catch (erro) {
            toast(erro.message, 'erro');
        } finally {
            enviando = false;
            botao.disabled = false;
            $('rotuloConfirmar').textContent = rotulo;
        }
    }

    function desenharResultado(resultado) {
        var area = $('areaResultado');
        limpar(area);

        var resumo = elemento('div', 'alerta alerta-ok');
        resumo.appendChild(elemento('i', 'bi bi-check-circle'));
        resumo.appendChild(
            elemento(
                'span',
                null,
                resultado.criados +
                    ' aluno(s) criado(s) · ' +
                    resultado.vinculados +
                    ' vinculado(s) · ' +
                    resultado.atualizados +
                    ' atualizado(s)' +
                    (resultado.transferidos
                        ? ' · ' + resultado.transferidos + ' transferido(s) de outra turma'
                        : '') +
                    (resultado.ignorados ? ' · ' + resultado.ignorados + ' ignorado(s)' : '')
            )
        );
        area.appendChild(resumo);

        if (resultado.falhas && resultado.falhas.length) {
            var falhas = elemento('div', 'alerta alerta-erro');
            var lista = elemento('div');
            lista.appendChild(
                elemento('strong', null, resultado.falhas.length + ' linha(s) não gravada(s):')
            );
            resultado.falhas.forEach(function (falha) {
                lista.appendChild(
                    elemento(
                        'div',
                        null,
                        (falha.linha !== null && falha.linha !== undefined
                            ? 'Linha ' + (falha.linha + 1) + ': '
                            : '') + falha.motivo
                    )
                );
            });
            falhas.appendChild(lista);
            area.appendChild(falhas);
        }

        if (loteDesfazivel) {
            area.appendChild(
                elemento(
                    'p',
                    null,
                    'Você pode desfazer esta importação por 24 horas. Desfazer remove apenas o que este lote criou — alunos que já existiam antes são preservados.'
                )
            );
            area.lastChild.style.color = '#94a3b8';
            area.lastChild.style.fontSize = '0.82rem';
        }
    }

    async function desfazerImportacao() {
        if (!loteDesfazivel || enviando) return;

        var botao = $('btnDesfazerImportacao');
        enviando = true;
        botao.disabled = true;
        try {
            var resultado = await chamarApi(
                '/secretaria/turmas/' +
                    encodeURIComponent(turmaId) +
                    '/alunos/importar/' +
                    encodeURIComponent(loteDesfazivel) +
                    '/desfazer',
                { method: 'POST', headers: window.csrfHeaders(true), body: JSON.stringify({}) }
            );
            toast(
                resultado.alunosRemovidos +
                    ' aluno(s) e ' +
                    resultado.matriculasRemovidas +
                    ' matrícula(s) removidos. ' +
                    resultado.alunosPreservados +
                    ' preservado(s).',
                'ok'
            );
            loteDesfazivel = null;
            fecharModal('modalImportar');
            limpar($('avisoDesfazer'));
            await carregarTurma();
        } catch (erro) {
            toast(erro.message, 'erro');
        } finally {
            enviando = false;
            botao.disabled = false;
        }
    }

    async function cancelarPreview() {
        if (!importacaoAtual || loteDesfazivel) return;
        try {
            await chamarApi(
                '/secretaria/turmas/' +
                    encodeURIComponent(turmaId) +
                    '/alunos/importar/' +
                    encodeURIComponent(importacaoAtual.importacaoId) +
                    '/cancelar',
                { method: 'POST', headers: window.csrfHeaders(true), body: JSON.stringify({}) }
            );
        } catch {
            /* cancelar é best-effort; o TTL de 2 h limpa de qualquer forma */
        }
        importacaoAtual = null;
    }

    /** Após um F5, reoferece o botão de desfazer se o lote ainda estiver na janela. */
    async function carregarHistoricoImportacoes() {
        try {
            var dados = await chamarApi(
                '/secretaria/turmas/' + encodeURIComponent(turmaId) + '/alunos/importar/historico'
            );
            var desfazivel = (dados.lotes || []).find(function (lote) {
                return lote.podeDesfazer;
            });
            if (!desfazivel) return;

            loteDesfazivel = desfazivel.importacaoId;
            var area = $('avisoDesfazer');
            limpar(area);
            var caixa = elemento('div', 'alerta alerta-atencao');
            caixa.appendChild(elemento('i', 'bi bi-clock-history'));
            caixa.appendChild(
                elemento(
                    'span',
                    null,
                    'Importação de "' +
                        desfazivel.nomeArquivo +
                        '" concluída (' +
                        (desfazivel.resultado ? desfazivel.resultado.criados + ' criados' : '') +
                        '). Ainda dá para desfazer.'
                )
            );
            var botao = elemento('button', 'sec-btn sec-btn-outline', 'Desfazer');
            botao.type = 'button';
            botao.id = 'btnDesfazerBanner';
            botao.style.marginInlineStart = 'auto';
            caixa.appendChild(botao);
            area.appendChild(caixa);
        } catch {
            /* histórico é informativo; falha aqui não quebra a tela */
        }
    }

    function instalarImportacao() {
        var dropzone = $('dropzone');
        var input = $('inputArquivo');

        dropzone.addEventListener('click', function () {
            input.click();
        });
        dropzone.addEventListener('keydown', function (evento) {
            if (evento.key === 'Enter' || evento.key === ' ') {
                evento.preventDefault();
                input.click();
            }
        });
        dropzone.addEventListener('dragover', function (evento) {
            evento.preventDefault();
            dropzone.classList.add('arrastando');
        });
        dropzone.addEventListener('dragleave', function () {
            dropzone.classList.remove('arrastando');
        });
        dropzone.addEventListener('drop', function (evento) {
            evento.preventDefault();
            dropzone.classList.remove('arrastando');
            if (evento.dataTransfer.files.length) processarArquivo(evento.dataTransfer.files[0]);
        });
        input.addEventListener('change', function () {
            if (input.files.length) processarArquivo(input.files[0]);
        });

        $('btnModeloCsv').addEventListener('click', baixarModeloCsv);
        $('btnConfirmarImportacao').addEventListener('click', confirmarImportacao);
        $('btnDesfazerImportacao').addEventListener('click', desfazerImportacao);

        $('marcarTodos').addEventListener('change', function (evento) {
            var caixas = document.querySelectorAll(
                '#corpoPreview input[data-indice]:not([disabled])'
            );
            Array.prototype.forEach.call(caixas, function (caixa) {
                caixa.checked = evento.target.checked;
            });
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Seleção de turma (quando a URL não traz ?turmaId=)
    // ═════════════════════════════════════════════════════════════════════════

    async function mostrarSelecaoDeTurma() {
        $('areaAlunos').hidden = true;
        $('btnAbrirAdicionar').hidden = true;
        $('btnAbrirImportar').hidden = true;
        $('tituloTurma').textContent = 'Alunos por turma';

        var area = $('areaSelecaoTurma');
        area.hidden = false;
        var grade = $('gradeTurmas');

        try {
            var turmas = await chamarApi('/secretaria/turmas');
            limpar(grade);

            if (!turmas.length) {
                grade.appendChild(
                    elemento('p', 'estado-vazio', 'Nenhuma turma ativa cadastrada nesta escola.')
                );
                return;
            }

            turmas.forEach(function (turma) {
                var link = elemento('a', 'sec-btn sec-btn-outline');
                link.href = 'turma-alunos.html?turmaId=' + encodeURIComponent(turma._id);
                link.style.textDecoration = 'none';
                link.style.justifyContent = 'space-between';
                link.appendChild(elemento('span', null, turma.nome || turma.id || 'Turma'));
                link.appendChild(
                    elemento('span', 'chip chip-cinza', (turma.totalAlunos || 0) + ' alunos')
                );
                grade.appendChild(link);
            });
        } catch (erro) {
            limpar(grade);
            grade.appendChild(elemento('p', 'estado-vazio', erro.message));
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Inicialização
    // ═════════════════════════════════════════════════════════════════════════

    document.addEventListener('DOMContentLoaded', function () {
        // Sem turma na URL a tela vira um seletor, em vez de um beco sem saída.
        if (!turmaId) {
            mostrarSelecaoDeTurma();
            return;
        }

        montarSelects();
        instalarAcessibilidadeDeModal();
        instalarAutocomplete();
        instalarImportacao();

        $('btnAbrirAdicionar').addEventListener('click', function () {
            limparFormulario();
            $('campoSerie').value = ($('tituloTurma').textContent.match(/\d+/) || [''])[0];
            abrirModal('modalAdicionar');
        });

        $('btnAbrirImportar').addEventListener('click', function () {
            importacaoAtual = null;
            irParaPasso(1);
            abrirModal('modalImportar');
        });

        $('formAluno').addEventListener('submit', salvarAluno);

        $('campoDeficiencia').addEventListener('change', function (evento) {
            $('areaTranstornos').hidden = !evento.target.checked;
        });

        // Máscaras: reescrevem o próprio campo, sem animação (digitação é a
        // interação de maior frequência que existe).
        $('campoRa').addEventListener('input', function (evento) {
            evento.target.value = mascararRa(evento.target.value);
        });
        $('campoNascimento').addEventListener('input', function (evento) {
            evento.target.value = mascararData(evento.target.value);
        });
        $('campoDigito').addEventListener('input', function (evento) {
            evento.target.value = evento.target.value
                .toUpperCase()
                .replace(/[^0-9X]/g, '')
                .slice(0, 1);
        });
        $('campoChamada').addEventListener('input', function (evento) {
            evento.target.value = evento.target.value.replace(/\D/g, '').slice(0, 3);
        });

        // Delegação: cobre botões criados dinamicamente sem handler inline
        // (`onclick=` no HTML depende de `script-src-attr: unsafe-inline`, que
        // é dívida legada da CSP — código novo não aumenta essa superfície).
        document.addEventListener('click', function (evento) {
            var remover = evento.target.closest('[data-remover]');
            if (remover) return removerAluno(remover.getAttribute('data-remover'), remover);

            if (evento.target.closest('#btnLimparSelecao')) {
                limparFormulario();
                $('buscaAluno').focus();
                return;
            }
            if (evento.target.closest('#btnDesfazerBanner')) {
                desfazerImportacao();
                return;
            }
            if (evento.target.closest('#btnCancelarImportacao') && !loteDesfazivel)
                cancelarPreview();
        });

        carregarTurma();
        carregarHistoricoImportacoes();
    });
})();
