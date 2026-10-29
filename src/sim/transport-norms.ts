/** Site2.18/d3c7739 trusted dialect meanings. Imported portable norms must match these exact definitions. */
import { DEFAULT_NORMS, type SourcedNorm } from '@adam0white/human-framework';

// Host provenance is explicit; matching source norms must have the same full definition.
const authored =
  (author: string) =>
  (n: Omit<SourcedNorm, 'provenance' | 'exemptions'>): SourcedNorm => ({
    ...n,
    provenance: { kind: 'authored-world', author, ruleId: n.id, edition: 'site-2.18-d3c7739' },
    exemptions: [],
  });
export const WELL_CAST_NORMS: SourcedNorm[] = (
  [
    {
      id: 'aid-injured',
      label: 'Help the injured',
      standing: 'obligatory',
      sources: [
        { kind: 'assumption', ref: 'Twice at the Well host norm; standing chosen by the game design' },
      ],
    },
    {
      id: 'feed-village',
      label: 'Feed the village',
      standing: 'obligatory',
      sources: [
        {
          kind: 'assumption',
          ref: 'Twice at the Well host norm: the cook’s duty to the people who eat from her pot',
        },
      ],
    },
    {
      id: 'abandon-dependents',
      label: 'Leaving the people who depend on you unfed',
      standing: 'forbidden',
      sources: [
        {
          kind: 'assumption',
          ref: 'The sole cook leaving a pending meal unprepared is treated as forbidden by this host (docs/games/colony.md §7 M3)',
        },
      ],
    },
    {
      id: 'daily-prayer',
      label: 'Pray at one’s own hours (Christian morning and evening prayer)',
      standing: 'recommended',
      sources: [
        {
          kind: 'assumption',
          ref: 'Twice at the Well host norm for Danyal; standing chosen by the game design',
        },
      ],
    },
  ] satisfies Omit<SourcedNorm, 'provenance' | 'exemptions'>[]
).map(authored('well'));

export const WATCH_CAST_NORMS: SourcedNorm[] = (
  [
    {
      id: 'keep-watch',
      label: 'Keep the watch you stand',
      standing: 'obligatory',
      sources: [{ kind: 'assumption', ref: 'The Night Watch host norm; standing chosen by the game design' }],
    },
  ] satisfies Omit<SourcedNorm, 'provenance' | 'exemptions'>[]
).map(authored('watch'));

export const SITE_CAST_NORMS = [...DEFAULT_NORMS, ...WELL_CAST_NORMS, ...WATCH_CAST_NORMS];

export const TRANSPORT_NORMS = SITE_CAST_NORMS;
