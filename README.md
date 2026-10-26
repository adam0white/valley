# The Valley

[Play The Valley](https://valley.adamwhite.work).

You are a steward in a Turkish valley. Bring in the landowner's barley, collect household
shares and meet the grain due while households work their own fields and feed their families.
People can refuse your requests. They remember how you respond. Miss the due twice and
you can be dismissed before your term ends. Reaching the end does not erase what happened
to the households.

## How to play

1. Choose **New game**, or **Resume** to continue this browser's saved term. Replacing an
   existing save requires confirmation. The new-term checkbox starts unchecked; it opts
   that term into the October rules described below.
2. Read the current task, date and seasonal forecast. Select a house on the map or with
   its named house button. Read the household's reply and available actions.
3. Call people for seasonal work, collect their share, visit, give grain or reduce a share
   when the relevant action is available. Travel and work take game time. A household
   can refuse or defer. Hold the button beside an eligible refusal to insist; people
   remember that pressure.
4. Read new replies and knocks before choosing again. **Earlier replies** opens history.
   The grain display separates stored grain, cut barley and standing barley from the due.
   The **i** panel explains the current work. Household **About** gives household context.
5. Time advances automatically and slows for important replies. **Skip ⏩** advances toward
   the next event with pending-choice guards. **Menu** pauses time; **Resume** closes it.
   Music is optional and starts off. Leaving the page stops the valley until you return.

Use the named buttons by pointer, touch or keyboard. Escape closes a household view when
no dialog or popover is open. The menu offers Feedback, Full screen, New game, All games,
Recording and Music. In Feedback, **I'm stopping** and **I'm confused** put those words
in your note and send nothing. Changing or clearing a choice keeps your edited text.
**Submit** sends the note and any optional verdict.

## Rules editions

The explicit new-term option selects `valley-2026-10`: completed mill wages, voluntary
extra sacks, winter grain loans through real neighbour ties, topics during attended visits,
a third-year labour levy and a separate grain store with inspection. Households can refuse
voluntary requests. Grain transfers conserve actual stores. These paths do not guarantee
gratitude or forgiveness. Unmarked runs keep their original rules. The edition persists
through exports, local saves and recovery continuations.

## Saves, recording and continuation

The browser stores the seed and action log in localStorage and compressed recovery volumes
in IndexedDB. Resume reconstructs the term from its saved continuation. Save messages report
whether the browser confirmed the log and recovery volume; storage is not guaranteed.
Malformed or incompatible logs are preserved until you replace them. Prior volumes show
real saved pages; reading them neither rewinds play nor grants continuation ownership.
Clearing browser storage can remove these local records.

The menu's **Recording** switch controls lab recording. While recording is on, recorded
play links across games on this device. DNT/GPC set the initial default off; explicitly
turning Recording on enables it. While recording is off, Feedback offers an unchecked
option to share play. Unchecked submission sends the note, optional answer and name without
saved play. See [Lab privacy](https://human.adamwhite.work/lab/privacy/).

Exact `?lab=1` exposes named seeds, JSON imports, notebook and local export tools, time
choices and continuity/checkpoint tools. Downloads contain full state; feedback uses a
compact replay with the starting seed and actions. Current full and compact exports are
validated against pinned framework, narration, cast and edition inputs and fingerprints.
Incompatible older files may be refused with a start-fresh message. A file import does not
acquire ownership of continuing people. The local cast shelf checks exact parent receipts
and admits only supported source roles, engines, calendars, norms and duties. It is a
browser-local continuation contract, not cross-device synchronization or multiplayer.

## Human Framework and host responsibilities

Human Framework supplies the people's persisted state, routines, needs, impressions,
relationships and responses to suggestions. Valley's adapter asks those people to act and
uses their actual replies and completed work. Valley owns the calendar, weather, fields,
grain accounts, household shares, tax dates, travel, orders, interface and endings.
The host does not replace a refusal with a guaranteed voluntary gift.

Current source uses Valley **0.3.0**, HF package **3.0.0**, Person engine **2.23.0**,
immutable lab-client **0.4.11** and lab-kit **0.5.12**. Package and engine versions are
separate values.

## Development and delivery

Use Node 24 or later and TypeScript 7 or later. This source pins TypeScript 7.0.2,
Vite 8.3.5, Vitest 5.0.5, Biome 2.6.3 and Wrangler 4.152.0. The UI uses DOM and Canvas 2D;
production serves static assets.

```sh
npm ci
npm run dev
npm run check:lane
npm run build
```

The lane runs lint, typecheck and the full test suite under the normal shared suite lock.
Do not bypass a queued lock. Commits are signed. Technical delivery requires exact green
CI; app changes also require a clean managed deployment and matching live release.json
with browser verification. Source-only docs need no app deployment.

Read [AGENTS](AGENTS.md), [HANDOFF](HANDOFF.md), [the design](docs/design.md) and
[the plain English policy](docs/lab/plain-english.md) before changes. The handoff separates
current source, historical delivery receipts, remaining engineering and owner acceptance.
Adam accepts game feel separately. Lab-panel HF3 rounds run under the playtest director;
friends' playtests and Show HN remain paused.
