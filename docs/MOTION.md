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

## A esfera de voz (orb dos chatbots)

Motor: [`js/ia/AssistantSphere.js`](../js/ia/AssistantSphere.js) ·
Nível de voz: [`js/ia/NivelDeVoz.js`](../js/ia/NivelDeVoz.js)

Uma nuvem de ~3200 pontos deslocada por ruído 3D, em Canvas 2D. É a **mesma esfera
nos quatro perfis** — direção, professor, secretaria (via
[`js/voice-orb.js`](../js/voice-orb.js)) e responsável (via
`portal-responsavel/src/hooks/useEsferaDeVoz.ts`, que importa o mesmo módulo em
tempo de execução em vez de copiá-lo).

### Por que ela não é decoração

Pela regra da frequência, um laço de partículas permanente seria movimento
gratuito — e era o que o orb antigo fazia: cinco barras de equalizador tocando
uma coreografia fixa de 0,8s, igual para toda narração, sem nenhuma relação com
o que estava sendo dito.

A esfera é alimentada pelo **espectro real** do áudio do ElevenLabs. Ela se move
porque há voz ali; quando a voz para, ela assenta. O que ela comunica — "o
assistente está falando agora, e ainda está" — não existe em outro lugar da tela.

Daí as duas regras de uso:

- **Só existe enquanto há o que mostrar.** Nos painéis o orb monta ao pedir a
  resposta e desmonta depois dela. No portal, o `fab` (botão "ouvir", que fica
  na tela parado) só sobe a esfera quando há narração; ocioso, ele é estático.
- **Nada de pulso ambiente.** Não há respiração, brilho pulsante nem anel
  girando para "chamar atenção". Todo movimento sai do estado ou do áudio.

### Tempos

| Momento | Valor | Por quê |
|---------|-------|---------|
| Entrada (materialização) | 420ms, ease-out cúbico | Acima dos 300ms do Emil de propósito: é uma vez por resposta, não um controle de uso repetido. Parte de 0,88 do raio — nunca de zero |
| Saída | 220ms, opacidade + `scale(0.96)` | Metade da entrada. A atenção já foi para o texto da resposta |
| Acento na troca de estado | ~380ms de decaimento | Sem ele, "pensando" → "falando" não tinha instante: a esfera derivava e a troca não era legível |
| Resposta ao áudio | ataque 26/s, queda 8/s | Assimétrico. Simétrico, a esfera chegava atrasada em cada consoante e escorria depois dela |
| Troca de estado | 5/s | Igual ao que era a 60fps, agora em tempo real (veja abaixo) |

As constantes de suavização são **por segundo**, não por quadro. A forma antiga
(`valor += (alvo - valor) * 0.15` a cada quadro) amarrava a animação à taxa de
atualização da tela: em 0,25s ela percorria 49% do caminho a 30fps e 95% a
144fps — a mesma esfera com três personalidades, e nenhum usuário vendo mais de
uma. `1 - exp(-k * dt)` dá o mesmo decaimento com o relógio real.

### Brilho e densidade

A luz difusa (fundo, bloom, halo, núcleo e especular) é **pré-renderizada em
bitmap** e blitada por quadro. Antes eram `createRadialGradient` + `fillRect`
todo quadro, sobre quase todo o canvas — o item mais caro do desenho depois da
nuvem. A folga que a troca abriu foi gasta em luz: entraram o bloom largo e o
reflexo especular, que dão o brilho sem tocar na exposição da nuvem.

Brilho da nuvem e brilho difuso são botões **separados**, e é importante que
continuem sendo. A nuvem soma luz ('lighter'), então subir a exposição dela não
acende a esfera: estoura o centro em branco e apaga a textura de água que ela
existe para mostrar. Quando a contagem de pontos sobe, `EXPOSICAO` e o tamanho
do ponto descem junto — o que se mantém constante é a luz total, e o que se
ganha é grão.

A densidade (`devicePixelRatio`) é o **primeiro degrau a cair** quando o quadro
passa do orçamento de 11ms, antes de qualquer ponto ser descartado: perder
nitidez incomoda menos que perder a água. Ver `NIVEIS_QUALIDADE`.

### Movimento reduzido

`prefers-reduced-motion` congela a geometria e redesenha a ~10fps (só o brilho
respira devagar); entrada e acento não acontecem. Nos painéis a saída vira corte
seco em vez de transição. Isso vive dentro do próprio `AssistantSphere.js` — não
é uma regra de CSS por cima.

---

## A narração que acompanha o texto

Fila: [`js/ia/NarradorStream.js`](../js/ia/NarradorStream.js) ·
Corte em frases: [`js/ia/SegmentadorFala.js`](../js/ia/SegmentadorFala.js) ·
Marca na tela: [`js/ia/DestaqueNarracao.js`](../js/ia/DestaqueNarracao.js)

A narração é cortada em frases e sai **junto com o texto**: a voz começa depois
da primeira frase, não depois da resposta inteira. Enquanto um trecho toca, o
seguinte já está sendo sintetizado — sem isso a fala ganharia uma pausa audível
a cada frase, que é pior que a espera única de antes porque se repete.

**A frase sendo falada fica marcada na bolha, e a marca NÃO anima.** Ela troca a
cada poucos segundos durante a narração inteira: é o caso clássico da regra da
frequência — animar essa troca seria movimento de alta frequência competindo com
o texto que a pessoa está lendo. A marca é legenda, não efeito.

Ela também não usa `<span>`: a bolha é repintada a cada ~30ms enquanto a
resposta chega, e o elemento seria desfeito a cada repintura. Quem pinta é a
**CSS Custom Highlight API** (`::highlight(ia-narracao)`), que marca um `Range`
sem tocar no DOM. Onde a API não existe, nada é pintado e a narração segue
inteira — é enfeite útil, nunca requisito.

Como não há movimento nenhum, não há o que degradar em `prefers-reduced-motion`.

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
