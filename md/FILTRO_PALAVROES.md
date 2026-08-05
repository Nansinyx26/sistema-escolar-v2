# Filtro de linguagem imprópria

Impede que comentários, conversas, comunicados e avaliações com palavrão sejam
enviados — inclusive quando o usuário troca letras por números/símbolos para
driblar a detecção.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `js/filtro-palavroes.js` | **Motor e dicionário.** Único arquivo com o léxico. É isomórfico (UMD): roda no navegador e no Node. |
| `backend/src/utils/filtroPalavroes.js` | Ponte do backend — reexporta o motor acima e lê a configuração do ambiente. |
| `backend/src/middleware/bloquearPalavroes.js` | Middleware de rota. **É ele que efetivamente bloqueia.** |
| `js/filtro-palavroes-ui.js` | Aviso visual e trava do botão no navegador. |
| `backend/src/tests/filtroPalavroes.test.js` | 98 testes: disfarces que devem cair e frases da escola que não podem ser barradas. |

O dicionário existe em **um lugar só**, de propósito. Duplicá-lo garantiria,
mais cedo ou mais tarde, um front que avisa sobre uma palavra que o back aceita
— ou o contrário, que é pior: o aviso não aparece e o texto entra no banco.

## O que é detectado

Todas as formas abaixo caem no mesmo termo:

```
caralho    c4ralho    c@r@lh0    cara1ho    CARALHO    cárálhõ
caaaaralho    carrralho
c.a.r.a.l.h.o    c-a-r-a-l-h-o    c_a_r_a_l_h_o
c a r a l h o    c   a   r   a   l   h   o
```

E também expressões espaçadas (`vai tomar no cu`, `filho da puta`) e
abreviações (`fdp`, `pqp`, `vtnc`, `vsf`, `krl`, `wtf`).

### Como

Cada termo do léxico é compilado uma vez para uma regex tolerante:

1. cada letra vira uma classe com seus equivalentes visuais
   (`a` → `[a4@áàâãäª]`, `i` → `[i1!íìîï|y]`, `s` → `[sz5$§]`, `o` → `[o0óòôõö°]`…);
2. cada classe ganha `+`, o que cobre letra repetida;
3. entre as letras é aceito um punhado de separadores (espaço, ponto, hífen…);
4. o casamento exige **fronteira de palavra** dos dois lados — é isso que
   impede `cu` de disparar em "cuidado" e `puta` em "disputa";
5. uma segunda varredura junta sequências de letras isoladas, para o caso do
   espaçamento passar do teto de separadores.

O texto **não** é normalizado antes (nada de "trocar todo `4` por `a`"): isso
destruiria os índices usados para grifar o trecho e transformaria
"10 alunos" em "lo alunos", com falso-positivo em cima de número legítimo.

A classe de separadores é calculada por diferença — nenhum caractere que serve
de equivalente de letra pode ser separador. Classes disjuntas mantêm a regex
livre do backtracking exponencial (ReDoS) que um `+` seguido de grupo opcional
ambíguo provocaria. Há teste de desempenho cobrindo isso.

## Termos que dependem de contexto

Sete palavras não são palavrão sozinhas — e o uso legítimo delas é justamente
o escolar:

| Termo | Uso legítimo na escola |
| --- | --- |
| `pica` | "o mosquito pica", "pica o alho", pica-pau |
| `rola` | "a bola rola", "rola uma conversa", rola (a ave) |
| `pau` | "cadeira de pau", pau-brasil (história e biologia) |
| `pinto` | filhote de galinha — e **Pinto é sobrenome comuníssimo** |
| `macaco` | aula de fauna, visita ao zoológico, macaco do carro |
| `piranha` | fauna amazônica, presilha de cabelo |
| `droga` | "palestra sobre drogas", campanha de prevenção |

Bloquear na marra derrubaria o comunicado da campanha antidrogas e o trabalho
sobre primatas. Elas só disparam com o **marcador** que as transforma em
xingamento:

```
seu macaco    sua piranha    bando de macacos    seu jegue     ← bloqueia
meu pau       sua pica       minha rola          meu pinto     ← bloqueia
que droga                                                      ← avisa (leve)

o macaco do zoológico    a piranha do rio    palestra sobre drogas   ← passa
o pica-pau    o mosquito pica    a bola rola    cadeira de pau       ← passa
```

O marcador aceita as mesmas trocas de caractere do termo, então `s3u m4c4c0`,
`seu.macaco` e `seu   macaco` também caem.

> **`pinto` não aceita `seu`.** Em português "seu + sobrenome" é tratamento
> respeitoso, e Pinto é um dos sobrenomes mais comuns do Brasil — "Seu Pinto
> chegou na secretaria" não pode virar palavrão. Os marcadores dele são só
> `meu`/`teu`.

