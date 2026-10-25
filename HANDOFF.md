## Frictionless recording direction, 2026-10-23

Immutable client0.4.4 and kit0.5.4 implement this direction. The owner directs automatic linkage across games on this device whenever recording is on. The first-visit notice covers recording and linkage. One menu switch turns recording on even with DNT/GPC; those signals set the initial default off. Send word uses one optional unchecked “Share this run and my play with the lab” checkbox only while recording is off. Submit with it checked enables recording/linkage and sends an available run; unchecked sends the note alone. Old linkage choices migrate silently. No separate continuing-person recording consent applies, including identity changes and loaded histories. This supersedes earlier recording-consent sections below. Owner words and authority: human-framework/docs/owner-directions-2026-10-18.md (2026-10-23 frictionless feedback).


## Simplify source increment — 2026-10-24

Owner F-492 direction is implemented in the presentation layer. Ordinary menus show Resume, Feedback, Full screen, All games, Recording and inline-confirmed New game. Exact `lab=1` retains named seeds, imports, continuity and checkpoint tools, speed choices and local exports. Gameplay history remains in Earlier replies; force/refusal, grain, crop, share and household authority rules are unchanged. Automatic continuity comes from client0.4.6 / kit0.5.6; the actual notice node lives in a stable footer. The HF2.8.0 rule pin is unchanged.

The [plain English policy](docs/lab/plain-english.md) governs visible copy. Display projections turn household descriptions, state fragments and dialogue fragments into literal sentences while retaining saved/replay strings. Existing Turkish calendar and office-term projections predate this increment and are unchanged. All Turkish names and terms remain in source. The exhaustive source inventory, paired checker receipts, independent review, CI and browser receipts live outside this removable tree at `~/code/.lab-scratch/simplify/workers/valley.md` and `valley-terms.md`.

Tablet widths use fluid text and a two-column household layout from768px. Household guidance and replies wrap; reading bodies scroll above reachable actions. A failed start preserves the previous save and receipts, reports a literal error, and keeps Feedback reachable. No new playtest round was run. Technical delivery requires exact green CI, fresh latest-origin deployment, clean release metadata and live Chromium/WebKit proof at four widths. Adam accepts game feel separately; friends and Show HN remain paused. Source and deployment phase status is in the external worker report.

## CI scroll-check follow-up — 2026-10-24

Source1210914 failed the phone About scroll assertion in CI40137397100. The local geometry probe found that About starts loading Literata italic, while the immediate scroll check runs with the font set still loading. The focused test now waits for `document.fonts.ready` before measuring and scrolling the displayed About content, including after the call refresh. It keeps the same scroll-to-bottom assertions and tolerances. Local reproduction did not fail before the change; probe traces and exact CI outcome are recorded in the external worker report. No game rules, culture, or layout changes accompany this test synchronization.

## Compact shared footer adoption — 2026-10-24

Final delivery adopts immutable kit0.5.7 with unchanged client0.4.6 and current package HF2.18.0 (engine2.17.0). The actual SDK notice node and its async suppression remain intact. The complete disclosure has no Dismiss control. Obsolete host notice font/position overrides are removed; horizontal notice padding is2px for portable system-ui metrics. The notice uses max(14px,0.8rem) to keep14px at Valley’s17px root and still grow with enlarged text. The footer keeps its natural height so enlarged text can wrap. Focused checks pin the full sentence, at least14px, one line and node/wrapper at most40px at360, plus enlarged wrapping. Existing reviewed copy, culture, simulation and authority rules are unchanged. Exact CI, fresh deployment, live eight-case proof and cleanup are tracked in the external worker report; owner readiness stays separate.

Pin clarification: the older simplify note above says HF2.8.0. The actual manifest and lock at this task’s baseline and current origin use HF2.18.0. This adoption preserves that actual pin; the earlier note was stale.

## Portable compact-footer font follow-up — 2026-10-24

Source6b5185d passed Mac checks but failed Linux CI40147328662: the full notice occupied two lines at360. The notice now requests Arial, "Liberation Sans", sans-serif, without changing body typography, immutable kit/client, text, node, type-size rule or2px padding. Mac measurements at14px show the sentence uses330.46px instead of system-ui341.13px within354px content width; these are not Linux measurements. Enlarged text still wraps naturally. The existing one-line/font/footprint/clipping assertions remain intact, with font-family, text/content-width and line-rectangle diagnostics added. Exact Linux CI remains the delivery gate. No extra review or playtest is required for this narrow correction.

