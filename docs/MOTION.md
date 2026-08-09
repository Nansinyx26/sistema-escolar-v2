# Motion, Skeleton e Lazy Loading

Sistema de interface do Sistema Escolar v2, baseado na skill
[`design-motion-principles`](../.claude/skills/design-motion-principles/SKILL.md)
(de [kylezantos/design-motion-principles](https://github.com/kylezantos/design-motion-principles)).

Arquivos: [`css/motion.css`](../css/motion.css) · [`js/motion.js`](../js/motion.js)

---

## O weighting deste projeto

> **Emil Kowalski (primário) · Jakub Krehel (secundário)** · Jhey Tompkins (só em estado vazio)

A skill classifica contextos e pondera os designers conforme o tipo de produto. Este é um
**SaaS administrativo de uso diário e repetitivo** — a secretaria lança dezenas de faltas por
turno, o professor abre a mesma turma cinco vezes ao dia. Pela tabela da skill, SaaS dashboard
mapeia para Emil como primário.

Na prática isso significa:

- **Restrição e velocidade acima de expressividade.** 180ms é a duração ideal, não 500ms.
- **A melhor animação é a que passa despercebida.** Se o usuário comenta "que animação legal"
  toda vez que salva uma nota, ela está alta demais.
- **Estado vazio é a exceção.** Frequência rara, então cabe personalidade (Jhey).

### A regra da frequência

Antes de animar qualquer coisa, pergunte com que frequência o usuário dispara aquilo:

| Frequência | O que fazer |
|------------|-------------|
| Rara (mensal) — onboarding, primeiro acesso, estado vazio | Movimento expressivo é bem-vindo |
| Ocasional (diária) — abrir modal, trocar de aba | Movimento sutil e rápido |
| Frequente (centenas por dia) — salvar, digitar, marcar presença | **Instantâneo, sem animação** |
| Iniciada por teclado — atalho, Tab, Enter | **Nunca animar** |

---

## Regras não negociáveis

1. Todo estado de carregamento usa **skeleton** — nunca spinner solto, nunca tela em branco
2. Imagem abaixo da dobra: `loading="lazy"` + `decoding="async"`
3. Entrada = `opacity` + `translateY(8px)` + `blur(4px)`
4. **Saída sempre mais sutil que a entrada** (`translateY(-4px)`, `blur(2px)`)
5. Só se anima `transform`, `opacity`, `filter`, `clip-path` — nunca `width`/`height`/`top`/`left`
6. Nada de `ease` ou `ease-in-out` puros — sempre um token de curva
7. **Todo** movimento respeita `prefers-reduced-motion`
8. Nada de movimento em loop pedindo atenção (pulsar, brilhar, respirar)

---

## Como usar

O sistema é carregado automaticamente em todas as páginas
(`scripts/inject-motion.js` já injetou `<link>` e `<script>`), e no portal React via
`import` em `src/main.tsx`. Não precisa fazer setup por página.

### Entrada ao entrar na tela

```html
<div data-reveal>Aparece com fade + slide + blur quando entra na viewport</div>

<!-- Escalonado: cada filho entra 40ms depois do anterior, com teto de 8 passos -->
<ul data-reveal-stagger>
  <li>Aluno 1</li>
  <li>Aluno 2</li>
</ul>
```

### Skeleton durante o carregamento

```js
const lista = document.querySelector('#lista-alunos');

Motion.skeleton(lista, { preset: 'list', count: 6 });

const alunos = await fetch('/api/alunos').then(r => r.json());

Motion.ready(lista, alunos.map(renderAluno).join(''));
```

Presets: `text` · `card` · `list` · `table` · `media`.

`Motion.ready()` já reaplica lazy loading e entrada ao conteúdo novo.

Em markup estático dá para usar as formas diretamente:

```html
<div class="skeleton skeleton-heading"></div>
<div class="skeleton skeleton-line"></div>
<div class="skeleton skeleton-circle"></div>
```

### Botão em envio

```js
Motion.busy(botao, true);
await salvarNota();
Motion.busy(botao, false);
```

Trava o botão (evita duplo envio), troca o rótulo por spinner e restaura no fim.
O texto de espera é configurável com `data-busy-label`.

### Progresso

A barra do topo é automática: `js/motion.js` intercepta `fetch()` e a navegação por link.
Só aparece se a operação passar de **180ms** — piscar em toda requisição rápida seria ruído.

Para deixar uma requisição fora dela (polling, heartbeat, telemetria):

```js
fetch(url, { headers: { 'X-Motion-Silent': '1' } });
```

Progresso determinado (upload, importação de alunos):

```html
<div class="motion-progress-bar" role="progressbar"><i></i></div>
```
```js
Motion.progress.set(barra, 0.42);   // 0 a 1
```

### Modal, dropdown e tooltip

```html
<div data-motion="modal" data-state="closed">…</div>
```
```js
Motion.surface(modal, true, botaoQueAbriu);
```

Passar o gatilho faz a superfície nascer **de onde foi aberta**, não do centro da tela.

### Lazy loading

Automático. `scripts/inject-motion.js` escreve os atributos no HTML e `js/motion.js`
refina em runtime medindo a posição real — respeitando sempre o que já está no HTML.

As duas primeiras imagens de cada página ficam `loading="eager"` + `fetchpriority="high"`,
porque atrasar a imagem de topo pioraria o LCP.

---

## Acessibilidade

`prefers-reduced-motion: reduce` desliga o movimento **preservando o estado final** — nada
some da tela. Além disso:

- Conteúdo com `data-reveal` fica visível imediatamente
- O brilho do skeleton para (o loop é justamente o que incomoda), mas o placeholder continua
- O spinner vira um anel estático
- Skeleton usa `aria-busy` e `aria-hidden` para não ser lido como conteúdo real

O usuário também pode desligar pelo próprio sistema:

```js
Motion.setEnabled(false);   // persiste em localStorage
```

Ao imprimir (boletim, ata) o movimento e os skeletons são removidos.

---

## Manutenção

- Tokens de curva vivem em `css/variables.css` e `css/easings.css` — `motion.css` os
  reaproveita e só declara fallback para páginas que não carregam o design system completo
- Reaplicar em páginas novas: `node scripts/inject-motion.js` (idempotente)
- Conferir o que mudaria antes: `node scripts/inject-motion.js --dry-run`

### Auditar o motion existente

A skill tem um modo de auditoria que gera relatório HTML com demos:

```
Use a skill design-motion-principles em modo Audit sobre css/motion.css
```
