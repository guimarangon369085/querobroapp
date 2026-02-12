# iOS Atalhos - Cupom para Estoque (automatico)

## Objetivo

Ao aproximar o NFC:

1. tirar foto do cupom,
2. extrair somente itens oficiais de producao,
3. lancar automaticamente no estoque do app,
4. mostrar notificacao de resultado no iPhone.

Sem copiar/colar.

## Endpoints

- `POST /receipts/ingest`
  - retorna JSON completo (`items`, `ingest.appliedCount`, `ingest.ignoredCount`).
- `POST /receipts/ingest-notification`
  - faz a mesma ingestao, mas retorna `text/plain` pronto para notificacao.
  - exemplo de resposta: `Itens lancados: 3 | Ignorados: 1`

Base URL local (exemplo):

- `http://SEU_MAC_IP:3001/receipts`

Descobrir IP e URLs no Mac:

```bash
./scripts/shortcut-receipts-setup.sh
```

## Atalho recomendado (mais simples e robusto)

Interface do app Atalhos em portugues:

1. `Tirar Foto` (camera traseira)
2. `Converter Imagem`
   - Formato: `JPEG`
3. `Codificar em Base64`
   - **Quebras de Linha: `Nenhuma`** (obrigatorio)
4. `Dicionario`
   - `imageBase64`: variavel da acao Base64
   - `mimeType`: texto fixo `image/jpeg`
5. `Obter conteudo de URL`
   - URL: `http://SEU_MAC_IP:3001/receipts/ingest-notification`
   - Metodo: `POST`
   - Pedir Corpo: `JSON`
   - Corpo: `Dicionario`
   - Cabecalho opcional: `x-receipts-token` (somente se definido na API)
6. `Mostrar notificacao`
   - Titulo: `Cupom processado`
   - Texto: variavel **`Conteudos do URL`** (nao digitar texto manual)

## Atalho avancado (se quiser JSON detalhado)

Troque a URL da etapa 5 para:

- `http://SEU_MAC_IP:3001/receipts/ingest`

Depois:

1. `Obter valor do dicionario` -> chave `ingest`
2. `Obter valor do dicionario` -> chave `appliedCount`
3. `Mostrar notificacao` -> texto com a variavel `appliedCount`

Importante:

- nao escreva `[Resultado]` como texto fixo,
- selecione sempre a variavel azul na barra de variaveis do Atalhos.

## Area editavel no app (mapeamento)

No Builder:

- `http://127.0.0.1:3000/builder`
- bloco `Integracoes e automacao`
- secao `Regras de itens de producao (editavel)`

Voce pode ajustar por item oficial:

- habilitado/desabilitado,
- nome do item de estoque de destino,
- multiplicador de quantidade.

## Como verificar se entrou no estoque

No app web:

- `http://127.0.0.1:3000/estoque`
- secao `Movimentacoes`
- card `Entradas automaticas por cupom`

Esse card mostra total aplicado e ultimas entradas automaticas.

## Erros comuns

- `OPENAI_API_KEY nao configurada`:
  - preencher em `apps/api/.env` e reiniciar API.
- `image_parse_error`:
  - usar `Converter Imagem -> JPEG`,
  - em `Codificar em Base64`, usar `Quebras de Linha: Nenhuma`.
- `localhost` no iPhone nao funciona:
  - usar o IP local do Mac (`192.168.x.x`).
- retorno 400 com token:
  - conferir `x-receipts-token` igual ao `RECEIPTS_API_TOKEN`.