## WebKit navigation save follow-up — 2026-10-24

Live eight-case verification of clean45b0ed8 found an unhandled native Blob compression rejection when WebKit leaves an active game for another page. Staying in the game and compressing a Blob both succeed; the failure occurs during document unload through visibilitychange → bindVolume → gzip. The input log is written before compression, but compression previously sat outside the snapshot error handler.

Compression now runs inside the existing recovery-snapshot error handler. A failed snapshot keeps the previous IndexedDB snapshot and current input log, reports a diagnostic warning, and does not reject the navigation save promise. Existing session/generation guards and simulation/replay behavior remain unchanged. The regression first failed with the injected compression rejection; it now checks no unhandled page error, unchanged prior snapshot bytes and receipt, and the latest input log. This is a delivery defect correction, with no extra review or playtest. Final exact CI, fresh deployment and DOM-only live reruns are recorded in the external worker report; the twelve-screenshot budget is already used.

## Native WebKit compression input correction — 2026-10-24

Clean a044bc4 passed exact CI and deployed, but real WebKit navigation and reload still emitted native Blob access-control page errors with Recording both on and off. Catching the promise was insufficient; the browser reported the document-owned Blob stream failure separately. The final compression input now uses Response(text).body, following the independently reproduced Hearsay finding, while retaining gzip output, legacy decoding, no-CompressionStream fallback, the recovery error handler and session ownership guards. No error filtering or swallowing is used in browser verification.

A new regression makes document Blob input streams unavailable, triggers the real hidden-page snapshot path, and requires a newly persisted, gzip-decodable snapshot with the latest input count and minute. It failed on the old path before the fix. The prior snapshot/latest-input-log preservation regression remains intact, as do admission ownership, font-ready About scrolling and compact-footer assertions. No rules, culture, packages or UI text changed. External receipts record lane, signed source, exact CI and the required fresh deployment/live reruns.

## Plain English at the source — 2026-10-25

The owner requested the Pass pilot treatment for Valley. Story, dialogue, household
portraits, private encounters, instructions, menus and metadata now use complete English.
The sentence display table is removed. Preserved HF labels and summaries still use a
small term gloss. Rewritten lines retain their original saved repetition keys through
`rememberedLine`; do not delete those keys as redundant prose.

Delivery evidence and remaining work are in
`~/code/.lab-scratch/plain2/valley-report.md`. The prose-free full-term baseline and opt-in
runner live in `test/fixtures/plain-english-mechanics.json` and
`scripts/plain-english-proof.mjs`. The game version stays 0.3.0. New exports replay;
older compact exports whose prose fingerprint differs receive a start-fresh message.
Adam accepts game feel separately from technical release checks.

## Published HF plain narration — 2026-10-25

The host pins published HF2.21.0, including lab-client’s dependency through a root override.
Fresh games opt every actor into persisted plain narration after cast admission and before
simulation. Full-state loading preserves saved choices. Newborns inherit only the mother’s
plainEnglish choice. Full and compact exports and the local input log pin the initial choice;
replay uses it. The game version remains 0.3.0; incompatible older framework exports are
refused with a start-fresh message. Host domain glosses and rememberedLine keys remain.

Lesson: narration is saved state. A prose upgrade needs a pinned initial narration choice
for compact replay, and a child must not inherit unrelated host lexicon overrides. Parity
must retain semantic history and repetition keys. Convert only known generated narration
back to its prior wording; do not blank all strings or episode history to obtain equality.
The earlier source-rewrite proof fixture is specifically an HF2.18.0 baseline. The separate
upgrade/control/plain paired proof, independent review, on-screen dump and delivery receipts
are in `~/code/.lab-scratch/hfadopt/valley-report.md`. Adam accepts feel separately.

The receiver explicitly admits both the legacy2.17.0 and current2.21.0 engine dialects
through the same role, calendar, norm, duty and checkpoint validation. Unknown engines
remain refused. This includes this host’s current exported histories; changing the outgoing
engine stamp without updating this allowlist would block the next receiving chapter.
Legacy local logs without a pinned narration choice are refused without deleting the log.
