# Direitos autorais — identificação e bloqueio de imagem e áudio

Issue #509. Código em [`backend/src/services/direitosAutorais/`](../backend/src/services/direitosAutorais/).

A escola responde pelo que circula nos canais dela. Foto de banco de imagens, música comercial e
ilustração de livro didático entram por foto de perfil, anexo do chat e mensagem de voz sem que
ninguém perceba. Esta ferramenta faz duas coisas: **recusa o arquivo no upload** e
**bloqueia um arquivo específico já armazenado**.

## Como um arquivo é identificado

| Impressão | Mídia | O que pega |
|---|---|---|
| `sha256` | imagem e áudio | a cópia idêntica, byte a byte |
| `conteudoHash` | áudio | o mesmo MP3 com título/artista trocados (SHA-256 sem as etiquetas ID3) |
| `phash` (dHash 64 bits) | imagem | a mesma imagem redimensionada, recomprimida ou convertida para WebP — até 10 bits de diferença |

Além do catálogo, o próprio arquivo pode declarar o titular. É recusado o arquivo com:

- **imagem**: EXIF `Copyright`, XMP `dc:rights` ou `xmpRights:Marked="True"`, IPTC `CopyrightNotice`;
- **áudio**: ID3 `TCOP`/`WCOP`, comentário Vorbis/Opus `COPYRIGHT=`, chunk `ICOP` do WAV, átomo `cprt` do M4A.

Quando quem envia **é** o titular (a professora que assina as próprias fotos), a direção cadastra
o arquivo com `acao=liberar` e o aviso embutido deixa de bloquear. A liberação nunca vence um
bloqueio explícito do catálogo.

## Onde o bloqueio atua

| Ponto | Rota | Resposta |
|---|---|---|
| Upload | `POST /api/upload/photo`, `/api/upload/documento`, `/api/chat-direto/upload`, `/api/audio/upload` | **451** + `codigo: DIREITOS_AUTORAIS` |
| Download | `GET /api/upload/photo/:id`, `/api/upload/documento/:id`, `/api/chat-direto/anexo/:id`, `/api/files/:id`, `/api/audio/:id` | **451** para o arquivo marcado |

451 é *Unavailable For Legal Reasons* (RFC 7725). O upload guarda a impressão do arquivo
**original** em `metadata.impressao`: a foto de perfil vira WebP, e sem isso o reenvio do mesmo
JPEG nunca bateria com o arquivo guardado.

Se a análise falhar (catálogo fora do ar), o upload segue e o erro vai ao hub de observabilidade.
É política de conteúdo, não barreira de segurança; o arquivo ainda pode ser bloqueado pelo id.

## API da direção

Montada em `/api/direitos-autorais`, com `authJWT` + `filtrarPorEscola` + `authorize('diretor')`.
A direção atua na própria escola; o admin atua na rede toda.

| Método | Rota | Faz |
|---|---|---|
| `GET` | `/obras` | lista o catálogo (bloqueios e liberações) |
| `POST` | `/obras` | multipart `arquivo` + `titulo`, `titular`, `motivo`, `acao` (`bloquear` padrão, ou `liberar`) |
| `POST` | `/arquivos/:id/bloquear` | bloqueia aquele arquivo do bucket `uploads` e cataloga a impressão dele; cópias já armazenadas também são marcadas |
| `DELETE` | `/obras/:id` | desativa a obra e devolve o acesso aos arquivos que ela bloqueou |

Arquivo de outra escola responde 404, igual a inexistente. Toda ação vai ao `AuditLog`
(`CADASTRAR_OBRA_PROTEGIDA`, `LIBERAR_OBRA_DIREITO_AUTORAL`, `BLOQUEAR_ARQUIVO_DIREITO_AUTORAL`,
`REMOVER_OBRA_PROTEGIDA`). O catálogo guarda só a impressão digital, nunca os bytes da obra.

## Limites conhecidos

- Não há impressão **acústica** (Chromaprint): a mesma música regravada, cortada ou reencodada
  em outro formato não é reconhecida pelo catálogo. Exigiria binário nativo e decodificar o áudio
  no caminho do upload.
- Vídeo não é analisado.
- Metadado pode ser apagado por quem envia; o aviso embutido pega o descuido, não a má-fé.
- Ainda não há tela: a direção usa a API. A tela é o próximo passo.
