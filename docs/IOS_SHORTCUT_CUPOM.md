# IOS_SHORTCUT_CUPOM

## Objetivo

Com um toque no iPhone:

1. tirar foto do cupom
2. enviar para API
3. atualizar estoque automaticamente
4. receber notificacao com resultado

## Modo sem token OpenAI (recomendado para cupom com codigo)

- Adicione no Atalhos a acao `Extrair texto da imagem` apos tirar a foto.
- Envie esse texto no campo `rawText` do JSON.
- A API tenta parser local primeiro (sem OpenAI). Se `rawText` estiver bom, nao usa token.
- Mesmo sem `rawText`, no macOS a API tenta OCR local da imagem antes do OpenAI.

## Endpoint recomendado

- `POST /receipts/ingest-notification`
- Resposta: texto pronto para notificacao (`Itens lancados: X | Ignorados: Y`)

## Novo endpoint para lote de cupons

- `POST /receipts/ingest-batch`
- Corpo esperado:
  - `items`: array com payloads de cupom (`imageBase64`/`imageUrl`, `mimeType`, `providerHint`, `sourceFriendly`)
  - `continueOnError` (opcional, default `true`)
- Uso recomendado: processar varios cupons no mesmo turno com resumo por item.

## Passo a passo no Atalhos (iOS)

1. `Tirar Foto`
2. `Converter Imagem` -> `JPEG`
3. `Codificar em Base64` -> `Quebras de Linha: Nenhuma`
4. `Dicionario`:
   - `imageBase64`: valor da imagem em base64
   - `mimeType`: `image/jpeg`
   - `rawText`: resultado da acao `Extrair texto da imagem` (opcional, porem recomendado)
5. `Obter conteudo de URL`:
   - URL: `http://SEU_MAC_IP:3001/receipts/ingest-notification`
   - Alternativa estavel: `http://SEU_HOST.local:3001/receipts/ingest-notification`
   - Importante: usar **porta 3001** (API). A porta 3000 e do web e costuma gerar timeout no Atalhos.
   - Metodo: `POST`
   - Corpo: `JSON` com o dicionario
   - Header recomendado: `idempotency-key` unico por cupom
   - Se auth ativa: adicionar `x-app-token`
6. `Mostrar notificacao` com o retorno da URL

## Como conferir no web

- Abrir `http://127.0.0.1:3000/estoque`
- Ver secao de movimentacoes
- Confirmar entrada automatica aplicada

## Erros comuns

- `localhost` no iPhone nao funciona -> use IP do Mac.
- Falha de parse -> confirme JPEG + base64 sem quebra de linha.
- Duplicidade -> verifique se `idempotency-key` esta variando por cupom.
