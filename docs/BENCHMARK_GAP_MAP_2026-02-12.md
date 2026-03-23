# BENCHMARK_GAP_MAP_2026-02-12

> Nota historica: este benchmark antecede a consolidacao da operacao 100% interna. Use as docs operacionais atuais como fonte de verdade para o estado presente.

## Objetivo

Registrar aprendizados de benchmark externo e traduzir em acoes praticas para o QUEROBROAPP.

## Direcao valida para o produto

- Interface cada vez mais simples para operacao.
- Regras de negocio cada vez mais fortes no backend.
- Integracoes externas futuras devem ser opcionais e desacopladas; a base ativa atual opera sem elas.
- Segurança e rastreabilidade como padrao.

## Gaps ainda relevantes

1. Cobertura de testes de negocio.
2. Trilha de migracao Prisma dev/prod mais previsivel.
3. Reintegracao externa eventual, so depois de o nucleo operacional estar estavel.
4. Observabilidade mais detalhada para suporte operacional.

## Acao recomendada

Seguir esta ordem:

1. UX operacional (menos cliques e menos erro humano).
2. Testes de dominio e estabilidade de dados.
3. Reintegracoes externas apenas depois de estabilizar o nucleo e a cobertura.
