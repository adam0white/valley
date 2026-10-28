# Valley

Read [the design](docs/design.md) and [HANDOFF.md](HANDOFF.md) before changes.
Follow [the plain English policy](docs/lab/plain-english.md) for visible text.
Keep household authority, crop dates, tax rules, simulation strings and replay behavior unchanged during presentation work.
Keep the Turkish setting and person/place names. Render common Turkish nouns in plain English. At most two flavour words may remain, each explained within its first sentence. Preserve simulation strings through display projection. Existing term projections are documented in the simplify inventory.
Use the shared Node 26.12.0 runtime and pnpm 12.14.0. Run `pnpm run check:lane` before signed commits.
Install with `pnpm install --frozen-lockfile`. Preserve strict engines and peers, no hoisting, shared-store hardlinks, the one-day third-party release age and the version-specific build approvals in pnpm-workspace.yaml. Do not download a project runtime.
Current stack: Valley 0.3.1; HF package 3.0.0 / Person engine 2.23.0; immutable lab-client 0.4.15 / lab-kit 0.5.22; TypeScript 7.0.2, Vite 8.3.5, Vitest 5.0.5, Biome 2.6.3 and Wrangler 4.152.0. TypeScript support is 7 or later. The UI uses DOM and Canvas 2D. Keep lab client and kit as release artifacts.
Technical delivery requires signed source and exact green CI. App changes also require a clean live release with browser verification; source-only docs require no app deployment. Adam accepts game feel separately. Lab-panel rounds on HF3 builds are allowed under the playtest director. Friends' playtests and Show HN remain paused.

## Public gameplay

The ordinary New game opens the complete public term. Notebook, pace, visits, dialogue and food/work terms stay public. Cast controls belong on the central People across games shelf. Keep diagnostics in the collapsed Debug item beside Lab privacy. Use the kit PEOPLE_ACROSS_GAMES label for the shelf link.

The HF4 port is blocked by the published client role bindings, not an owner question. See [the dated G2 receipt](docs/hf4-port-status.md). Keep HF 3.0.0/client 0.4.15 until the supported Valley carryover route is released. Do not replace continuing people with fresh defaults or bypass the client identity checks.

Run only check:lane locally before commits. It checks lint, types, game/export replay and focused browser controls without the suite lock. Hosted CI runs the full check. Deploy only after green ci on the exact merged commit; the deploy script builds and uploads that source without repeating the suite. Never acquire the machine suite lock for this game.
