# LLM App Guide

This guide highlights the key surfaces and helpers so any future model (or teammate) can quickly understand the modernized shell.

## Global shell
- `apps/web/src/app/layout.tsx` wraps every route with `<Topbar />` and `<FlowDock />`, then renders the actual page (`{children}`), keeping navigation cues and quick metrics sticky across the app.
- `apps/web/src/components/topbar.tsx` resolves the current route (`resolveNavItem`) and renders the route hint as the eyebrow plus the page title so the user always sees the intent of the screen.
- `apps/web/src/components/nav.tsx` renders section labels, icons, and the `hint` text for each entry; hints are fed from `navigation-model` so they stay synchronized with the route metadata.
- `apps/web/src/components/flow-dock.tsx` exposes the four-step operation flow (Pedidos > Clientes > Produtos > Estoque) with completed/current/locked states, aggregated KPIs, and an “Abrir pedidos” call to action.

## Surface-mode orchestration
- `apps/web/src/hooks/use-surface-mode.ts` is the shared hook that stores the user’s view preference (`operation` vs `full`) per page; it falls back to `operation` on small screens and persists the choice in `localStorage`.
- All operational pages (`pedidos`, `clientes`, `produtos`, `estoque`) consume this hook: the orders and estoque pages expose mode switchers, while `clientes` and `produtos` use the mode to gate filters or sections.

## Orders surface
- `apps/web/src/features/orders/orders-screen.tsx` fetches the entire workspace and wires the new “Modo agenda do dia” banner, the summary chips, plus the `sortedVisibleOrderList`, `activeOrderCount`, and `setViewMode` actions to keep the UI focused on what still needs attention.
- `apps/web/src/features/orders/order-quick-create.tsx` now surfaces a draft summary row (customer, box status, total), improves the virtual box messaging (“Caixa virtual”) and encourages tapping cards.
- `apps/web/src/features/orders/orders-board.tsx` accepts an optional `summary` slot so the operational banner sits between the helper text and the toolbar.

## Estoque surface
- `apps/web/src/app/estoque/page.tsx` keeps the hero, puts the `stock-surface-banner` inside the header slot, and exposes two buttons (`Foco rapido` vs `Ferramentas`) bound to `useSurfaceMode` so the cards and tools reveal themselves according to the chosen mode.

## Hygiene recommendations
- Run `./scripts/log-worktree-state.sh <note>` before every major change so `docs/historical-deposits/record.md` records the snapshot.
- Keep UI surface mode switches consistent by making `setViewMode('operation')` the entry point for quick focus screens and storing a new `storagePrefix` when the default behavior changes (`querobroapp.surface-mode.v2` on `pedidos`).
- When adding new flows, explain their purpose in this guide and add metadata (`hint`, `title`, `icon`) to `apps/web/src/lib/navigation-model.ts` so tooling can infer them easily.
