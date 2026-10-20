# The Valley: design

**One line.** The agha lives in the city. You are his kahya, his steward in a valley of two hamlets, with his seal, his ledger and his granary, and no kin here. The last kahya left in the night. Three pages are cut from his ledger. The agha's due is fixed; the weather is not. Every household can say no.

**Done for version 1** (set 2026-10-19 by the coordinator's brief; the owner, Adam, accepts feel separately): one three-year term that can be played to its end at the elders' gathering, live at https://valley.adamwhite.work, with an in-fiction save, a playtest export that replays to the same fingerprint, tests, a headless measure that holds the refusal band below, `npm run check`, and at least two polish rounds with four or more source-unread playtesters recorded verbatim in `docs/playtests/`.

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
3. **The kahya's read is approximate.** Hunches come from HF `predictAs` with the kahya as observer: words, with how sure you are. A visit refreshes them (HF `glimpseOf`). The reeve's hunches come from his own impressions, which favour his kin.
4. **Replies have reasons in the person's words.** HF `says`, filtered: no lens vocabulary, no generic line where it is wrong (The Pass, owner playtest).
5. **Insisting is offered only on a no.** Press and hold to insist; it brings compliance under protest and costs trust through HF.
6. **Continuous time, slowdown, not pause.** The clock runs fast through quiet days and slows by itself when a reply or a knock arrives; the player has three speeds.
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
- **Numbers (settled 2026-10-19 by the headless measure).** A person eats 0.03 kile a day. Fields are sized to their mouths: after seed (an eighth of a full yield, taken at sowing) and the share (a fifth), the reeve's house keeps about 1.5 years of bread and the shepherd's about 0.8, so the poor houses come to the door in late winter. Houses nobody lives in full that day reap and sow at a plain pace, so a quiet house still brings its harvest in.
- **The due** is 0.7 of the agha's field (360 kile) plus every share under the seal, less 40 once the mill turns, plus arrears and a loan. A shortfall of up to 5% (at least 8 kile) is written once as arrears against next year; more is a missed year. Two missed years end the term early.
- **The share** is asked of each head until the rider comes. People hold a host-side norm `dues`, keeping an agreed arrangement, as each understands it. It is an engineering assumption with no `research/` source, kept in the game, not in HF.
- **Famine response.** When two houses are scraping the jars and the granary is low, the reeve tells you the agha lends: a loan of 20 to 120 kile arrives in twelve days and is owed with a quarter more at the next rider, once a year. A hungry house is fed a little by a better-off neighbour of its hamlet once a week, if that head is the giving kind (a world rule; HF request 2). A house that was turned away does not knock again for six days.
- **Leaving.** Only the unattached young (17 to 32, unmarried, not the head, not with child) leave for the city, after the first two months, when the house's prospect (store plus field) is under 20 days or trust in the kahya is very low.

## The people (HF 2.8.0, pinned exactly)
- Every resident is an HF `Person` with traits, values, norms, habits, ties to kin and neighbours, trust in the kahya as a voice, a body with the slow fatigue store, and a life course (age, marriage, birth, death, grief).
- The kahya is an HF person too: the observer for hunches, a body that tires on the lanes, and an age.
- An ask is a standing suggestion from the `kahya` voice over a window, weighed at each of the person's own decisions against their own day; the reply is the decision's resolution.

## Performance plan (measured 2026-10-19 on an Apple Silicon Mac, HF 2.7.0)
| Mode | Cost | Use |
|---|---|---|
| Full (`stepCommunity`, minute-level decisions) | about 1.0 ms per person-day at 120 people (2.9 at 10, 1.4 at 40) | any household under an open ask, ill, hungry, near a birth, in mourning, visited in the last week, and everyone in harvest and sowing |
| Routine (`routineDay`, closed form) | about 0.002 ms per person-day | quiet households, children, deep winter |
| Save size | about 90 KB of JSON per person after a month (memory 42 KB, chronicle bounded to 31 days) | IndexedDB, gzip; never localStorage |

The mode is chosen per household at each midnight from sim state, never from frame timing. The sim advances in fixed 30-minute quanta in play and replay alike, and inputs apply at quantum boundaries, so a replay of the input log reaches the same fingerprint (keys sorted).

Measured on 2026-10-19, desktop, whole term with a plain bot steward, seed 1, about 50 people (machine lightly loaded): harvest days with 25 or more lived in full 64 to 73 ms per sim-day; threshing with an open share ask 36 to 39; quiet winter and sowing days 4 to 8. That is about 1.5 ms per 30-minute quantum at the worst; phones are assumed 3 to 5 times slower (about 7 ms), which fits a 10 Hz tick on the main thread. A later run under a load average of 18 read four times slower and is not used. A worker is deferred (below) unless phones stutter. The refusal band first measured 46 to 50% not a plain yes at harvest against the 25 to 40% target; the sources were the own-barley commitment, own-field material value and the coffeehouse habit.

**First-morning tuning (2026-10-19).** In the first build everyone slept from 9:00 to 16:00, because the world offered sleep in daylight, so the first replies came at 16:30. Sleep is now offered only in the dark or to someone tired (sleep pressure over 0.65, debt over 0.5 or poor health). The kahya's call is a standing suggestion of strength 0.6 (0.45 gave nearly all deferrals; 0.65 and above nearly all yes). Chat is offered in the field seasons only at the midday break or after dusk. The first two days are cloud and the third is the storm, so the first call has a reason to hurry. Conviction in `dues` is 0.1 + 0.5 × honesty. After this tuning the whole term (seed 1) measured 38% not a plain yes at harvest, inside the band, with every year-one share paid and the replay matching.

**Hunches.** The house card's guess is HF `predictAs` from the kahya's impressions (none at the start: "You can't tell yet") and from Osman's (seeded: four glimpses of each lower-hamlet person over the last months, clearer for his kin). Neither reads the target's state.

**Progress you can see (polish round 1).** An evening note says how many worked the agha's field and roughly how much still stands; notes mark the granary passing half the due and holding all of it; the main screen says in words how near the granary is to the due and how many days until the rider; the map lays the standing barley over for a week after a storm. These came from the first casual playtester and the HF-character playtester, who both saw only refusals and no progress.

**Iteration 1 after playtest round 1 (2026-10-19).** All four testers said the kahya's own acts were mute. Now one named person of the house answers each visit, gift, seizure and easing at once, in a register read from their traits (blunt, anxious, wry, plain) and about what is true for that house: the jars, a birth, a death, a wedding or someone gone this season, and the strongest thing they remember the kahya doing (a pure read of HF memory, no `recall`). After an easing, another house of the hamlet says what the lanes think the next morning. No line is said twice in the valley within 90 days, and two people do not give the same reply on the same day. Each reply is also a half-clear HF `glimpseOf`, so hunches move with what people say. A paid call is answered as paid. Other changes:
- Winter and quiet stretches have lane life: someone's evening every few days. Faith appears only as one evening walk to the mosque among eight lines.
- The clock does not run faster than slow while a hungry knock is open. An unanswered hungry knock is noted ("waited at your door, and went back down the lane") and costs a little trust. Empty jars are reported once a month per house. A death from hunger says so.
- Osman explains the granary key when giving first opens. The agha's yearly letter is a note on the crop day. Only one Press button shows per person. Shares say which rider they were for. Empty houses read as shut. The ledger's exit says "Set the seal down for now".
- **Economy.** A household's yield factor is 0.7 to 1.2 (it was 0.55 to 1.15). Baby names are drawn from 16-name pools and never repeat the name of a living person.

**The edges of the office (owner direction 2026-10-19: "keep those edges a bit fun and slightly in our calculations").** Two edge stewards are measured beside the plain and idle ones (`BOT=iron|open node scripts/measure.ts <seed>`). The iron kahya seizes from every unpaid house and turns away every hungry knock. The open hand eases every house and gives 15 kile to every knock. Each edge gets its own ending. The agha raises the iron kahya's stipend, while each house that lost someone to hunger after he was hard with it says "You had the key to the granary". The open hand's letter asks where the barley went, "In the margin you write the names of the houses that ate it". Term tallies live in `stats` (notes are capped at 400).

| Steward, seed 1 (after iteration 2) | Riders | Deaths (hungry) | Left | Seized / given (kile) |
|---|---|---|---|---|
| idle | 354 and 467 short, dismissed day 426 | 0 | 0 | 0 / 0 |
| plain | whole, 64 short; term reached; replay matches | 0 | 1 | 2 / 18 |
| iron | whole, whole; term reached, stipend raised | 10 (10) | 3 | 15 / 0 |
| open (gives to every knock and to the hungriest house every other day) | 79 and 34 short, dismissed day 791; Osman's giveaway word twice | 0 | 0 | 0 / 135 |

After iteration 1 the open hand still reached the end of its term, with the rider whole in year one and 120 short in year two, having given 45 kile. Now it gives three times as much, pulls a run on the granary, and is dismissed. It ends with its own letter: the agha "is not a charity", and nobody died hungry. The iron seal is unchanged: paid, praised and remembered for its dead. Both edges are measured on every round (`BOT=iron|open REPLAY=0 node scripts/measure.ts 1`; the `WATCH` line counts forecasts, giveaway words, tallies and grouped press lines over the whole term).

**Iteration 2 after playtest round 2 (2026-10-19).** Round 2 ([docs/playtests/2026-10-19-round2.md](playtests/2026-10-19-round2.md)) scored 5, 6, 6 and 4. The four reports agreed on three things. Lines repeated across houses. Weddings and births were mute. A shortfall could not be read or acted on, and the ledger's granary looked frozen during the harvest. What changed:
- Voices. Visit openers fit the scene (wedding, birth, death) and the visit (a return within ten days says so). Pools are larger, and the elders' lines are larger and sex-neutral. Spouse words follow the speaker. One assent line per ask and day, and one line for the people who came when pressed and will not come again.
- Knocks show from their own hour, not before the event. The wedding knock comes from a house under the seal. Births, weddings and deaths can be declined with regrets, and an unanswered wedding is heard.
- The shortfall. Osman's forecast 25 days before the rider opens the loan. He gives a weekly tally of what came in. The ledger shows the agha's sheaves and standing barley. The due is recomputed at every rider, and a loan is owed at the first rider four months after it arrives.
- Winter. The mill is in the first winter, with its progress seen. Give opens when any house is short.
- The open-hand edge: Osman's word, the spring talk, a run on the granary, full houses passing the sack on, its own dismissal letter.
- The kahya's last two acts toward a house are on its card. Roman volume numbers. An explicit early-ending letter. Text fixes.
- Put-offs of one ask on one day are one line too, with a hold-to-press button for each name. Someone who puts it off in the morning and comes by noon is simply in the day's "came" line. Someone who came and then put it off gets their own line.
- The game-design reviewer (Opus, read-only, after round 2) found the biggest first-five-minutes problem: the granary cannot move for 18 days, until the threshing, and the main line said "nowhere near his due" all that time. Two players in two rounds quit there. During the harvest the main line now describes the field: how much of his barley is cut, "Get it cut before the rain" before the first call, and when the sheaves reach the granary. The first harvest evening's tally heads the day. The giveaway word now sums a ten-day gift ledger kept in state, no longer the note text. Houses the open hand fed say so at the end ("The agha lost some barley and we kept our children").
Replay still matches (seed 1, fingerprint 316dd7c1). The tests run with a 120 s timeout because this machine has run at a load average up to 121 with other agents' builds; HEAD timed the same under that load.

## Deferred (targets)
- The sim in a Web Worker: only if a phone measure shows stutter; decide by 2026-10-22.
- The forecast's lever: Osman's forecast should come while barley still stands and offer something besides the loan (an early sack from houses with full jars, which they can refuse or resent). The reviewer called the loan alone a debt trap: round 3. Reassess deeper gameplay on 2026-11-03; outside the owner UI follow-up.
- A winter decision stream: disputes or debts between two houses, drawn from HF ties, brought to the kahya as two-option knocks: version 1.1. Reassess deeper gameplay on 2026-11-03; outside the owner UI follow-up.
- A shorter notebook on phones: delivered in the owner UI follow-up, 2026-10-20; current notes lead and history opens on request. Owner acceptance remains the next playtest.
- The Valley's HF playtester adapter: a press sent at night should be answered by the next morning's reply, and the grouped pressed line should not count as an answer. Fix in `scripts/hf-playtest.ts` by 2026-10-21.
- A one-line first goal on the map screen: delivered in the owner UI follow-up, 2026-10-20, with an always-reachable charge and seasonal forecast. Owner acceptance remains the next playtest.
- Conversation the player steers at a hearth (asking about a person, a debt, a grievance): version 1.1. Reassess deeper gameplay on 2026-11-03; outside the owner UI follow-up.
- The open hand's payoff inside the fiction beyond its letter (the valley carrying part of the shortfall for a kahya it trusts): judge after the owner's first play. Reassess deeper gameplay on 2026-11-03; outside the owner UI follow-up.
- Ledger volumes to turn back to (an abandoned future kept as crossed-out ink): polish round 2 (2026-10-21).
- The year-three levy (the agha's rider wants men): version 1.1, after the polish rounds. Reassess deeper gameplay on 2026-11-03; outside the owner UI follow-up.
- Brokering marriages and one neighbouring valley over the pass: version 2, after the owner's first play. Reassess deeper gameplay on 2026-11-03; outside the owner UI follow-up.
- Drama-gated music in the spirit of Old World: after the first polish round (2026-10-22).
- Hidden grain and an inspector who asks the village what it remembers (the wildcard's ledger idea): version 2. Reassess deeper gameplay on 2026-11-03; outside the owner UI follow-up.

## Owner UI follow-up (2026-10-20)

The owner could not identify the goal, controls, priority, action renewal, or next season. The follow-up changes presentation only: English dates and essential office terms are projected at render time; saved notes and the simulation remain unchanged. “Your charge” explains the purpose and can be reopened from play. One current task leads above the map, followed by a seasonal forecast. Visible house buttons, focus and hover states, and touch targets separate actions from prose. Current notes are short; history is optional. Active refusals retain visible hold-to-press controls even when their dated notes are hidden. Capacity copy follows actual travel, standing calls, the crop, and the granary, without adding action counters.

The six before/after viewport captures and observed confusion are recorded in [the owner playtest](playtests/owner-2026-10-20.md). This delivery is accepted technically by passing checks, unchanged owner replay fingerprint, and a clean live release matching the signed pushed commit. Adam accepts game feel in the next owner playtest.
