# Plain English

Write full sentences with articles and verbs. Labels may be short.
Say literally what happens. Name each thing consistently.
Explain a game term when it first appears. Introduce one new idea at a time.
Use common words for instructions. Aim for grade 7 reading, without claiming a measured grade.
Dialogue may be richer, but it must remain grammatical.
State uncertainty clearly. Say whose estimate it is and when they saw it.
Cut words the player does not need.

Keep the Valley’s Turkish setting, person/place names, tone, rules and difficulty. Render common Turkish nouns in plain English. At most two flavour words may remain, each explained within its first sentence. Keep faith a quiet background detail, using HF research wording. Preserve stored simulation and replay strings through display projections.

The frozen source checker flags possible fragments, long sentences and game terms. Its counts include internal, diagnostic and legacy text. Review its findings manually. A lower count is not proof that a screen is clear.

## Source rewrite, 2026-10-25

Player prose now lives in the story and UI sources. Do not add sentence lookup tables.
`englishText` only glosses terms in preserved HF labels, summaries and older saved text.
`rememberedLine` maps rewritten dialogue to its original saved repetition identity. Those
legacy strings are state keys, not display replacements. Keep them stable when editing copy.

For this delivery, done means a signed main commit, exact green CI, deployment through
`npm run deploy`, a clean matching live release, and the external Valley report. Adam
accepts game feel separately. The requested independent review and automated reading/layout
checks are technical evidence, not owner acceptance.

`node scripts/plain-english-proof.mjs SEED POLICY OUTPUT_DIRECTORY` runs a full term,
compares daily mechanics and cumulative input hashes with the pre-rewrite baseline, and
checks full-save restore and compact-export replay. Policies are idle, plain, iron and open.
The baseline uses seeds 7, 42 and 1001. Only listed prose fields are blanked; HF people,
activity labels, reply reasons, repetition keys, numbers and all other state remain hashed.
Older compact exports can fail the prose fingerprint check. The error tells the player to
start a new game. Current full and compact exports must still replay.
