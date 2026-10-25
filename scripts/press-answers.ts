/** Credit a press only to its real later visible reply, including the next morning.
 * Grouped reports about people who already came when pressed are not new answers.
 */
import type { Note, ValleyState } from '../src/sim/valley.ts';
export class PressAnswers {
  private pending = new Map<string, { ask: string; person: string; at: number; visible: Set<string> }>();
  sent(ask: string, person: string, s: ValleyState) {
    const visible = new Set(s.notes.filter((n) => n.at <= s.minute).map((n) => this.key(n, person)));
    this.pending.set(`press:${ask}:${person}`, { ask, person, at: s.minute, visible });
  }
  private key(n: Note, person: string) {
    return n.group
      ? `${n.id}:${person}:${n.ids?.includes(person) || n.who === person}`
      : JSON.stringify([n.id, n.text, n.words]);
  }
  read(s: ValleyState): { id: string; note: Note }[] {
    const out: { id: string; note: Note }[] = [];
    for (const [id, input] of this.pending) {
      const reply = s.asks.find((a) => a.id === input.ask)?.replies[input.person];
      if (!reply || reply.at <= input.at || reply.at > s.minute) continue;
      const note = s.notes.findLast(
        (n) =>
          n.kind === 'reply' &&
          n.ask === input.ask &&
          !n.group?.startsWith('pressed-') &&
          !input.visible.has(this.key(n, input.person)) &&
          n.at <= s.minute &&
          (n.ids?.includes(input.person) || n.who === input.person),
      );
      if (!note) continue;
      out.push({ id, note });
      this.pending.delete(id);
    }
    return out;
  }
}
