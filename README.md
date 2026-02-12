# Quero Bro App

Aplicativo para gestão de bro sincronizado com TypeScript.

## Visão geral

Este repositório é um monorepo com **Turborepo + pnpm** para API, Web e Mobile:

- `apps/api`: NestJS + Prisma
- `apps/web`: Next.js
- `apps/mobile`: Expo React Native
- `packages/shared`: tipos e schemas compartilhados
- `packages/ui`: componentes compartilhados

## Instalação e uso

### 1) Clone o repositório

```bash
git clone https://github.com/guimarangon369085/querobroapp.git
cd querobroapp
```

### 2) Instale dependências

> Nota: este projeto usa **pnpm** oficialmente.

```bash
pnpm install
```

### 3) Inicie o app

```bash
pnpm dev
```

## Tecnologias usadas

- TypeScript
- Node.js
- NestJS
- Next.js
- Expo React Native
- Prisma
- Turborepo
- pnpm

## Prompt reformulado (alinhado ao projeto real)

```text
Organize o repositório guimarangon369085/querobroapp com foco no stack real do projeto (monorepo pnpm + Turbo), aplicando:
1) README.md com título "Quero Bro App", descrição "Aplicativo para gestão de bro sincronizado com TypeScript", instruções reais de uso com pnpm (clone, pnpm install, pnpm dev) e tecnologias principais.
2) LICENSE com texto da licença MIT.
3) CONTRIBUTING.md com fluxo básico para abrir issues e contribuir com correções/funcionalidades.
4) Garantir diretórios principais (src/ e tests/) para código e testes.
5) Workflow de CI em .github/workflows para instalar dependências e validar o repositório (install + test).
6) .gitignore com entradas essenciais (node_modules/ e .env), sem remover regras já importantes.

Valide após cada etapa e registre qualquer ajuste necessário por conta da estrutura real do monorepo.
```
