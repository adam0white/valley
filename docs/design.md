# The Valley: design

**One line.** The agha lives in the city. You are his kahya, his steward in a valley of two hamlets, with his seal, his ledger and his granary, and no kin here. The last kahya left in the night. Three pages are cut from his ledger. The agha's due is fixed; the weather is not. Every household can say no.

**Done for version 1** (set 2026-10-19 by the coordinator's brief; the owner, Adam, accepts feel separately): one three-year term that can be played to its end at the elders' gathering, live at https://valley.adamwhite.work, with an in-fiction save, a playtest export that replays to the same fingerprint, tests, a headless measure that holds the refusal band below, `npm run check`, and at least two polish rounds with four or more source-unread playtesters recorded verbatim in `docs/playtests/`.

**Current canonical increment (2026-10-23).** Preserve the three-year stewardship loop while replacing the maintained foreground with Yusuf Usta74, Meryem19, Yusuf34, Samira29, Maryam68 and Christian Danyal52. The steward is a separate player office. The canonical registry deliberately replaces old namesakes; Zehra remains Yusuf's wife and her pregnancy remains real. Other fixed residents are unnamed incidental roles; upper generated households remain background. Return visits can disclose one private fact at a time; no disclosure awards forgiveness or a completed repair.

**Done for this increment.** Released shared canonical profiles and browser-life API adopted with exact pins; explicit supported carry and privacy gates; loaded runs pinned and current exports deterministic; an actual bounded visitor chapter and release; one independent correctness/design review; signed commit, exact green CI, deploy and live release verification; ordinary browser checks and a real cross-origin person journey at360×690 and1280×800. The owner accepts after technical delivery. Content-only checkpoints do not satisfy this contract. Current work and remaining gates are recorded at `/Users/abdul/code/.lab-scratch/cast/valley.md`.

**Scope change, said once.** The owner's brief lists marriages and alliances with neighbouring valleys as decisions. Version 1 cuts brokering and neighbouring valleys: marriages, births and deaths happen in HF on their own and are observed, not brokered, and the outside force is the agha's due. Target for brokering and one neighbouring valley over the pass: version 2, proposed after the owner's first play (on or after 2026-10-26).

## How it was settled (2026-10-19)

The brief (`scratchpad` copy, summarised: the owner's taste signals, the idea, HF's capabilities, the constraints) went to three consultants who read no source.

- **Grand-strategy veteran (Opus).** The steward is a person and their scarce resource is presence. Every 30 seconds: ask, read a reply, or move. The clock runs fast while nobody answers and slows by itself when someone does. Steal Old World's orders (from the steward's body, not a cap), Football Manager's scouting fog, and Crusader Kings' mortal ruler with memories as sentences. Break the omniscient ruler: "If you weren't there and nobody told you, you find out at harvest." Rule: **no consequence without an ask**. The hook must be a reply to something the player did, not a report: a storm two days out, tap houses to cut early, one counter-offers, one refuses ("My wife is near her time").
- **Game-design expert (Opus).** Four verbs, each an ask: Call (labour), Take (grain), Give (from the granary), Visit (refreshes your hunches, costs the steward's days). Hunches are the framework's prediction filtered through stale knowledge, in words. A three-year term under a fixed autumn due; the score is what the elders say at the end. Refusal must cost something real: collide the calendars (the call comes when people need the day for their own fields), make some asks norm-loaded, make protest the main currency, quote the cause in the hunch, and gate it by measurement: 25 to 40% of harvest-season asks come back as something other than a plain yes. At most three notes a day. Saves are ledger volumes bound at dusk; an abandoned future stays as crossed-out ink.
- **Wildcard (Sonnet, a hill-farmer's daughter turned census officer).** You are the **kahya** for an absent agha: "Everyone is polite to you and no one is yours." Open on an absence: "the first sign of trouble in a village is a person not coming to something." A refusal is rarely about the request; there is an older grievance under it. A steward controls the calendar and the seal, not the people; exemptions are the real currency. Shame beats hunger: the neediest are the quiet ones, found by walking the lanes. Delete any score: "a feeling of achievement should be a name you remember in year six."

**Pick.** The designer's size and verbs, the wildcard's fiction and opening, the veteran's two rules. They agree on the important things: no outliner, words instead of meters, refusals with causes, a fixed outside demand.

## Rules

1. **No consequence without an ask.** Every note that matters traces to something the kahya asked, took, gave, or failed to show up for.
2. **No outliner.** People live on the map and in notes. The only ledger with numbers is the agha's granary and the due (world truth). A household's own store is a guess ("their jars look low").
3. **The kahya's read is approximate.** Hunches come from HF `predictAs` with the kahya as observer: words, with how sure you are. A visit refreshes them (HF `glimpsePerson`). The reeve's hunches come from his own impressions, which favour his kin.
4. **Replies have reasons in the person's words.** HF `says`, filtered: no lens vocabulary, no generic line where it is wrong (The Pass, owner playtest).
5. **Insisting is offered only on a no.** Press and hold to insist; it brings compliance under protest and costs trust through HF.
6. **Continuous time, slowdown, not pause.** The clock runs fast through quiet days and slows by itself when a reply or a knock arrives; the game sets its pace, and one quiet Until something happens action stops at the next new event (owner, 2026-10-21).
7. **Limits come from the kahya's body and day.** A visit takes hours of walking; HF fatigue and age limit how many.
8. **Faith is quiet.** A prayer at dusk is a journal line, never a mechanic.
9. **Story is implied.** The empty house of the last kahya, the cut pages, the agha's letters that arrive late and sound the same.

## Core loop

- **The minute you play (harvest, the due, a hungry winter).** Tap a house or a hamlet; a card offers the verbs with the kahya's hunch in his hand. The answer arrives in hours of game time as a dated note with the person's words. A no slows the clock.
- **A season.** One pressure: the agha's barley before the rain (Call), the due at threshing (Take), the winter door (Give), the mill in spring (Call, a work over weeks).
- **Years.** Trust moves slowly and falls fast. People marry, are born, die, and leave for the city. The second hamlet comes under your seal in year two with no history with you. In year three the agha's rider wants men. The term ends at the elders' gathering in the third winter; each elder speaks a line drawn from what happened.
- **Lose.** The due is missed twice, or the elders write to the agha: you are replaced before your term ends.

## The world (host side, `src/sim`)

- Calendar from the first day of the harvest. Weather is pre-rolled from the seed per day, so no input moves later weather.
- Each household has a field (standing, reaped, threshed), a store, mouths, and a share it owes. The agha has his own field (worked by called labour) and a granary. The due is the agha's field plus the households' shares; easing a share is an exemption the other households can see.
- Grain is world truth and may be shown as a number in the agha's ledger only.
- **Numbers (settled 2026-10-19 by the headless measure).** A person eats 0.03 kile a day. Fields are sized to their mouths: after seed (an eighth of a full yield, taken at sowing) and the share (a fifth), the reeve's house keeps about 1.5 years of bread and the builder's about 0.8, so the poor houses come to the door in late winter. Houses nobody lives in full that day reap and sow at a plain pace, so a quiet house still brings its harvest in.
- **The due** is 0.7 of the agha's field (360 kile) plus every share under the seal, less 40 once the mill turns, plus arrears and a loan. A shortfall of up to 5% (at least 8 kile) is written once as arrears against next year; more is a missed year. Two missed years end the term early.
- **The share** is asked of each head until the rider comes. People hold a host-side norm `dues`, keeping an agreed arrangement, as each understands it. It is an engineering assumption with no `research/` source, kept in the game, not in HF.
- **Famine response.** When two houses are scraping the jars and the granary is low, the reeve tells you the agha lends: a loan of 20 to 120 kile arrives in twelve days and is owed with a quarter more at the next rider, once a year. A hungry house is fed a little by a better-off neighbour of its hamlet once a week, if that head is the giving kind (a world rule; HF request 2). A house that was turned away does not knock again for six days.
- **Leaving.** Only the unattached young (17 to 32, unmarried, not the head, not with child) leave for the city, after the first two months, when the house's prospect (store plus field) is under 20 days or trust in the kahya is very low.

## The people (HF 3.0.0, pinned exactly)

- Every resident is an HF `Person` with traits, values, norms, habits, ties to kin and neighbours, trust in the kahya as a voice, a body with the slow fatigue store, and a life course (age, marriage, birth, death, grief).
- The kahya is an HF person too: the observer for hunches, a body that tires on the lanes, and an age.
- An ask is a standing suggestion from the `kahya` voice over a window, weighed at each of the person's own decisions against their own day; the reply is the decision's resolution.

## Performance plan (measured 2026-10-19 on an Apple Silicon Mac, HF 2.7.0)

| Mode                                           | Cost                                                                                      | Use                                                                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Full (`stepCommunity`, minute-level decisions) | about 1.0 ms per person-day at 120 people (2.9 at 10, 1.4 at 40)                          | any household under an open ask, ill, hungry, near a birth, in mourning, visited in the last week, and everyone in harvest and sowing |
| Routine (`routineDay`, closed form)            | about 0.002 ms per person-day                                                             | quiet households, children, deep winter                                                                                               |
| Save size                                      | about 90 KB of JSON per person after a month (memory 42 KB, chronicle bounded to 31 days) | IndexedDB, gzip; never localStorage                                                                                                   |

The mode is chosen per household at each midnight from sim state, never from frame timing. The sim advances in fixed 30-minute quanta in play and replay alike, and inputs apply at quantum boundaries, so a replay of the input log reaches the same fingerprint (keys sorted).

Measured on 2026-10-19, desktop, whole term with a plain bot steward, seed 1, about 50 people (machine lightly loaded): harvest days with 25 or more lived in full 64 to 73 ms per sim-day; threshing with an open share ask 36 to 39; quiet winter and sowing days 4 to 8. That is about 1.5 ms per 30-minute quantum at the worst; phones are assumed 3 to 5 times slower (about 7 ms), which fits a 10 Hz tick on the main thread. A later run under a load average of 18 read four times slower and is not used. A worker is deferred (below) unless phones stutter. The refusal band first measured 46 to 50% not a plain yes at harvest against the 25 to 40% target; the sources were the own-barley commitment, own-field material value and the coffeehouse habit.

**First-morning tuning (2026-10-19).** In the first build everyone slept from 9:00 to 16:00, because the world offered sleep in daylight, so the first replies came at 16:30. Sleep is now offered only in the dark or to someone tired (sleep pressure over 0.65, debt over 0.5 or poor health). The kahya's call is a standing suggestion of strength 0.6 (0.45 gave nearly all deferrals; 0.65 and above nearly all yes). Chat is offered in the field seasons only at the midday break or after dusk. The first two days are cloud and the third is the storm, so the first call has a reason to hurry. Conviction in `dues` is 0.1 + 0.5 × honesty. After this tuning the whole term (seed 1) measured 38% not a plain yes at harvest, inside the band, with every year-one share paid and the replay matching.

**Hunches.** The house card's guess is HF `predictAs` from the kahya's impressions (none at the start: "You can't tell yet") and from the reeve's (seeded: four glimpses of each lower-hamlet person over the last months, clearer for his kin). Neither reads the target's state.

**Progress you can see (polish round 1).** An evening note says how many worked the agha's field and roughly how much still stands; notes mark the granary passing half the due and holding all of it; the main screen says in words how near the granary is to the due and how many days until the rider; the map lays the standing barley over for a week after a storm. These came from the first casual playtester and the HF-character playtester, who both saw only refusals and no progress.

**Iteration 1 after playtest round 1 (2026-10-19).** All four testers said the kahya's own acts were mute. Now one named person of the house answers each visit, gift, seizure and easing at once, in a register read from their traits (blunt, anxious, wry, plain) and about what is true for that house: the jars, a birth, a death, a wedding or someone gone this season, and the strongest thing they remember the kahya doing (a pure read of HF memory, no `recall`). After an easing, another house of the hamlet says what the lanes think the next morning. No line is said twice in the valley within 90 days, and two people do not give the same reply on the same day. Each reply is also a half-clear HF `glimpseOf`, so hunches move with what people say. A paid call is answered as paid. Other changes:
- Winter and quiet stretches have lane life: someone's evening every few days. Faith appears only as one evening walk to the mosque among eight lines.
- The clock does not run faster than slow while a hungry knock is open. An unanswered hungry knock is noted ("waited at your door, and went back down the lane") and costs a little trust. Empty jars are reported once a month per house. A death from hunger says so.
- the reeve explains the granary key when giving first opens. The agha's yearly letter is a note on the crop day. Only one Press button shows per person. Shares say which rider they were for. Empty houses read as shut. The ledger's exit says "Set the seal down for now".
- **Economy.** A household's yield factor is 0.7 to 1.2 (it was 0.55 to 1.15). Baby names are drawn from 16-name pools and never repeat the name of a living person.

**The edges of the office (owner direction 2026-10-19: "keep those edges a bit fun and slightly in our calculations").** Two edge stewards are measured beside the plain and idle ones (`BOT=iron|open node scripts/measure.ts <seed>`). The iron kahya seizes from every unpaid house and turns away every hungry knock. The open hand eases every house and gives 15 kile to every knock. Each edge gets its own ending. The agha raises the iron kahya's stipend, while each house that lost someone to hunger after he was hard with it says "You had the key to the granary". The open hand's letter asks where the barley went, "In the margin you write the names of the houses that ate it". Term tallies live in `stats` (notes are capped at 400).

| Steward, seed 1 (after iteration 2)                                    | Riders                                                              | Deaths (hungry) | Left | Seized / given (kile) |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------- | ---- | --------------------- |
| idle                                                                   | 354 and 467 short, dismissed day 426                                | 0               | 0    | 0 / 0                 |
| plain                                                                  | whole, 64 short; term reached; replay matches                       | 0               | 1    | 2 / 18                |
| iron                                                                   | whole, whole; term reached, stipend raised                          | 10 (10)         | 3    | 15 / 0                |
| open (gives to every knock and to the hungriest house every other day) | 79 and 34 short, dismissed day 791; the reeve's giveaway word twice | 0               | 0    | 0 / 135               |

After iteration 1 the open hand still reached the end of its term, with the rider whole in year one and 120 short in year two, having given 45 kile. Now it gives three times as much, pulls a run on the granary, and is dismissed. It ends with its own letter: the agha "is not a charity", and nobody died hungry. The iron seal is unchanged: paid, praised and remembered for its dead. Both edges are measured on every round (`BOT=iron|open REPLAY=0 node scripts/measure.ts 1`; the `WATCH` line counts forecasts, giveaway words, tallies and grouped press lines over the whole term).

**Iteration 2 after playtest round 2 (2026-10-19).** Round 2 ([docs/playtests/2026-10-19-round2.md](playtests/2026-10-19-round2.md)) scored 5, 6, 6 and 4. The four reports agreed on three things. Lines repeated across houses. Weddings and births were mute. A shortfall could not be read or acted on, and the ledger's granary looked frozen during the harvest. What changed:
- Voices. Visit openers fit the scene (wedding, birth, death) and the visit (a return within ten days says so). Pools are larger, and the elders' lines are larger and sex-neutral. Spouse words follow the speaker. One assent line per ask and day, and one line for the people who came when pressed and will not come again.
- Knocks show from their own hour, not before the event. The wedding knock comes from a house under the seal. Births, weddings and deaths can be declined with regrets, and an unanswered wedding is heard.
- The shortfall. the reeve's forecast 25 days before the rider opens the loan. He gives a weekly tally of what came in. The ledger shows the agha's sheaves and standing barley. The due is recomputed at every rider, and a loan is owed at the first rider four months after it arrives.
- Winter. The mill is in the first winter, with its progress seen. Give opens when any house is short.
- The open-hand edge: the reeve's word, the spring talk, a run on the granary, full houses passing the sack on, its own dismissal letter.
- The kahya's last two acts toward a house are on its card. Roman volume numbers. An explicit early-ending letter. Text fixes.
- Put-offs of one ask on one day are one line too, with a hold-to-press button for each name. Someone who puts it off in the morning and comes by noon is simply in the day's "came" line. Someone who came and then put it off gets their own line.
- The game-design reviewer (Opus, read-only, after round 2) found the biggest first-five-minutes problem: the granary cannot move for 18 days, until the threshing, and the main line said "nowhere near his due" all that time. Two players in two rounds quit there. During the harvest the main line now describes the field: how much of his barley is cut, "Get it cut before the rain" before the first call, and when the sheaves reach the granary. The first harvest evening's tally heads the day. The giveaway word now sums a ten-day gift ledger kept in state, no longer the note text. Houses the open hand fed say so at the end ("The agha lost some barley and we kept our children").
  Replay still matches (seed 1, fingerprint 316dd7c1). The tests run with a 120 s timeout because this machine has run at a load average up to 121 with other agents' builds; HEAD timed the same under that load.

## Notebook export repair (2026-10-20)

The owner's seed 406153184, minute 17550 export loads and replays to its recorded fingerprint `e6948b88`. Sending the full save produced 2,977,030 bytes. The notebook now sends a 981-byte run: game, seed, version, framework, minute, inputs, fingerprint and label. Downloads still include the full state and timestamp. The loader accepts either form and checks a compact replay against its fingerprint. Regression tests reproduce the owner's actions without committing the private full-state file and require a compact run below 5 KB.

Two independent code reviews found one input-aliasing issue in compact loading; the loader now clones inputs, with a regression test. `npm run check` passes all 11 tests. The production build passes. A local browser replay of the owner's file showed the compact run in the notebook preview and sent it through the real gzip client to a local request intercept (981-byte run, 1,065-byte envelope). The download remained 2,977,030 bytes with the same state and fingerprint. No external run was uploaded; the browser reported no page errors. Existing lint warnings remain outside this change's scope.

## Deferred work implemented in the optional October edition

New terms can explicitly include `valley-2026-10`. The title checkbox starts unchecked.
Resume and unmarked exports retain the original rules. The game remains version 0.3.0;
full exports, compact exports, local logs and recovery volumes pin the rules edition.
HF stays exactly 3.0.0. Technical delivery requires independent review, exact CI,
a clean deployment and live verification; external delivery receipts are in
`~/code/.lab-scratch/games-deferred/valley-report.md`.

- Paid mill calls transfer real granary grain only for useful completed carrying,
  at 0.15 grain measures per effective hour, while grain remains. Interrupted work
  earns no pay. One completed activity has one payment receipt. Ordinary mill calls
  remain unpaid. Player-facing costs stay approximate.
- An early harvest forecast opens requests for an extra sack. Existing HF suggestions,
  trust and alternatives decide whether each household carries it. Transfers retain
  food for 180 days and unpaid normal shares. A sack is extra; it does not erase a share.
  A house helped earlier may help meet the shortfall. This is a possible resource
  payoff for the open hand, without guaranteed gratitude or forgiveness.
- Winter petitions can offer a real grain loan from an actual neighbour in HF ties,
  or a granary gift. The stream requires an actual grain knock. The neighbour can
  refuse. Only a transferred sack creates a debt. Harvest repayment is another
  voluntary HF carrying action, with the same real-resource guards.
- During an attended visit, the player can ask about a person, grain debt or grievance.
  Replies use heard words and recorded acts. A topic does not reveal an unspoken secret
  or settle a quarrel. Existing canonical disclosure and bounded visitor rules remain.
- The third-year rider asks for four hours of supply carrying on each of two days.
  A household can refuse. Grain can replace service. If no worker finishes in a week,
  the stated grain cost is added to the due. Actual shifts use HF activities and leave
  less time for the worker's own field.
- A separate grain store conserves sacks. Sending one to a house records the actual gift.
  An inspector asks about remembered steward acts and the account. Opening the store
  returns its grain to the account; refusal or silence adds the stated due. No private
  biography or hidden household total becomes inspector knowledge.
- Recovery volumes are retained locally and can be read from the ledger. They are
  real saved pages. Reading does not rewind state or grant cast ownership. A volume
  beyond a current continuation is labelled as later crossed-out pages; none are
  fabricated from hypothetical play. Identical snapshot bytes share one history key.
- Optional procedural music starts off. Short cues follow consequential notes. It
  uses no server, graphics or game-state randomness.
- The adapter captures a night press's actual next-morning reply during simulation
  steps, including a reply later replaced in the day's notebook. A grouped report
  about earlier pressure is not a new answer. No new cohort was run.
- Existing current notes/history, first goal, phone response sheet and slowdown for
  non-grain knocks were already implemented. This increment preserves them and adds
  focused checks, persistent pending-choice slowdown, focus restoration, stale-render
  callback guards, malformed-log admission and honest browser-save receipts.

## Remaining input and acceptance gates

- Cold first-choice and cue comprehension (DL-6/7/19): needs a new player; new rounds
  are expressly paused in the 2026-10-25 brief. Owner review 2026-11-03. Automated layout
  checks do not establish comprehension.
- Physical-phone keyboard/enlarged-text reachability and performance: the 2026-10-20b
  phone contract asks for a real phone. Controlled Chromium 360×690 with 4× CPU throttling
  measured 96 simulation quanta: median 7.5ms, p95 12.1ms, max 25.1ms, no quantum above 50ms.
  This is a desktop proxy, not proof about a phone. Physical-device review 2026-11-03.
  A Web Worker remains conditional on measured phone stutter; no speculative migration.
- Production compact-notebook acceptance (DL-28): requires the separately authorized
  controlled lab receipt specified in the 2026-10-20 follow-up. Routed to the shared lab
  owner for 2026-11-03. Private owner saves must not be sent. An intercepted receipt is
  not production acceptance.
- GDI065/066 have a new, unreviewed source slice described below. Technical review,
  normal lane, signed delivery and live verification remain engineering gates.
  The 2026-10-26 batch explicitly allows a bounded meeting with a pending outcome;
  this slice does not complete marriages. No missing-guardian rule is invented.
- Adam accepts game feel, difficulty and readiness on 2026-11-03. The existing
  first-goal/short-notebook fixes and new mechanics do not claim that acceptance.
  F-491 retest and F-492/F-465 acceptance stay real gates. Friends and Show HN stay paused.


## Owner UI follow-up (2026-10-20)

The owner could not identify the goal, controls, priority, action renewal, or next season. The follow-up changes presentation only: English dates and essential office terms are projected at render time; saved notes and the simulation remain unchanged. “Your charge” explains the purpose and can be reopened from play. One current task leads above the map, followed by a seasonal forecast. Visible house buttons, focus and hover states, and touch targets separate actions from prose. Current notes are short; history is optional. Active refusals retain visible hold-to-press controls even when their dated notes are hidden. Capacity copy follows actual travel, standing calls, the crop, and the granary, without adding action counters.

The six before/after viewport captures and observed confusion are recorded in [the owner playtest](playtests/owner-2026-10-20.md). This delivery is accepted technically by passing checks, unchanged owner replay fingerprint, and a clean live release matching the signed pushed commit. Adam accepts game feel in the next owner playtest.

## Design change 2026-10-20b (owner may veto)

The phone keeps the current goal, full English date/weather and next seasonal schedule in a state strip above the map. House selection opens one lab-kit 0.2.0 `fit` sheet without scrolling the document. Close and Escape return to the house button. The latest household reply stays above a visible commit row. A labelled action selector replaces the long stack of commands; selecting an action shows its full cost or availability explanation beside the command. About holds the household description, hunches, limits and history. The Game menu uses a native dialog, so its controls cannot cover an active house Close button.

The owner asked “What's clickable? Which text is the important parts since there are too many?” (F-201) and “What comes next?” (F-202; `docs/playtests/owner-2026-10-20.md`). The phone audit at live `4686aab` found the goal, date and schedule offscreen after house selection and Close covered by Game menu. The related cross-game evidence is F-273 (Well: state while ordering) and F-275 (Warren: readable response). This serves DL-22..25 and DL-30..31. Commands still act directly on the chosen household through the existing simulation callbacks (DL-33); this change makes no claim about the first-five-minute agency gap (DL-32).

Cost: changing the selected command takes one extra selection. Optional house context and archived notes may scroll inside the sheet; the immediate house reply and current command do not. The horizontal house chooser deliberately scrolls to preserve scene height; all houses remain selectable on the map and by keyboard. At 200% computed text size the stage uses page flow: complete sentences and controls remain reachable, while the state strip can scroll out of view. This is a documented DL-31 exception for enlarged text, following the first adopter's tradeoff. Follow up on a physical phone by **2026-11-03**, including keyboard-open layout and enlarged text.

Simulation rules, HF 2.8.0 pin, save version and replay edition stay unchanged. The owner export still replays to `e6948b88`; seed 1's eight-day plain policy replays to `eeb8f33b`. Revert this release commit to restore the prior UI and kit 0.1.0. No save migration is needed.

**Round 2 (2026-10-20).** Elif left because she “had to scroll in the middle of his sentence”; her strongest moment was Yusuf saying “I haven’t eaten since yesterday. Don’t tell my wife I told you” (`scratch/patterns/retest/valley.md` in HF). The commuter could not tell whether actions changed anything (F-180), and the strategy player did not know pressing had a cost (F-179). The fit sheet now takes space from the phone map for the whole immediate reply. Harvest cut/standing estimates, the rain deadline and the grain/threshing date stay together in the strip during a call or visit. One current refusal keeps its dated reason, pressure consequence and Hold in the commit area; Other house actions replaces that decision with the alternative selector. Give includes the steward’s existing food estimate; Ease/Seize include the share account. A house offers Visit directly when the seasonal call is unavailable. Phone houses use separate named 44 px targets; Choose a house returns to the full list. Earlier replies carry a full date and an Earlier word label. Visits and gifts open their household’s reply. This serves DL-22..25, DL-30..31 and DL-33. It makes no new DL-32 availability claim.

Round-2 cost: the phone scene gives up geographic placement for a compact labelled house list, and shrinks to the selected house while reading. Other replies, biography and history remain under About. The player still chooses whether to press, visit, give or leave. The simulation, HF 2.8.0 pin and replay edition stay unchanged. To revert round 2 alone, restore `src/ui/app.ts`, `src/ui/presentation.ts`, `src/ui/style.css`, `test/ui.test.ts` and `test/presentation.test.ts` from commit `a5d4c2b781d9e6db3ea24736f89771909216a5b5` with `git restore --source=a5d4c2b781d9e6db3ea24736f89771909216a5b5 --` followed by those paths; remove these two Round-2 paragraphs, run `npm run check`, commit and deploy. Saves need no migration. The physical-phone keyboard/enlarged-text follow-up remains due **2026-11-03**; Adam accepts feel separately.


## Owner speed restoration (2026-10-22)

The original speed choices are restored. Inspection, new-event reading time and menu protections remain. The guarded Until something happens action remains. Simulation inputs, saves and replay rules are unchanged.

## Approved UI sweep (2026-10-22)

Owner: “All good decisions, proceed.” and “Good direction, proceed please, menu is fine. Just "until something happens" is too long, maybe Skip or Fast Forward or something else could be better.”

This supersedes the phone house list, action selectors and main-screen speed controls described above. The phone shows the drawn valley, one sideways house row, current replies and a bottom action bar. House verbs are direct buttons. The ledger and complete notebook are reading sheets. One top-bar i explains the current context, and the menu holds time. Automatic pacing is the default (120 minutes per second during seasonal work, 240 otherwise); Slow, Steady and Fast remain in the menu. The guarded action is labelled “Skip ⏩”. Presentation pacing does not change replay inputs or simulation quanta.

The title shelf loads full saves and compact playtest exports with a fingerprint check. Send word includes an optional remembered tester name, separate linked and consented unlinked paths, and the full run download. The simulation, HF 2.8.0 dependency, historical saves and owner replay fixture are unchanged. Delivery evidence is in the coordinator report `~/code/.lab-scratch/codex/build-valley.md`; Adam accepts the feel after the live rebuild.

## Optional pass and introduction source slice (2026-10-26, not yet delivered)

`valley-pass-2026-10` is a separate, explicitly unchecked new-term option. It includes
October's grain rules. Neither the default term nor `valley-2026-10` upgrades in place.
Full/compact exports and local logs retain the new edition. Native exports preserve
all actors and world facts. The new edition has no reviewed portable source mapping:
it starts local, refuses persona publication and never calls itself `valley-cast-3`.
The SDK pins, recording switch and Feedback semantics stay unchanged.

Çam is an authored adjacent pre-industrial valley over the northern pass. Its public
quarry is a finite world inventory, not a new foreground person or household food
source. The route map shows the residence, pass and quarry. At departure the steward
packs provisions and a barter sack from the actual granary. Arrival occurs after eight
hours of ordinary simulation. Only arrival discloses quarry stock. One carried sack
buys one stone load; bought grain stays in the quarry account. The steward returns
after two days, including eight hours walking home. Unspent barter grain returns to
the granary. Stone stays cargo until return, then can supply a little unfinished mill
work when work is open. No crop, levy, inspection, eating, debt or rider date waits.

Authored engineering costs, not historical measurements: one grain measure of
provisions, six carried for barter, three quarry loads in this term, one load per trip,
and twelve effective mill hours per dressed stone. The mill still needs six hundred
hours in total. The trip is no free supply or skip of HF/world time.

The family introduction uses existing incidental adults: Ali (opening age22) from
Kavak, Esma19 from Kuyucu, and her actual father Omer48 from Kuyucu. Their raw IDs,
names, traits, norms, ages, roles and existing bonds stay unchanged. The six allocated
canonical people receive no invented partner or guardian. Yusuf remains married to
Zehra; her pregnancy remains real. Samira's absent spouse stays a spouse. Meryem's
grandfather relationship is not silently assigned guardian authority. No forty-first
foreground person or sustained incidental personal arc is added.

Each participant can choose an HF invitation offer among ordinary work, food and rest.
A four-hour attendance includes arrival/preparation, two hours in the courtyard, and
return. People wait separately if the father is absent. Only at least ninety minutes
of overlapping completed attendance by both adults and her father creates one released
HF `court` meeting. Interrupted work, refusal or non-overlap creates no meeting.
A message reports the public outcome; private attraction and compatibility stay hidden.
The single bounded introduction ends met/pending or missed. It never creates an
engagement, guardian consent, a proposal acceptance or a marriage. This edition does
not run the older automatic wedding matcher. Existing marriages, pregnancy, births
and deaths remain. Repeated courtship and a completed ceremony are outside this
bounded meeting; a future completed marriage must obtain both adults' actual proposal
choices and the known guardian's actual choice before public `canMarry`/`marry`.

Eligibility uses released `canMarry` with a complete local lookup and an explicit copy
of `MUSLIM_CUSTOM`, plus existing spouse-role references. Sourced provenance is the
released partnering scope and HF `research/marriage-sources.md` §§1–6/10. The age18
and one-spouse thresholds are authored world conventions, not claims about historical
law or a new religious ruling. Existing held conscience understandings are unchanged.
Q33 concerns explicit guardian absence; this slice neither resolves nor bypasses it.
Faith remains quiet.

### Remaining evidence

Technical source controls do not establish felt generosity or game feel. Adam's
acceptance, physical-phone behavior, cold comprehension and the authorized production
notebook receipt remain input gates for2026-11-03. Existing first-goal, short-notebook,
plain4 projections, focus, slowdown and SDK11/12 fixes remain implemented; this slice
adds no duplicate fix or new model/network service. Friends and Show HN remain paused.

## Deferred: bounded Zehra exchange source — 2026-10-26

Select “Questions for Zehra” in the visit-version chooser and check the otherwise
unchecked spoken-answer option to use `valley-dialogue-2026-10`. Selecting a version
alone enables nothing. This edition uses the replies edition's local
people and original grain rules. It adds no October, pass or alliance mechanics.
Original 0.3.0, October, pass, replies and alliance histories retain their own rules.
Their old reply command and words remain unchanged. This source batch is not a release.

`src/sim/dialogue.ts` owns one authored scene. The actor is registry id `zehra`,
currently a member of the Çoban household; name equality never selects the actor.
An attended current visit, awake living presence at that house and an already public
specific reply or voice record are required. The two lines quote that record or
explain the current real harvest request against the already public 20 July warning.
The work line requires an open harvest ask that actually includes her. The scene
reveals no private body, household stock, prediction or new family secret.

Speech is logged once per numbered input. Pending hearing waits for ordinary actor
catch-up. A public HF heard percept is delivered through `perceive` at her actual
clock; returned attention and actual matching memory times are retained separately.
This explicit host queue does not invoke automatic conversation or add the steward
to the resident community. It does not wake or interrupt her to obtain an answer.
A five-minute ordinary resident offer competes with the normal body, prayer and work
alternatives. HF owns decide, begin, duration rounding, reviews, interruption and finish.
There is no second steward suggestion that could be confused with the real work ask.
Only a completed matching activity inside the visit can produce the authored outward
answer, including “It is not a promise to leave my work.” Talk consumes actual time.
It grants no resources, work credit, obligation or scalar trust adjustment.

The work result retains her actual existing reply as existing. A later real reply and
matching current activity/useful hours are separate evidence. Talking alone leaves
the work request pending. No sentence guarantees compliance, travel or arrival.
Withholding permits a fresh explicit input only while presence and visit guards still
hold. Cancellation retains history and elapsed time and cannot produce an answer.
Full and compact saves pin the edition and retain scene receipts and complete native
people, world, queues and RNG. New full files replay into a detached game and compare
every state value and accepted input before installation. Bound recovery validates the
scene configuration; it does not obtain an external continuing-person claim.

The fixed seed-7 ordinary control reached speech, attended hearing and a different
ordinary choice at actor minute 1114. It retained a withheld answer. The next public
step found Zehra asleep. The work-line and cancellation forks use the same public
scene; no traits, body, RNG or clocks were assigned. Completed/running talk, interrupted
running talk and completed-answer replay remain unproved in this control. No seed search
or player/model round supplies acceptance. Pending, withheld, cancelled and continued
native full/compact equality are the tested facets. All five old configurations have
one seed-7 raw all-field before/after fixture comparison, including continuations.

Remaining engineering disposition is due 2026-10-27: independently review this source
and its negative control; establish or reject the naturally completed talk facet;
Yusuf/birth, Tepe/son, Danyal/Maryam and other people remain open. Mutual future help
requires lawful terms, actual resources and separate voluntary choices; no bargain is
implemented. Harvest forecasts, Skip/pacing, named reply grouping and arbitrary grain
amount selection remain separate open clauses. No whole frozen-34 or original-20 ask
set is closed. The f711 grain blocker collection remains additional R1, not a fixed-build
retest. The newer-deploy hold remains active. Existing reading, travel, focus, hold,
gift receipts and preview guards are preserved.

The batch ends with source and native evidence ready for one independent review.
Technical delivery still requires authorized signed source, exact green CI and a clean
matching release with browser verification. Actual existing-Chrome local verification
is a gap in this batch. Adam accepts feel separately; owner/device and cold-player
input remain due 2026-11-03 where previously assigned. These are separate gates, not a
blanket owner block on remaining engineering.

## Deferred after the second same-tester retest (2026-10-27)

Round retests-1027b played live `efdb940` (0.3.1) with the same 14 testers ([playtest](playtests/2026-10-27-retest2.md)). Verdict: **finished** under the two-iteration rule (3 keep, 11 mixed, 0 quit). Every remaining ask is deferred here.

- F-1575 (retests-1027b, would have blocked): without the spoken-answers tick a visit has no Say and nothing says so; menu New game skips the title page (Nia only). Target 2026-11-03.
- F-1576 (retests-1027b, would have blocked): Zehra never speaks to the player in either version; show which gate is closed on her card. Target 2026-11-03.
- F-1591 (retests-1027b, would have blocked): name one household and a reason after the barley is cut. Target 2026-11-10.
- F-1294 (with F-1118, F-1172, F-1286; retests-1027b): the phone notebook shows two to four lines after the call; replies, results and buttons sit below the fold. Target 2026-11-03.
- F-1288 (with F-1309, F-1312; retests-1027b): one fixed saying when the call is not open; show gated sayings greyed with the reason and add a line that fits the visit. Target 2026-11-10.
- F-1162 (retests-1027b): the ledger and header keep "Rain is expected on 20 July" on the storm day and show no storm loss. Target 2026-11-03.
- F-1316 (with F-1121, F-1134, F-1136; retests-1027b): walks and visits are idle waits; let Skip finish them. Target 2026-11-10.
- F-1115 (retests-1027b): the same delay line repeats. Target 2026-11-10.
- F-1139 (retests-1027b): replies come from "Someone from the … house" with no name. Target 2026-11-10.
- F-1292 (retests-1027b): name the people who came to cut. Target 2026-11-10.
- F-1123 (retests-1027b): show key facts, such as a new mother, before pressing. Target 2026-11-10.
- F-1124 (retests-1027b): exact numbers in the ledger. Target 2026-11-10.
- F-1319 (retests-1027b): the grain confirmation does not show what will remain. Target 2026-11-10.
- F-1577 (retests-1027b): explain "your guess" on the rain-guess line; it looks like a control. Target 2026-11-10.
- F-1578 (retests-1027b): group buttons change names and order as replies arrive. Target 2026-11-10.
- F-1579 (retests-1027b): the came/delayed count changes without a reason. Target 2026-11-10.
- F-1580 (retests-1027b): add "Let them finish first" to the household page. Target 2026-11-10.
- F-1581 (retests-1027b): phone Cancel on the grain confirmation sits under the footer. Target 2026-11-10.
- F-1582 (retests-1027b): desktop map labels overlap near the residence; the house row is cut off. Target 2026-11-10.
- F-1583 (retests-1027b): record Yusuf's promise to repay the grain. Target 2026-11-10.
- F-1584 (retests-1027b): give the reason at Visit and Call when they are grey during a visit. Target 2026-11-10.
- F-1585 (retests-1027b): say why the call stays open to 24 July when rain is due on 20 July. Target 2026-11-10.
- F-1586 (retests-1027b): explain the other title-page options. Target 2026-11-10.
- F-1587 (retests-1027b): show Say from the notebook during a visit and mark a pending answer. Target 2026-11-10.
- F-1588 (retests-1027b): the clock line gives the wrong reason in some views. Target 2026-11-10.
- F-1589 (retests-1027b): give each "Let them finish first" button its group in the label. Target 2026-11-10.
- F-1590 (retests-1027b): say plainly that the saved place is kept. Target 2026-11-10.

## Public term candidate — 2026-10-27

The owner abolished gameplay flags after the rounds quoted above. New terms now use
`valley-public-2026-10`. All existing host mechanics are public together: household
sayings and the bounded Zehra exchange, October grain rules, pass journeys, family
arrangements and the road agreement. This is a new replay edition. No old-edition
constructor changes. Its full/compact replay and local-log admission preserve the
combined state; bound recovery rejects missing public state slices.

F-1575: no spoken-answer tick remains. Menu New game returns to the title and retains
the previous save until the player confirms replacement. F-1586's obsolete title-option
confusion is removed with those options. F-1319: the gift confirmation states the
granary remainder before any returned grain. The transfer and its later receipt are
unchanged. The other retest clauses above remain separate work.

HF stays at 3.0.0. The public edition stays local under Valley's cast-region exclusion.
The missing contract is a reviewed `prepareCastStart`/`calendarPassport`/`checkpointReceipt`
portable dialect for local cast plus steward provisions, journeys, family/road state
and dialogue receipts; the original `HOST_RULES` passport does not define that mapping.
Compatible original/October worlds attempt same-person carryover automatically.
Person controls belong to the central shelf; this host mounts none. Diagnostic download,
seed and import controls are collapsed in Debug beside Lab privacy. No vendor changes.

This candidate ends at the independent director review gate before commit. Technical
delivery and live verification remain required after CLEAR. Adam accepts feel and
readiness on 2026-11-03. No panel, round or retest is part of this work.


## Current scene and household reply context — 2026-10-27

This is a bounded source candidate. Remaining: director independent review, exact signed
source and green CI, root merge, clean live release and cleanup. Adam accepts feel separately.
The notebook/Say/pace batch is already delivered at `0dfe3a4`; canonical `/file/` routing
is already delivered at `f2afaf3`. Earlier dated candidate and deployment-hold paragraphs
above describe their own batches. They do not undo those delivery receipts.

The current scene projection quotes only retained outward words at or before the current
minute. Zehra is selected by actual id and household membership. Her card explains the
existing saved-term, walking, departed, sleeping, absent, short-visit and pending-question
gates. It does not say she asked a question merely because the player has an available
question to ask. After the field is cut, the notebook names her actual household and links
to her earlier words. This does not invent a new need or claim a new conversation.

Reply groups keep their call and household identity instead of sorting by latest reply
hour. People with different words remain separately attributed within their household.
Acceptance labels name the household and call; the household's own page also offers
acceptance. The count distinguishes voluntary agreement, answers under pressure, delayed, refused,
partial and unanswered.
An agreement is not arrival evidence. A later answer may change the count. Accepting a
reply without pressing neither moves its speaker nor promises future work.

Cancel discards the pending grain command and invalidates its old confirmation callback.
It does not undo earlier gifts. The existing dialogue cancel prevents a pending question
from producing an answer. Earlier earned events and time remain. The title explicitly
says the saved place is kept. Failed-save messages still report failure. There is no new
input, edition, feature switch or simulation interpretation in this presentation batch.

Literal scope uses the retests-1027b source-local F-numbers and the reconciled GDR
rows. These are not claims about central ledger identity. F-1576/GDR-0034 closed reasons; F-1591/GDR-0035 a post-cut named-household
lead only; F-1578/GDR-0047 stable group identity; F-1579/GDR-0048 answer-count explanation;
F-1580/GDR-0049 household acceptance; F-1589/GDR-0058 named acceptance controls;
F-1590/GDR-0059 saved-place wording. Cancel evidence qualifies F-1581/GDR-0050 command
invalidation only; it does not close the separate footer-layout ask. F-1584/GDR-0053
keeps the existing actual Call/Visit gate explanations and adds scene context; no new
travel permission is created. These are engineering dispositions, not player acceptance.

### Exact next scene work

The next engineering unit is one explicit recorded Zehra follow-up tied to the current
attended visit, an actual source-note id and the current completed-cut or birth event.
Use `src/sim/dialogue.ts` for the authored source and answer; `src/sim/game.ts` for its
public action; `src/ui/local-log.ts` for semantic admission; `src/ui/app.ts` for selection;
`test/dialogue.test.ts` for one ordinary causal schedule and full/compact/1440-minute
continuation; `test/ui.test.ts` for the same App path. Add fields only when the explicit
new action is accepted, so every old no-new-input continuation stays exact. Do not
silently change the current follow-up answer. Keep actual HF hearing, choice, timed
activity and completion, with unavailable/withheld/interrupted outcomes. Target 2026-10-29.
A naturally completed new answer is still unproved. No generic answer or forced meeting
may substitute for it. F-1288/F-1309/F-1312 and GDI-1159/1178/1181/1192/1217/1220 remain
open for those specific contextual exchanges. Yusuf/birth, Tepe/son and Danyal/Maryam
remain distinct later units under GDI-1027/F-1155, not one conversation rewrite.

Named group identity does not give unnamed residents new identities. F-1139 remains
open; choose roles from actual local people and retained outward sources, not fabricated
canonical identities. F-1292's named actual cutters still needs a projection of useful
work/activity, not the agreed count. F-1583's grain-repayment words need an explicit
record of the actual promise and terms before any new debt. Forecast/storm accounting,
travel Skip, arbitrary gift amounts, per-person exemption and remaining physical layout
asks remain engineering work with their own source units, targeted 2026-10-30.

### Portable local-edition mapping remains separate engineering

Supported current receiver pairs in `src/sim/passport.ts` are Well/Watch `site-cast/1`
with `site-cast-calendar/1` and the exact listed source-role/cast-id pairs, and Valley
`valley-cast/1` with `valley-calendar/1`. Receiver engine dialects are 2.17.0, 2.21.0 and
2.23.0. Each still requires identity/revision, source checkpoint schema/minute/RNG/SHA256,
trusted norm meanings, mapped skills/actions and lawful continuing worship commitments.
Care/work/owed duties without an equivalent handover and unknown dialects are refused.
These are supported source contracts, not fresh journey receipts from this batch.

The canonical native header is `HOST_RULES = valley-cast-3`. A checkpoint source stamp
is `{game: valley, build, engine: 2.23.0, rules: valley-cast-3}`. Its transfer fields are
`castPassport`, `sourceRole`, `hostRun`, `person`, `checkpoint` and `life`. Ownership uses
actual `castId`, `castRevision`, `branchId`, `parentRevision`, claims and local `runId`;
file-imported receipts remain archive provenance. The local/public native export instead
pins its actual rules edition and retains the whole Valley state, people, RNG, inputs,
histories, recording and source archives. It has no reviewed portable counterpart for
local cast roles plus steward provisions, pass journeys, family/road state and dialogue.
`CastSession.stamps`, fresh carryover and checkpoint publication refuse that mapping;
full native file play remains supported. Never stamp this local world `valley-cast-3`
or remove world state to obtain admission.

Next mapping unit, target 2026-10-30: inventory exact local producer roles and source
calendar/body/world fields in `src/sim/people.ts`, `src/sim/edition.ts`,
`src/sim/passport.ts` and `src/ui/cast-session.ts`; specify a named new native dialect,
its lossless retained source archive and owner/receiver binding; prove one genuinely
supported producer/receiver pair or retain an exact refusal for the missing binding.
Do not enable public carryover before that contract exists. This is an engineering gap,
not an owner-input deferral. File-only isolation and current archive capacity stay intact.


## Explicit completed-cut Zehra follow-up candidate — 2026-10-27

This implements the completed-cut route of “Exact next scene work” above. It is a
source candidate awaiting root's single independent review; no technical delivery or
Adam/player acceptance is claimed. The older “naturally completed talk unproved” notes
remain the evidence for those earlier batches, not for this new action.

The deliberately chosen `dialogue` line `after-cut` is public wherever the existing
Zehra dialogue world is playable. It introduces no game edition, feature switch or
faculty default. Both older lines keep their exact words, costs and continuations.
Its scope comment in `src/sim/dialogue.ts` defines one finite authored exchange. There
can be one accepted after-cut request per harvest, including a request later withdrawn.
The player needs a retained Zehra note saying “Who will feed my family while I cut his
barley?”, the current-year `cut-N` marker, at most0.5 standing, and the ordinary attended
visit/presence/awake/five-minute gates. A visit does not force her to talk.

Only acceptance adds `Exchange.cut`: kind `valley-cut-request/1`, zero-based accepted
input index, actual request minute, host cut marker, current standing/reaped grain and
the complete retained source Note. This records what was known and asked now. There is
no historical completion id/time to backfill. UI shows the dated source and request,
says that the cut time was not recorded, and keeps current household food unknown.
Full native admission regenerates every state value from actual deterministic inputs,
including this anchor at the request. It rejects missing activation, mismatched source
copies, edited historical or current-world values and unsupported nested fields before
installation. Compact replay regenerates the same complete game. Local recovery always
replays these worlds instead of trusting editable volume contents or their digest.
A later legitimate world change need not equal historical field facts.

The new question offers a seated five-minute talk with effort0 and the existing small
belonging/leisure advertisements (0.12/0.06). These are host action assumptions, not
Person edits or guaranteed selection. Existing body, care, work, prayer and other
alternatives still compete. Nothing wakes her, overwrites a decision or forces a winning
actor. Hearing, attention, HF selection, actual start and completion remain distinct.
The authored answer interprets the actual food/work question conditionally; it claims
neither that she cut barley nor that the household lacks food. It gives no food, debt,
work credit, permission, scalar trust benefit, safety benefit or divine credit.

One causal seed7 schedule: call every lower household at420; ordinary visit to Çoban
at6210; arrive6230; ask6240; attended hearing6240; HF starts6277, finishes6282. The host
had already reached standing0 and `cut-1` by5760; the request does not call5760 the
completion time. Source note6 was actually recorded at994. The actual invitation present
in this world is acknowledged by the ordinary visit under existing rules; no birth fact
or new birth route is authored here. Source-backed answer text is visible in the actual
App at360x690 and1280x800 after loading the same attended public-native scene through
canonical `/file/`. Both use real SDK artifacts and block external traffic. No live owner
game actions, model/provider call, Submit, panel or retest occurs.

Native controls cover full/compact replay, exact1440-minute continuation, unavailable
before-cut, a real HF withholding at6000, accepted-then-cancelled request, forged/missing
activation and source/history refusal, and a later real grain gift. The premature
interrupted-resolution guard uses a naturally produced sibling activity; it is not
presented as a real public interrupted run. The App refuses a forged reaped value and
keeps the held world's complete state/input/source values before a legitimate reload
and continuation. Existing menu binding advances volume labels and save timestamps;
those presentation metadata are stated separately from literal run data.

Raw pre-edit full/compact and actual1440-minute continuations for original, October,
pass, alliance, replies, dialogue and public worlds remain exact. No new input means
no new fields in old saves. Native source archives and caps stay intact. The actual
production checkpoint guard refuses this local world instead of stamping it with
`valley-cast-3`; supported older producer/receiver contracts remain unchanged. This
adds no source ownership, ingestion or receipt acknowledgment claim.

Remaining broader contextual exchanges in F-1288/F-1309/F-1312 and
GDI-1159/1178/1181/1192/1217/1220 stay open beyond this one cut/food question.
Reciprocal help, Yusuf/birth, Tepe/son, Danyal/Maryam and portable local physical/source
mapping remain separate available engineering work at their existing dated targets.
No whole ask set or game is complete. Root accepts the technical handback; Adam accepts
feel separately. No next scene unit belongs to this candidate.
