# Brand Asset Pipeline

## Objetivo
Sincronizar referencias visuais da QueroBroa para uso no web app, sem depender de upload manual.

## Comando
```bash
pnpm brand:sync
```

## Origem padrao
`/Users/gui/Desktop/@QUEROBROAPP DOCS/QBAPP_MAGENS`

Tambem aceita origem custom:
```bash
bash scripts/sync-brand-assets.sh "/caminho/origem"
```

## Saida
`apps/web/public/querobroa/brand`

## O que o script faz
- Converte `IMG_09xx.HEIC` para JPG (`sips`, `magick` ou `convert`).
- Copia `IMG_1318.jpg`.
- Extrai fotos tratadas selecionadas de `FOTOS_QUEROBROA.zip`.
- Normaliza nomes com espaco para underscore.

## Observacao de versionamento
Arquivos de `apps/web/public/querobroa/brand` sao gerados localmente e ignorados no git.
