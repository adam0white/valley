/** Browser-only ownership and recording control. Initial replay actors never change here.
 * A local receipt is authority to try its exact parent again, never to refresh a live run.
 * File imports always lose ownership and stay file-origin through subsequent local saves.
 */
import { ENGINE_VERSION, type Person, snapshot } from '@adam0white/human-framework';
import {
  anchorPersonaLife,
  canonicalCast,
  canonicalPersona,
  claimCastChapterBatch,
  closePersonaBranch,
  createPersona,
  initialPersonaLife,
  type Lab,
  type PersonaEnvelope,
  type PersonaLife,
  type PersonaRequest,
  personaChannel,
  validatePersona,
  watchPersonaCheckpoint,
} from '@adam0white/lab-client';
import { ALLOCATION, localRole } from '../sim/cast.ts';
import { act, type Game, newGame, type SavedGame } from '../sim/game.ts';
import { calendarPassport, checkpointReceipt, HOST_RULES, prepareCastStart } from '../sim/passport.ts';
import { foundValley } from '../sim/people.ts';
export interface LocalCastReceipt {
  runId: string;
  fileOrigin: boolean;
  localOnly: boolean;
  heads: Record<string, PersonaEnvelope>;
  sources: Record<string, { revision: string; person: Person }>;
  archiveHeads?: Record<string, PersonaEnvelope>;
}
export interface Shelf {
  ready: Promise<boolean>;
  readonly enabled: boolean;
  setEnabled(value: boolean): void;
  request<T>(request: PersonaRequest): Promise<T>;
}
export class CastSession {
  generation = 0;
  runId: string = crypto.randomUUID();
  fileOrigin = false;
  localOnly = false;
  heads: Record<string, PersonaEnvelope> = {};
  sources: LocalCastReceipt['sources'] = {};
  archiveHeads: Record<string, PersonaEnvelope> = {};
  game: Game | null = null;
  status = 'Browser continuity is separate from recording. Imported histories stay local unless permitted.';
  private busy = false;
  private failedCheckpoint = false;
  private choice = 0;
  private panel?: HTMLElement;
  private saveLocal?: () => void;
  constructor(
    readonly lab: Pick<
      Lab,
      'setPersonaRecording' | 'allowPersonaRecording' | 'personaRecordingAllowed' | 'build'
    >,
    readonly shelf: Shelf = personaChannel(),
  ) {
    this.invalidate(); // Must happen before any run/log/save/upload hook is attached.
  }
  invalidate() {
    this.generation++;
    this.choice++;
    this.lab.setPersonaRecording(`valley-group-${crypto.randomUUID()}`);
    this.lab.allowPersonaRecording(false);
    this.render();
  }
  async fresh(seed: number, localOnly = false): Promise<Game> {
    this.invalidate();
    const generation = this.generation;
    await this.shelf.ready;
    if (generation !== this.generation) throw new Error('Run or identity changed before startup.');
    let header = prepareCastStart(foundValley(seed, 0).people, []);
    let heads: Record<string, PersonaEnvelope> = {};
    if (this.shelf.enabled && !localOnly) {
      const opening = foundValley(seed, 0).people;
      const chapter = await claimCastChapterBatch(
        this.shelf,
        ALLOCATION.map((p) => p.castId),
        this.stamps(),
        async (inputs) => {
          const initial = prepareCastStart(opening, inputs);
          newGame(seed, initial, true); // Construct and tick the complete opening before any CAS.
          return initial;
        },
        { isCurrent: () => generation === this.generation },
      );
      if (chapter) {
        header = { ...chapter.initial, claims: structuredClone(chapter.claims) };
        heads = Object.fromEntries(chapter.claims.map((p) => [p.castId, p]));
      }
    }
    if (generation !== this.generation) throw new Error('Run or identity changed.');
    const g = newGame(seed, header);
    this.game = g;
    this.failedCheckpoint = false;
    this.runId = crypto.randomUUID();
    this.heads = heads;
    this.sources = {};
    this.archiveHeads = {};
    this.fileOrigin = false;
    this.localOnly = localOnly;
    this.status = header.inputs.length
      ? `Admitted ${header.inputs.length} applicable histories together; all six actors are pinned. ${header.inputs.map((i) => canonicalCast(i.parent.castId).name).join(', ')}. Source omissions remain in the source archive.`
      : 'Fresh local cast. No other history was imported.';
    this.render();
    return g;
  }
  async activate(g: Game): Promise<void> {
    if (this.game !== g) throw new Error('Run changed before ledger installation.');
    if (g.cast?.inputs.length) await this.queryRecording();
    else this.lab.setPersonaRecording(null);
  }
  async loaded(
    g: Game,
    meta?: LocalCastReceipt,
    fromFile = false,
    fileArchive?: Pick<SavedGame, 'castHeads' | 'castSources'>,
  ): Promise<void> {
    this.invalidate();
    const generation = this.generation;
    const runId = meta?.runId ?? crypto.randomUUID();
    const fileOrigin = fromFile || meta?.fileOrigin === true;
    const heads: Record<string, PersonaEnvelope> = {};
    const archiveHeads: Record<string, PersonaEnvelope> = {};
    if (typeof runId !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(runId))
      throw new Error('Invalid local run receipt.');
    for (const input of g.cast?.inputs ?? []) await validatePersona(input.parent);
    for (const claim of g.cast?.claims ?? []) await validatePersona(claim);
    const candidateHeads = fromFile
      ? (fileArchive?.castHeads ?? { ...meta?.archiveHeads, ...meta?.heads })
      : { ...meta?.archiveHeads, ...meta?.heads };
    if (Object.keys(candidateHeads).length > 6) throw new Error('Too many cast receipts.');
    for (const [id, raw] of Object.entries(candidateHeads)) {
      const head = await validatePersona(raw);
      if (head.castId !== id || !ALLOCATION.some((c) => c.castId === id))
        throw new Error('Outside cast receipt.');
      archiveHeads[id] = head;
      if (fromFile || meta?.heads?.[id]?.revision !== head.revision) continue;
      // Only a locally accepted native source receipt can own a file-origin alternative.
      const nativeOwned =
        head.transfer.hostRun === runId &&
        head.transfer.castPassport === 'valley-cast/1' &&
        head.source.rules === HOST_RULES;
      if ((fileOrigin || meta?.localOnly) && !nativeOwned)
        throw new Error('Imported receipts do not grant alternative ownership.');
      const initial = g.cast?.claims.find((c) => c.castId === id);
      const initialClaim = initial?.revision === head.revision;
      const terminalOfClaim = !!head.terminal && initial?.revision === head.parentRevision;
      if (
        head.source.game !== 'valley' ||
        (!initialClaim && !terminalOfClaim && head.transfer.hostRun !== runId) ||
        (initial && head.branchId !== initial.branchId && !nativeOwned)
      )
        throw new Error('Invalid local ownership receipt.');
      heads[id] = head;
    }
    const sources = structuredClone(fileArchive?.castSources ?? meta?.sources ?? {});
    if (canonicalPersona(sources).length > 1024 * 1024 || Object.keys(sources).length > 6)
      throw new Error('Source archive exceeds its local bound.');
    for (const [id, source] of Object.entries(sources)) {
      if (!ALLOCATION.some((c) => c.castId === id) || source.person.id !== localRole(id))
        throw new Error('Invalid source archive identity.');
      const head = archiveHeads[id];
      if (!head || head.revision !== source.revision)
        throw new Error('Source archive lacks its exact receipt.');
      if (head.terminal) {
        if (source.person.body.alive || source.person.now !== head.terminal.at)
          throw new Error('Invalid death archive.');
      } else if (
        canonicalPersona(await checkpointReceipt(source.person)) !==
        canonicalPersona(head.transfer.checkpoint)
      )
        throw new Error('Source archive digest differs.');
    }
    if (generation !== this.generation) throw new Error('Run or identity changed during local load.');
    this.game = g;
    this.failedCheckpoint = false;
    this.runId = runId;
    this.fileOrigin = fileOrigin;
    this.localOnly = meta?.localOnly ?? false;
    this.heads = heads;
    this.archiveHeads = archiveHeads;
    this.sources = sources;
    if (!fileOrigin && !g.cast?.inputs.length && !Object.keys(heads).length)
      this.lab.setPersonaRecording(null);
    else if (!fileOrigin) await this.queryRecording();
    this.status = fileOrigin
      ? 'File-origin chapter: embedded receipts grant no ownership. Recorded play links automatically when recording is on.'
      : 'Loaded pinned chapter and validated local receipts. No latest shelf state was read.';
    this.render();
  }
  metadata(): LocalCastReceipt {
    return structuredClone({
      runId: this.runId,
      fileOrigin: this.fileOrigin,
      localOnly: this.localOnly,
      heads: this.heads,
      sources: this.sources,
      archiveHeads: this.archiveHeads,
    });
  }
  exportRun(run: SavedGame) {
    return {
      ...run,
      castSources: structuredClone(this.sources),
      castHeads: structuredClone({ ...this.archiveHeads, ...this.heads }),
    };
  }
  private stamps() {
    return {
      game: 'valley',
      build: this.lab.build().c ?? 'development',
      engine: ENGINE_VERSION,
      rules: HOST_RULES,
    };
  }
  private pins() {
    const map = new Map((this.game?.cast?.claims ?? []).map((p) => [p.castId, p]));
    for (const p of Object.values(this.heads)) map.set(p.castId, p);
    return [...map.values()].sort((a, b) => a.castId.localeCompare(b.castId));
  }
  async queryRecording(allow?: boolean): Promise<void> {
    this.lab.allowPersonaRecording(false);
    const choice = ++this.choice;
    const generation = this.generation;
    const runId = this.runId;
    const pins = this.pins();
    const revisions = pins.map((p) => p.revision).join('/');
    const current = () =>
      choice === this.choice &&
      generation === this.generation &&
      runId === this.runId &&
      this.pins()
        .map((p) => p.revision)
        .join('/') === revisions;
    if (this.fileOrigin) {
      if (allow === true && current()) this.lab.allowPersonaRecording(true);
      this.render();
      return;
    }
    if (!pins.length) {
      this.render();
      return;
    }
    const result = await this.shelf.request<{
      sameEpoch: boolean;
      revisions: string[];
      recordingEpoch: string | null;
    }>({ action: 'recordingBatch', envelopes: pins });
    if (!current() || result.revisions.join('/') !== revisions) return;
    if (allow === undefined) {
      this.lab.allowPersonaRecording(result.sameEpoch);
      this.render();
      return;
    }
    const ack = await this.shelf.request<{ sameEpoch: boolean; revisions: string[] }>({
      action: 'recordingBatch',
      envelopes: pins,
      allowRecording: allow,
      recordingEpoch: result.recordingEpoch ?? undefined,
    });
    if (current() && ack.revisions.join('/') === revisions)
      this.lab.allowPersonaRecording(allow && ack.sameEpoch);
    this.render();
  }
  async checkpoint(manual = false): Promise<void> {
    if ((this.failedCheckpoint && !manual) || this.busy || !this.game || !this.shelf.enabled) return;
    this.busy = true;
    const generation = this.generation;
    const g = this.game;
    try {
      for (const c of ALLOCATION) {
        const id = localRole(c.castId);
        const parent = this.heads[c.castId];
        if ((this.fileOrigin || this.localOnly) && !parent) continue;
        const dead = g.valley.castDeaths?.[id];
        if (parent?.terminal) continue;
        if (dead && parent) {
          const terminal = await closePersonaBranch(parent, this.stamps(), dead.now);
          if (generation !== this.generation) break;
          await this.shelf.request({ action: 'put', envelope: terminal });
          if (generation !== this.generation) break;
          this.lab.setPersonaRecording(`valley-group-${crypto.randomUUID()}`);
          this.lab.allowPersonaRecording(false);
          this.choice++;
          this.heads[c.castId] = terminal;
          this.sources[c.castId] = { revision: terminal.revision, person: snapshot(dead) };
          this.saveLocal?.();
          await this.queryRecording();
          continue;
        }
        const raw = g.valley.castReleased?.[id];
        if (!raw) continue;
        if (
          parent?.transfer.hostRun === this.runId &&
          (parent.transfer.checkpoint as { sourceMinute?: number } | undefined)?.sourceMinute === raw.now
        )
          continue;
        const person = calendarPassport(raw); // Actual frozen source; never clone a public profile as history.
        const checkpoint = await checkpointReceipt(raw);
        const branchId = parent?.branchId ?? crypto.randomUUID();
        const oldLife = parent?.transfer.life as PersonaLife | undefined;
        const life = oldLife
          ? anchorPersonaLife(oldLife, c.castId, Date.now())
          : initialPersonaLife(c.castId, branchId, Date.now());
        const envelope = await createPersona({
          format: 'hf-persona/1',
          castId: c.castId,
          castRevision: c.revision,
          branchId,
          parentRevision: parent?.revision ?? null,
          source: this.stamps(),
          transfer: {
            castPassport: 'valley-cast/1',
            sourceRole: id,
            hostRun: this.runId,
            person,
            checkpoint,
            life,
          },
          limitations: [
            ...person.person.limitations,
            'Private source episodes, social context, household stores and unsupported skills stay in the full source archive. Closing this chapter is not simulated travel home.',
          ],
        });
        const nextSources = {
          ...this.sources,
          [c.castId]: { revision: envelope.revision, person: snapshot(raw) },
        };
        if (canonicalPersona(nextSources).length > 1024 * 1024)
          throw new Error('Export the source archive before another checkpoint.');
        const authored = !parent && !g.cast?.inputs.length && !this.fileOrigin;
        const epoch = authored
          ? await this.shelf.request<{ recordingEpoch: string | null }>({ action: 'recording' })
          : null;
        if (generation !== this.generation) break;
        await this.shelf.request({
          action: 'put',
          envelope,
          authored,
          recordingEpoch: epoch?.recordingEpoch ?? undefined,
        });
        if (generation !== this.generation) break;
        this.lab.setPersonaRecording(`valley-group-${crypto.randomUUID()}`);
        this.lab.allowPersonaRecording(false);
        this.choice++;
        this.heads[c.castId] = envelope;
        this.sources = nextSources;
        if (canonicalPersona(this.sources).length > 1024 * 1024)
          throw new Error('Export the source archive before another checkpoint.');
        this.status = `${c.name}: chapter checkpoint accepted. Unsupported source state remains in the local archive.`;
        this.saveLocal?.();
        await this.queryRecording();
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.failedCheckpoint = true;
      this.status = `Checkpoint refused: ${error instanceof Error ? error.message : String(error)} Keep this chapter or export it. A stale parent is never retried against latest.`;
    } finally {
      this.busy = false;
      this.render();
    }
  }
  /** Explicit new root from this played source, never adoption of embedded ownership. */
  async alternative(castId: string): Promise<void> {
    if (this.busy) return;
    const g = this.game;
    const generation = this.generation;
    const runId = this.runId;
    this.busy = true;
    try {
      const c = ALLOCATION.find((p) => p.castId === castId);
      if (!g || !c || !this.shelf.enabled)
        throw new Error('Open a current played chapter and enable browser continuity first.');
      const raw = g.valley.castReleased?.[localRole(castId)];
      if (!raw || !raw.body.alive || raw.activity)
        throw new Error(
          'This person must be naturally paused after current work. No activity, care or goal is cleared.',
        );
      const person = calendarPassport(raw);
      const checkpoint = await checkpointReceipt(raw);
      const previous =
        this.heads[castId] ?? this.archiveHeads[castId] ?? g.cast?.claims.find((p) => p.castId === castId);
      const branchId = crypto.randomUUID();
      const envelope = await createPersona({
        format: 'hf-persona/1',
        castId,
        castRevision: c.revision,
        branchId,
        parentRevision: null,
        source: this.stamps(),
        transfer: {
          castPassport: 'valley-cast/1',
          sourceRole: raw.id,
          hostRun: runId,
          person,
          checkpoint,
          life: initialPersonaLife(castId, branchId, Date.now()),
          alternativeSource: {
            version: 'valley-explicit-alternative/1',
            previousReceipt: previous?.revision ?? null,
            initialClaim: g.cast?.claims.find((p) => p.castId === castId)?.revision ?? null,
            fileOrigin: this.fileOrigin,
            localOnly: this.localOnly,
          },
        },
        limitations: [
          ...person.person.limitations,
          'Explicit alternative from a played Valley chapter. Prior receipts remain history and grant no ownership of this new root. Full source state stays in the source export.',
        ],
      });
      const sources = { ...this.sources, [castId]: { revision: envelope.revision, person: snapshot(raw) } };
      if (canonicalPersona(sources).length > 1024 * 1024)
        throw new Error('Export the source archive before another checkpoint.');
      await this.shelf.ready;
      if (generation !== this.generation || this.game !== g || this.runId !== runId) return;
      await this.shelf.request({ action: 'put', envelope, fork: true });
      if (generation !== this.generation || this.game !== g || this.runId !== runId) return;
      this.lab.setPersonaRecording(`valley-group-${crypto.randomUUID()}`);
      this.lab.allowPersonaRecording(false);
      this.choice++;
      this.heads[castId] = envelope;
      this.sources = sources;
      this.failedCheckpoint = false;
      this.status = `${c.name}: NEW NULL-parent alternative branch accepted. Prior branch/history retained. Download this native checkpoint and keep a full run copy.`;
      this.saveLocal?.();
      await this.queryRecording();
    } catch (error) {
      if (generation === this.generation)
        this.status = `Alternative refused: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.busy = false;
      this.render();
    }
  }
  mount(host: HTMLElement, saveLocal: () => void) {
    this.saveLocal = saveLocal;
    this.panel = document.createElement('section');
    this.panel.className = 'cast-controls';
    this.panel.innerHTML = `<h3>People between chapters</h3><label><input type="checkbox" data-continuity> Continue people in this browser</label><p>All applicable allocated people enter together at a fresh start. A loaded chapter stays pinned. This device’s shelf is separate from recording and analysis.</p><label>Checkpoint person <select data-cast-person>${ALLOCATION.map((c) => `<option value="${c.castId}">${c.name}</option>`).join('')}</select></label><button data-cast-close>Close this person’s visiting chapter</button><p>Continue play until the person finishes current work. Five visitors have a thirty-day stay; Yusuf’s household care has no supported departure agreement. No duty or health restriction is cleared.</p><button data-cast-publish>Save eligible people to the browser shelf</button><button data-cast-alternative>Create a new alternative branch from this played person</button><p>An explicit alternative keeps the prior branch in history and makes a NEW NULL-parent branch from the selected person’s actual paused state. Imported receipts never become ownership. Current work, goals, care and clinical restrictions must still permit a checkpoint.</p><button data-cast-download>Download selected native checkpoint</button><p data-cast-status role="status"></p>`;
    host.append(this.panel);
    const box = this.panel.querySelector<HTMLInputElement>('[data-continuity]');
    box?.addEventListener('change', () => {
      const enabled = box.checked;
      this.invalidate();
      this.shelf.setEnabled(enabled);
      this.status = enabled
        ? 'Continuity enabled. Fresh starts preflight the whole applicable cast.'
        : 'Continuity off. Local play/export remains available.';
      this.render();
    });
    this.panel.querySelector('[data-cast-person]')?.addEventListener('change', () => {
      this.invalidate();
      void this.queryRecording().catch(() => this.render());
    });
    this.panel.querySelector('[data-cast-close]')?.addEventListener('click', () => {
      const selected = this.panel?.querySelector<HTMLSelectElement>('[data-cast-person]')?.value;
      if (!this.game || !selected) return;
      const id = localRole(selected);
      if (act(this.game, { verb: 'release-cast', person: id })) {
        this.status =
          'Departure requested. Close the menu and continue until the actual work boundary; then save eligible people.';
        this.saveLocal?.();
      } else
        this.status =
          id === 'yusuf'
            ? 'Yusuf cannot leave: no agreed handover of household and pregnancy care is implemented. Keep his chapter here.'
            : 'Already requested, paused, absent or not eligible. Continue current work; export remains available.';
      this.render();
    });
    this.panel
      .querySelector('[data-cast-publish]')
      ?.addEventListener('click', () => void this.checkpoint(true));
    this.panel.querySelector('[data-cast-alternative]')?.addEventListener('click', () => {
      const id = this.panel?.querySelector<HTMLSelectElement>('[data-cast-person]')?.value;
      if (!id) return;
      if (
        window.confirm(
          `Create a NEW alternative branch for ${canonicalCast(id).name} from this played, naturally paused source? The prior branch/history stays. This creates a new NULL-parent root; it does not recover ownership from imported receipts.`,
        )
      )
        void this.alternative(id);
    });
    this.panel.querySelector('[data-cast-download]')?.addEventListener('click', () => {
      const id = this.panel?.querySelector<HTMLSelectElement>('[data-cast-person]')?.value;
      const head = id ? this.heads[id] : undefined;
      if (!head || head.transfer.castPassport !== 'valley-cast/1') return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(head, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `valley-${localRole(head.castId)}-native-person.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const changed = () => {
      this.invalidate();
      void this.queryRecording().catch(() => this.render());
    };
    window.addEventListener('hf-lab-preference', changed);
    window.addEventListener('storage', (event) => {
      if (
        event.key === null ||
        event.key?.startsWith('hf-lab-') ||
        event.key?.startsWith('hf-persona-recording:')
      )
        changed();
    });
    watchPersonaCheckpoint(() => this.checkpoint());
    void this.shelf.ready.then(() => this.render());
    this.render();
  }
  render() {
    if (!this.panel) return;
    const status = this.panel.querySelector('[data-cast-status]');
    if (status)
      status.textContent = `${this.status} Recording of carried history: ${this.lab.personaRecordingAllowed ? 'permitted for this identity' : 'local only'}.`;
    const box = this.panel.querySelector<HTMLInputElement>('[data-continuity]');
    if (box) box.checked = this.shelf.enabled;
  }
}
