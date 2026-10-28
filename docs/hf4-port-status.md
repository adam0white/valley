# Valley HF4 port status — 2026-10-28

Remaining: released Valley portable role bindings in the matching lab client; then the Run bridge, whole-game replay export, CI, deployment and owner acceptance. Valley remains on HF 3.0.0/client 0.4.15. No HF4 game or HF4 playtest-export proof is claimed.

## G2: published client refuses Valley

This is the **G2 portable admission** row of human-framework `docs/hf4-game-needs.md`, including the Valley requirement to keep continuing people through supported admission and shelf projections. Review target: **2026-11-03**. The dependency belongs to the framework/client maintainer. No owner decision is needed. This work changes no HF source.

Published HF 4.8.0 and its matching client 0.5.4/kit 0.5.22 were inspected on 2026-10-28. Client `dist/persona-portable.js` has no `valley` entry in `SOURCE_ROLES`, although `castForGame('valley')` names Maryam, Yusuf, Samira, Danyal, Yusuf Usta and Meryem. Its source registry also lacks their Well/Watch/Warren producer roles. This is a published client contract gap; HF's general mapped portable admission alone does not supply the client identity and ownership checks.

An isolated executable probe against exact HF 4.8.0/client 0.5.4 returned:

- Outgoing `projectPortablePerson` for each of the six actual Valley role/cast pairs: `This person has no authored chapter in this game.` The refusal happens before actor projection.
- A valid HF4 retained-v2 Yusuf from the supported Left Hand source passed `portablePersonRole(parent, 'lefthand')` as `yusuf`. The same envelope failed `portablePersonRole(parent, 'valley')`: `This person has no matching authored role here. Keep the source chapter or export it.`
- The idle source Run replay returned `verified:true` with its exact full hash. This validates that probe source, not a Valley game port or full cast journey.

HF4 build: `01f89e8c9a60c3b05551c4d657279b6d19c15ff4fed4ed62d2f5cca125c12662`.
HF4 schema: `79f7d78ca1512ca64ff2d9fd3502193891ed16f05a02d3187af2dfad00ec3715`.
Client tar SHA256: `7f0c01e723b13e10f4a5e1aeb8376e21b409906af82d0ef97a4a1150d319364c`.

The task's private receipt retains the script, exact lockfile, downloaded artifacts and JSON output at `~/code/.lab-scratch/codex/valley-hf4-proof/`. The probe used the published tag's minimal host and a synthetic supported source. It did not use a private player export or write to the shelf.

## Port decisions and public gameplay

Old saves and 3.x links may be refused when a new port is delivered, with a keep-file/start-fresh message. That permission does not allow fresh actors to stand in for retained people. A future bridge can use one all-fine community Run instead of mixed per-person routine mode. Its household hunch can use supported current-time hypothetical offers instead of the old next-waking-hour premise. Neither change is implemented in this release.

The existing ordinary New game already opens the complete public term, including contextual visits and finite food-for-work. The menu exposes Notebook and pace; diagnostics remain collapsed under Debug beside Lab privacy. The shelf link now uses the kit's `PEOPLE_ACROSS_GAMES` constant. Local-public-edition carryover remains refused because the producer/receiver/world binding is unsupported; this gap is not closed by displaying the central shelf link. No hidden gameplay flag is added.

G16 remains a separate unbounded semantic-memory measurement need, not the reason this port stopped. Birth/conception, actual-act voice evidence, sourced norms and current-time other-person preview exist on HF4.8; their game adoption remains engineering work after G2.
