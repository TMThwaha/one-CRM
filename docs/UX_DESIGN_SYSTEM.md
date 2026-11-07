# UX & design system

## Direction
Calm, dense, fast. A neutral surface with **one** indigo accent; semantic colours (green/amber/red) only carry meaning. Geist Sans/Mono. Light and dark are both first-class (system default, manual override persisted, no flash on load).

## Tokens (`src/app/globals.css`)
CSS variables for background, surfaces, borders, text (muted/faint), accent (+soft/hover/fg), success/warning/danger (+soft), focus ring, shadow; exposed to Tailwind via `@theme inline` (`bg-surface`, `text-muted`, `border-border`, `bg-accent-soft`, …). Components never hard-code colours. Contrast targets WCAG AA; **not yet measured with an automated audit**.

## Components (`src/components/ui.tsx`)
Button (primary/secondary/ghost/danger, loading), Input/Textarea/Select, Field (label + error + hint with `aria-describedby`), Badge, Avatar, Kbd, Skeleton, EmptyState, ErrorNote, Panel, PageHeader, Pagination, Modal/side sheet (native `<dialog>`: focus trap, Esc, inert background), Toasts (`aria-live`). Hand-written to avoid a heavy dependency; no component library.

## Interaction principles (implemented)
- **Search-first:** Ctrl/Cmd+K palette searches contacts, companies, leads, deals, tasks (permission-scoped) and runs navigation/create commands; arrow keys + Enter.
- **Universal create:** "New" menu and palette create any record from anywhere.
- **Customer 360:** one page per contact/company/deal with the connected timeline, related records, open tasks and an inline "log activity" form — no tab hopping.
- **Explainable ranking:** lead score shows every contributing rule.
- **Reduced clicks:** one-click task completion (dashboard, lists, detail), due-date shortcuts (Today/Tomorrow/Next week), stage stepper on deals, drag-and-drop board **plus** a select on each card for keyboard users.
- **Role-aware UI:** navigation and actions hide when permissions are missing (server still enforces).
- **Honest empty states:** every list explains what goes there and offers the first action; no fake data.
- **Responsive:** sidebar becomes a drawer below `lg`; tables hide secondary columns on small screens.
- **Accessibility:** skip link, semantic landmarks, labelled controls, `aria-current`, roles on tabs/menus/combobox, visible focus, reduced-motion support.

## Not yet built / not yet verified
Adaptive dashboards and widget customisation, daily briefing, bulk actions with preview, natural-language filters, AI sidekick (all depend on later phases); keyboard shortcuts beyond Ctrl/K; mobile app; i18n beyond number/date formatting (locale `en-IN` default); automated a11y tests; visual QA in a real browser (see KNOWN_LIMITATIONS).
