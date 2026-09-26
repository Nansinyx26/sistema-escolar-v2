# Logo do Sistema Escolar

A logo é do **sistema**, não de uma escola: a plataforma atende várias escolas,
então nem o desenho nem o nome dos arquivos citam uma escola específica.

## Em uso

<img src="../../img/logo.svg" alt="Logo do Sistema Escolar" width="160">

**Livro e rio** — um livro aberto do qual nasce um rio: o conhecimento que flui.
Escolhida na Issue #460 e aplicada na Issue #461.

| Arquivo | Uso |
|---|---|
| `img/logo.svg` | Fonte canônica. Splash, login, landing e favicon |
| `img/logo.png` | 512×512, render do SVG. Entrada do `scripts/generate-pwa-icons.py` |
| `img/icons/*.png` | Ícones do PWA, gerados pelo script acima |
| `favicon/`, `favicon.svg` | Favicon |

Para trocar a logo: edite `img/logo.svg`, gere `img/logo.png` (512×512, fundo
transparente), rode `python scripts/generate-pwa-icons.py`, copie
`img/icons/icon-512.png` para `portal-responsavel/public/icon-512.png` e suba o
`VERSION` do `service-worker.js`.

## Propostas avaliadas

Ficam aqui como histórico da escolha. Não são servidas pelo site.

### Primeira rodada

| | | | |
|:-:|:-:|:-:|:-:|
| <img src="propostas/01-cubo-capelo.svg" width="96"><br>01 · Cubo com capelo | <img src="propostas/02-monograma-s.svg" width="96"><br>02 · Monograma S | <img src="propostas/03-escolas-em-rede.svg" width="96"><br>03 · Escolas em rede | <img src="propostas/04-livro-progresso.svg" width="96"><br>04 · Livro e progresso |
| <img src="propostas/05-brasao.svg" width="96"><br>05 · Brasão | <img src="propostas/06-blocos-s.svg" width="96"><br>06 · S em blocos | <img src="propostas/07-selo.svg" width="96"><br>07 · Selo | |

### Variações de Livro e rio

| | | | |
|:-:|:-:|:-:|:-:|
| <img src="propostas/livro-rio/l1-original.svg" width="96"><br>**L1 · Original (escolhida)** | <img src="propostas/livro-rio/l2-gradiente.svg" width="96"><br>L2 · Sobre gradiente | <img src="propostas/livro-rio/l3-nascente.svg" width="96"><br>L3 · Nascente | <img src="propostas/livro-rio/l4-amanhecer.svg" width="96"><br>L4 · Amanhecer |
| <img src="propostas/livro-rio/l5-paginas-de-agua.svg" width="96"><br>L5 · Páginas de água | <img src="propostas/livro-rio/l6-traco.svg" width="96"><br>L6 · Traço | <img src="propostas/livro-rio/l7-selo.svg" width="96"><br>L7 · Selo | |

### Variações de Escolas em rede

| | | | |
|:-:|:-:|:-:|:-:|
| <img src="propostas/rede/r1-seis-escolas.svg" width="96"><br>R1 · Seis escolas | <img src="propostas/rede/r2-escola-de-conexoes.svg" width="96"><br>R2 · Escola de conexões | <img src="propostas/rede/r3-orbita.svg" width="96"><br>R3 · Órbita | <img src="propostas/rede/r4-capelo-nucleo.svg" width="96"><br>R4 · Capelo no centro |
| <img src="propostas/rede/r5-traco.svg" width="96"><br>R5 · Traço | <img src="propostas/rede/r6-crescimento.svg" width="96"><br>R6 · Rede em crescimento | <img src="propostas/rede/r7-gradiente.svg" width="96"><br>R7 · Sobre gradiente | |
