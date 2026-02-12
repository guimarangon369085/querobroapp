# iOS Shortcuts - Cupom Fiscal para Numbers

## Objetivo

Tirar foto do cupom fiscal no iPhone, enviar para a API, receber linhas no formato `;` e colar no Numbers.

Cada item retorna uma linha:

```txt
YYYY-MM-DD;ITEM_OFICIAL;QUANTIDADE;VALOR_UNITARIO
```

Exemplo:

```txt
2026-02-12;FARINHA DE TRIGO;1;7,99
2026-02-12;LEITE;2;5,49
```

## Endpoint da API

- `POST /receipts/parse`
- `POST /receipts/parse-clipboard` (retorna somente texto pronto para clipboard)
- URL local (exemplo): `http://SEU_MAC_IP:3001/receipts/parse`

Para descobrir rapidamente o IP/URL corretos no seu Mac:

```bash
./scripts/shortcut-receipts-setup.sh
```

Para testar localmente com uma imagem (antes do iPhone):

```bash
./scripts/test-receipt-image.sh /caminho/para/cupom.jpg
```

Request JSON:

```json
{
  "imageBase64": "....",
  "mimeType": "image/jpeg",
  "providerHint": "Pao de Acucar"
}
```

Header opcional de seguranca:

```txt
x-receipts-token: <RECEIPTS_API_TOKEN>
```

Se `RECEIPTS_API_TOKEN` estiver definido em `apps/api/.env`, esse header vira obrigatorio.

Response JSON (resumo):

```json
{
  "purchaseDate": "2026-02-12",
  "items": [
    { "item": "FARINHA DE TRIGO", "quantity": 1, "unitPrice": 7.99 }
  ],
  "lineCount": 1,
  "lines": ["2026-02-12;FARINHA DE TRIGO;1;7,99"],
  "clipboardText": "2026-02-12;FARINHA DE TRIGO;1;7,99"
}
```

## Itens oficiais aceitos

- FARINHA DE TRIGO
- FUBÁ DE CANJICA
- AÇÚCAR
- MANTEIGA
- LEITE
- OVOS
- GOIABADA
- DOCE DE LEITE
- QUEIJO DO SERRO
- REQUEIJÃO DE CORTE
- SACOLA
- CAIXA DE PLÁSTICO
- PAPEL MANTEIGA

Itens fora da lista sao ignorados.

## Atalho iOS recomendado (passo a passo)

1. Acao `Take Photo` (ou `Select Photos`).
2. Acao `Encode Media` em `Base64`.
3. Acao `Dictionary` com:
   - `imageBase64`: valor da acao anterior
   - `mimeType`: `image/jpeg`
   - `providerHint`: texto opcional (ex.: `Oba Hortifruti`)
4. Acao `Get Contents of URL`:
   - Method: `POST`
   - URL: `http://SEU_MAC_IP:3001/receipts/parse`
   - Request Body: `JSON`
   - Body: o Dictionary acima
   - Header: `Content-Type: application/json`
5. Acao `Get Dictionary Value` -> chave `clipboardText`.
6. Acao `Copy to Clipboard`.
7. Acao `Open App` -> Numbers.
8. Acao `Show Notification` (ex.: `Cupom processado e copiado`).

## Fluxo ainda mais simples (recomendado)

Use o endpoint `POST /receipts/parse-clipboard`:

1. `Take Photo`
2. `Encode Media` (Base64)
3. `Dictionary` (`imageBase64`, `mimeType`, `providerHint`)
4. `Get Contents of URL` -> `POST /receipts/parse-clipboard`
5. `Copy to Clipboard` (resultado inteiro da resposta)
6. `Open App` -> Numbers
7. `Show Notification`

## Observacoes importantes

- iPhone e Mac precisam estar na mesma rede local.
- Nao use `localhost` no iPhone; use IP do Mac (ex.: `192.168.1.20`).
- A API precisa ter `OPENAI_API_KEY` configurada em `apps/api/.env`.
- Se usar token, configurar `RECEIPTS_API_TOKEN` e enviar `x-receipts-token` no Atalho.
