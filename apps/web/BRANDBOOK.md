# QUEROBROApp Brandbook (v2)

## Contexto da revisao

Este brandbook foi atualizado com analise dos elementos visuais disponiveis localmente no app (galeria `public/querobroa`). Nao foi possivel acessar drive externo nesta execucao, entao a direcao foi consolidada a partir dos assets embarcados no repositorio.

## Diagnostico visual

Padroes predominantes nas imagens:

- **Paleta quente e artesanal**: tons de caramelo, doce de leite, goiabada e farinha.
- **Contraste suave**: fundos claros e quentes com elementos de destaque em vermelho/laranja.
- **Textura premium caseira**: atmosfera acolhedora com percepcao de produto premium.
- **Naturalidade**: verdes suaves funcionam como balanco para calor cromatico.

## Essencia da marca

- **Premium acessivel**: sofisticacao sem perder acolhimento.
- **Operacao clara**: UX que privilegia leitura rapida e decisao segura.
- **Sensorial digital**: experiencia visual inspirada no processo artesanal.

## Paleta cromatica recomendada

| Token          | Hex       | Uso principal                              |
| -------------- | --------- | ------------------------------------------ |
| `--tomato-700` | `#A0141A` | Alertas premium, estados de alta enfase    |
| `--tomato-500` | `#C9242F` | CTA primario e navegacao ativa             |
| `--crust-500`  | `#C9712F` | Gradientes quentes e destaque secundario   |
| `--crust-400`  | `#DE8E44` | Hover e acentos de suporte                 |
| `--mint-500`   | `#8FB098` | Balanceamento visual e blocos informativos |
| `--bg-base`    | `#F6EFE4` | Fundo principal da aplicacao               |
| `--cream-300`  | `#F8E9D8` | Chips, contextos e superficies auxiliares  |
| `--ink-strong` | `#2A1D14` | Titulos e textos de alta legibilidade      |
| `--ink-muted`  | `#715848` | Textos secundarios e metadados             |

## Sistema de layout

- **Soft-edge high-end**: cantos entre 14px e 30px, sombras difusas e profundidade sutil.
- **Warm glass**: paineis semiopacos com blur leve para hierarquia sem ruido.
- **Narrativa por camadas**: sidebar, topbar e conteudo principal com leitura instantanea.
- **Navegacao contextual**: topbar dinamica por rota e CTA coerente com o fluxo.

## UX de excelencia

- Foco visivel consistente para acessibilidade.
- CTAs com contraste forte e sem agressividade cromatica.
- Estados ativos claros na navegacao lateral.
- Home orientada a descoberta dos modulos com hero e galeria editorial.

## Aplicacoes realizadas no web app

- Tema global refinado em `src/app/globals.css`.
- Sidebar com icones, maior legibilidade e active state robusto.
- Topbar contextual por modulo em novo componente dedicado.
- Home com imagens otimizadas (`next/image`) e cards de acesso rapido.
