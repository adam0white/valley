# Valley HF4 port status — 2026-10-29

Remaining: clear the runtime/archive workload gate, finish whole-game replay proofs and exact green CI, then merge and deploy clean source. The single hosted review answered; both findings are fixed in this candidate. Final check:lane passes66tests/14files, including their regressions, plus lint/types in202.57s. Build passes. Candidate pins are HF4.8.0/client0.5.6/kit0.5.24. Production remains the earlier HF3 release until delivery. Adam accepts feel separately.

## G2: role dependency closed on2026-10-28

[Client0.5.5](https://github.com/adam0white/human-framework/releases/tag/lab-client-v0.5.5) and [kit0.5.23](https://github.com/adam0white/human-framework/releases/tag/lab-kit-v0.5.23) are released from PR57/cd9d689 with exact green merged CI. Valley downloaded both immutable artifacts and verified their SHA256 values before a lockfile-only and frozen install. Client SHA256: `0faa3e3ea003c297a6b06fcac6eeca1bddebdeaa8d5fb6746f06cf830775753f`. Kit SHA256: `658a33d03a707c2978381b2600d2c4ee811e3053411566f6de927c8e211acbff`. Roles now bind the six actual Valley IDs, including `yusuf-usta` and `meryem-visitor`. This closes the missing-role dependency; it does not certify a whole game journey.

## Released shared-write gate — 2026-10-29

Client0.5.6 and kit0.5.24 are adopted with HF4.8.0. The kit's strict peer range explicitly includes0.5.6. Official SHA256 values match the downloaded artifacts: client `5a53bac1f0b5d236caed06d8a18c9089e0059b531eff1b9ae1b0e99162f72482`; kit `0754b7a7663d64cbab2b69e7a31a164d2a3178c82ff140682be2ceff49651b6a`. Both signed tags verify; the client's detached checksum signature also verifies. The kit has no detached checksum-signature asset. Lockfile-only and frozen install pass.

The actual public portableWriteBlockers gate supplies named per-person refusals/skips before shared projection or arrival writes. Unverified peers keep that person read-only. The host covers ordinary checkpoints, terminal closure and alternatives; blocked nonempty arrivals preserve the entire previous game. Empty acknowledgments and local/files/reads remain available. No copied policy, peer override or fake live certification is used. This intentionally closed policy is not a missing-role dependency or proof that all peers are ready.

## Historical client0.5.4 refusal

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

Old saves and 3.x links may be refused when a new port is delivered, with a keep-file/start-fresh message. That permission does not allow fresh actors to stand in for retained people. The bridge uses one community Run with supported daily numerical fidelity instead of mixed per-person routine mode. Every faculty stays on. Its household hunch can use supported current-time hypothetical offers instead of the old next-waking-hour premise. The candidate adopts one community Run. A hunch without a supported verdict states its knowledge limit instead of inventing an answer.

The existing ordinary New game already opens the complete public term, including contextual visits and finite food-for-work. The menu exposes Notebook and pace; diagnostics remain collapsed under Debug beside Lab privacy. The shelf link now uses the kit's `PEOPLE_ACROSS_GAMES` constant. The candidate replaces blanket local-edition refusal with validated retained history and actual per-person host obligations. A current question or unfinished food/work agreement keeps that person here; copying words into the Notebook alone does not. No hidden gameplay flag is added.

G16 remains a separate household-history retention/measurement need, not the reason this port stopped. Published HF4.8 already bounds memory at 200 episodes and 64 gists; the older inventory wording does not establish unbounded current memory. A full Valley term has not been measured on HF4.8. Birth/conception, actual-act voice evidence, sourced norms and current-time other-person preview exist on HF4.8; their candidate game routes are being tested after the G2 dependency release.


## Historical HF3 replay goldens

The owner waived HF3 numeric parity during the HF4 port. These old `next.test.ts` SHA256 values remain historical records, not current passing claims. Seed 7, a wage call at minute 420 to Kavak and Çoban, and continuation to minute 4320 previously produced:

- Default rules: `0078dc96765a69d70ea40a30811126ea5c0067bdc3a22402c7170c89b4433534`.
- `valley-2026-10`: `89b4bad4c23fe63376efa572c27cf17265329b586b95dfdfd9d34faaf17395f3`.

Current coverage instead verifies an actual HF4 public opening plus one quantum, native full-hash replay, exact full and compact restoration, independent input reconstruction, equal continuation, and corrupted native-hash refusal.


The bounded HF4 public seed-7 opening hash changed after the authored-input field audit restored material, risk, skill, and explicit goal effects. The earlier candidate receipt was `94d1309843d02da55cb504b84c83edae139eb1cd355e655042b28159f6a3d39f`. The observed post-audit native full hash is `2ea2408e49510f0b912545b6a68cc4df348201cd784b91732b01d3ebb62d759d`; the guard retains exact reconstruction, continuation, and corruption checks.

## Resume measurement — 2026-10-29

The existing day-12 export control targets minute 17550 and runs under a 120-second test budget. The corrected HF4.8 public seed406153184 owner schedule, daily fidelity and all53 people/faculties exceeded that budget. Its last complete checkpoint was minute1440 at107.440s with11,134,499 native bytes; the subprocess stopped at120.071s. Exact source hashes before/after matched. This run shared the machine with the normal lane, so it is not isolated cost or proof that a whole term cannot finish. A second same-source120-second run with no concurrent Valley tests also exceeded the bound: its last complete daily checkpoint was minute1440 at27.427s with the same11,134,499 native bytes; it stopped at120.144s before the next daily checkpoint. Other repositories still shared the machine. Neither run produced the day-12 fingerprint or proved the881-day term. The earlier corrected-mapping audit was preceded by a four-day sample at320.373s/38,674,762bytes and an18.032s CPU profile dominated by HF self-time. Those source-specific receipts remain separate; no cross-source speed ratio is claimed.

The relevant published needs are **G6 (step cost/archive)** and **G7 (cheaper larger daily step)** in human-framework docs/hf4-game-needs.md. G16 semantic retention is separate. Recheck the released runtime and compatible client/kit on **2026-11-03**. A complete881-day public term and exact day-12 export replay remain unproved. Do not shorten the term, drop people/faculties, raise the test deadline, or deploy this candidate as a complete port. No HF source was edited.

Short current-pin native replay, full/compact restore, independent input reconstruction, corruption refusal and continued-state equality pass. The receipt regression also proves that a rejected resolver receipt discards its staged conversation and lifecycle inputs while preserving prior deferred inputs, active work and the unpublished host world. These bounded proofs do not close the workload gate.

Correction2026-10-29: a later source audit found that a missing family-completion lookup still calls public exportRun and scans full history after frame changes, including repeated guardian eligibility queries before an approval exists. The profile's HF self-time does not establish a framework-only cause: this host call triggers cold HF export work. It now uses a staged/persisted book of actual accepted family receipts. The post-fix workload result below records the remaining gate; the earlier profile still does not establish a framework-only cause.

After the persisted family-receipt fix, the same seed406153184/day12 daily workload again reached the120-second bound: minute1440 at23.677s/11,134,499nativebytes; minute2880 at104.443s/21,897,901bytes/one accepted input. No concurrent Valley tests or package installation ran; all recorded source hashes stayed equal. Other repositories shared the machine. The workload used client0.5.5 before the compatible pair was published; HF4.8/core source are unchanged by the subsequent client/kit adoption. This is a source-bound prefix, not an isolated before/after speed ratio, day-12 fingerprint or881-day-term result. The host cold-export regression is closed (three missing queries: three exports before, zero after); remaining workload/archive readiness still needs the G6/G7 gate.

Final current-pair check:lane passes58tests/12files plus lint/types in170.09s, with two local workers and unchanged120s test deadlines. Build passes. Native replay and its pinned hash remain exact. Actual five-visitor release/day1, SDK projector refusal with unchanged frozen source, and a separate actual manual checkpoint/no-write control pass. A real accepted-HF-death component verifies terminal gating with a stubbed whole-game publication guard; it is not a complete played Valley death result. Automatic blocked checkpoints perform zero whole-game replay validations; manual source refusal remains covered.


## Hosted review fixes — 2026-10-29

The sole hosted review of PR11 answered with two findings. Queued host interruptions now enter the native Run as activity.interrupted inputs and request the next decision at that accepted time. A rejected input batch keeps the host queue; acceptance transfers ownership to the native queue before host removal. The regressions check a future interruption, exact native interrupted resolution, replay, and rejected admission. The actual help-end control checks the native activity ID and stop time rather than only capped pay.

A steward whose care activity overruns a visit still has to walk home. Granary access and quarry cargo settlement wait for completed travel receipts. Stable direction/place offer IDs preserve an active walk across native reviews. Authored component controls exercise late sleep, a return crossing a review boundary, interruption without settlement, retry, and completed cargo delivery. They do not claim a played whole-game journey.

Full CI40797790914 on the previous7eb682f source reached its20-minute job limit and was cancelled. Lint/types completed. Six Lab UI failures and two native-game failures were reported before cancellation; no final failure stacks were printed. The native-game cases took192.6s and140.4s against explicit120s limits. These observations do not isolate their causes. No merge or deployment is authorized by a partial CI result. Earlier workload measurements predate these review fixes; they remain historical source-specific evidence.

Final review-fix lane:66tests/14files plus lint/types PASS202.57s; build PASS. The pinned native replay hash remains unchanged and exact. The lane now includes food/work terms and delayed-return controls. No deadline, actor or faculty reduction was used.

Current corrected-source control (including both hosted fixes) again exceeded120seconds. The actual seed406153184 owner schedule, all53 actors/faculties, daily fidelity and target17550 reached its last complete checkpoint at1440 in33.924s with11,134,499native bytes (6,922,237history;3,883,707current). The exact process was terminated at120.152s before the next daily checkpoint. All seven recorded source/lock hashes matched before and after; no concurrent Valley tests or installs ran. Other repositories shared the machine. This is a source-bound failed budget control, not a day-12 replay, whole-term result, isolated speed ratio or framework-only causal attribution. Raw script/log/JSON and the source-bound manifest are retained in the coordinator report. G6/G7 recheck2026-11-03 remains open.
