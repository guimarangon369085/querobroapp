# QUEROBROApp Brandbook (v1)

## Direcao criativa

Sistema visual inspirado em texturas e cores de producao artesanal premium:

- **Goiabada intensa** (vermelho profundo) para energia e pontos de decisao.
- **Crosta assada** (laranja dourado) para calor humano e autenticidade.
- **Creme/farinha** (off-white quente) para respiro e sofisticacao.
- **Verde menta suave** para equilibrar e reforcar frescor.

## Paleta principal

| Token          | Hex       | Uso                                     |
| -------------- | --------- | --------------------------------------- |
| `--tomato-700` | `#A0141A` | estados de alta enfase, contraste alto  |
| `--tomato-500` | `#C9242F` | CTA principal, elementos ativos         |
| `--crust-500`  | `#C9712F` | gradientes quentes, destaque secundario |
| `--crust-400`  | `#DE8E44` | hover e acentos de apoio                |
| `--mint-500`   | `#8FB098` | equilibrio visual e blocos informativos |
| `--bg-base`    | `#F8F3EA` | fundo global                            |
| `--cream-300`  | `#F8E9D8` | chips, areas de contexto                |
| `--ink-strong` | `#2A1D14` | tipografia principal                    |
| `--ink-muted`  | `#715848` | tipografia secundaria                   |

## Linguagem de layout

- **Soft-edge high-end**: cantos amplos (14px-28px), sombra difusa e blur leve.
- **Glass warm**: paineis semi-opacos com fundo quente para profundidade.
- **Hierarquia clara**: chips e kicker para orientar rapidamente contexto/tarefa.
- **Navegacao ativa explicita**: item ativo com gradiente da marca e alto contraste.

## UX e acessibilidade

- Estados focados com outline consistente em tom de marca.
- Contraste reforcado em textos principais e CTAs.
- Hover com microanimacao suave para feedback imediato.

## Aplicacao no produto web

- Tema global implementado em `src/app/globals.css`.
- Sidebar, topbar e cards com nova linguagem visual.
- Home ajustada para comunicar o posicionamento e facilitar descoberta de modulos.