Para criar um termo contextual novo, use a opção `contexto`:

```js
['macaco', 'grave', 'discriminatorio', { contexto: VOCATIVO }]
```

Termos contextuais ficam de fora da varredura aglutinada: colar letras isoladas
apagaria justamente o marcador que dá sentido ao termo.

## Níveis

| Nível | Exemplos | Comportamento padrão |
| --- | --- | --- |
| `grave` | vulgar, sexual, discriminatório | **bloqueia** |
| `moderado` | xingamento (merda, idiota, otário) | **bloqueia** |
| `leve` | burro, palhaço, porcaria | só avisa |

## Rotas protegidas

| Rota | Campos |
| --- | --- |
| `POST /api/comentarios` e `PUT /api/comentarios/:id` | `texto` |
| `POST /api/comunicados` | `titulo`, `conteudo` |
| `POST /api/comunicados/:id/comentarios` (legado) | `texto` |
| `POST /api/chat-direto/enviar` | `mensagem` |
| `POST /api/reviews` | `comment` |
| `POST /api/avaliacoes` | `texto` |

Para proteger uma rota nova:

```js
const bloquearPalavroes = require('../middleware/bloquearPalavroes');

router.post('/', authJWT, bloquearPalavroes('mensagem', { recurso: 'meu-recurso' }), Controller.criar);
```

Campo ausente ou vazio é ignorado (comentário só de áudio, edição parcial).

### Resposta ao bloquear — HTTP 400

```json
{
  "success": false,
  "codigo": "CONTEUDO_IMPROPRIO",
  "error": "Sua mensagem contém uma palavra imprópria (xingamento) e não pode ser enviada. Reescreva sem ela.",
  "detalhes": { "campo": "texto", "nivel": "moderado", "termos": ["merda"], "trechos": ["m3rda"] }
}
```

O `error` já está pronto para exibir ao usuário. Os `trechos` são recortes do
próprio texto enviado — servem para o front grifar o que precisa sair.

## Frontend

Carregue os dois scripts **antes** da tela que tem campo de texto:

```html
<script defer src="../js/filtro-palavroes.js?v=1.0"></script>
<script defer src="../js/filtro-palavroes-ui.js?v=1.0"></script>
```

Já incluídos em `html/dashboard.html`, `html/perfil.html` e
`direcao/direcao-notificacoes.html`.

Campo declarativo:

```html
<textarea data-filtro-palavroes data-filtro-botao="#btnEnviar"></textarea>
```

Campo criado por JavaScript:

```js
window.FiltroPalavroesUI.proteger(campo, { botao: btnEnviar });

// e/ou, no momento do envio:
if (!window.FiltroPalavroesUI.validarAntesDeEnviar(texto, { campo })) return;
```

> A checagem do navegador é **só experiência de uso**. Quem chama a API pelo
> console, por `curl` ou por um app antigo não passa por ela — quem barra de
> verdade é o middleware.

## Configuração por ambiente

Todas opcionais (declaradas em `backend/src/config/env.js`):

| Variável | Efeito |
| --- | --- |
| `FILTRO_PALAVROES_NIVEIS` | Níveis que bloqueiam. Padrão `grave,moderado`. Para bloquear também os leves: `grave,moderado,leve`. |
| `FILTRO_PALAVROES_EXTRAS` | Palavras adicionais, separadas por vírgula. |
| `FILTRO_PALAVROES_EXCECOES` | Palavras a liberar, separadas por vírgula. |

Em tempo de execução:

```js
FiltroPalavroes.adicionarTermo(['jegue', 'leve', 'insulto']);
FiltroPalavroes.adicionarExcecao('veado');
```

## Falsos positivos conhecidos

Decisão consciente: `veado` (o animal), `bicha` (fila, em pt-PT), `escroto`
(termo anatômico) e `cacete` (pão / porrete) têm uso legítimo, mas o uso
ofensivo domina no contexto escolar. A escola que precisar liberar algum deles
usa `FILTRO_PALAVROES_EXCECOES`.

Os termos ambíguos (`pica`, `rola`, `pau`, `pinto`, `macaco`, `piranha`,
`droga`) não foram deixados de fora — entraram como **termos contextuais**,
que só disparam com o marcador de xingamento na frente. Ver a seção acima.

## Ao mexer no léxico

Rode a suíte — ela existe para pegar os dois erros opostos:

```bash
cd backend && npx jest src/tests/filtroPalavroes.test.js
```

Barrar mensagem legítima da escola é pior na prática do que deixar um palavrão
passar: a professora não consegue avisar sobre a reunião e ninguém entende o
porquê. Termo novo curto ou parecido com palavra comum? Acrescente a frase
legítima correspondente à lista de aceites do teste.
