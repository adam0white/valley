/** Browser-only ownership and recording control. Initial replay actors never change here.
 * A local receipt is authority to try its exact parent again, never to refresh a live run.
 * File imports always lose ownership and stay file-origin through subsequent local saves.
 */
import { exportRun } from '@adam0white/human-framework';
import {
  anchorPersonaLife,
  canonicalCast,
  canonicalPersona,
  claimCastChapterBatch,
  closePersonaBranch,
  createPersona,
  initialPersonaLife,
  type Lab,
  type LifeBatchPreparation,
  PERSONA_ORIGINS,
  type PersonaEnvelope,
  type PersonaLife,
  type PersonaRequest,
  personaChannel,
  portablePersonRole,
  portableWriteBlockers,
  validatePersona,
  watchPersonaCheckpoint,
} from '@adam0white/lab-client';
import { ALLOCATION, localRole } from '../sim/cast.ts';
import { departureObligations } from '../sim/departure.ts';
import { type RulesEdition, rulesOf } from '../sim/edition.ts';
import { act, type Game, load, newGame, type SavedGame, save } from '../sim/game.ts';
import { FRAMEWORK_VERSION as ENGINE_VERSION, type Person, personRun } from '../sim/hf.ts';
import {
  checkpointTransfer,
  HOST_RULES,
  type NativeCastSource,
  prepareCastStart,
  validateCheckpointLineage,
  validateCheckpointSource,
  validateTerminalSource,
} from '../sim/passport.ts';
import { foundValley } from '../sim/people.ts';
export interface CastSourceRef {
  revision: string;
  actorId: string;
  fullHash: string;
}
export interface LocalCastReceipt {
  runId: string;
  fileOrigin: boolean;
  localOnly: boolean;
  heads: Record<string, PersonaEnvelope>;
  sources: Record<string, { revision: string; person: NativeCastSource }>;
  sourceRefs?: Record<string, CastSourceRef>;
  archiveHeads?: Record<string, PersonaEnvelope>;
}
export interface Shelf {
  ready: Promise<boolean>;
  readonly enabled: boolean;
  setEnabled(value: boolean): void;
  request<T>(request: PersonaRequest): Promise<T>;
}
function writeBlocker(castId: string): string | undefined {
  const peers = portableWriteBlockers(castId, 'valley');
  return peers.length
    ? `${canonicalCast(castId).name}: read-only until ${peers.join(', ')} supports safe shared writes.`
    : undefined;
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
  status =
    'Continuing people between games in this browser is separate from recording. When recording is on, recorded play links automatically.';
  private busy = false;
  private failedCheckpoint = false;
  private panel?: HTMLElement;
  private saveLocal?: () => void;
  constructor(
    readonly lab: Pick<
      Lab,
      'setPersonaRecording' | 'allowPersonaRecording' | 'personaRecordingAllowed' | 'build'
    >,
    readonly shelf: Shelf | null = personaChannel(),
  ) {
    this.invalidate(); // Must happen before any run/log/save/upload hook is attached.
  }
  invalidate() {
    this.generation++;

    this.lab.setPersonaRecording(`valley-group-${crypto.randomUUID()}`);
    this.lab.allowPersonaRecording(true);
    this.render();
  }
  async fresh(seed: number, localOnly = false, rules?: RulesEdition): Promise<Game> {
    if (!this.shelf) throw new Error('Open a Valley file in this file session.');
    if (typeof location !== 'undefined' && !PERSONA_ORIGINS.has(location.origin)) localOnly = true;
    this.invalidate();
    const generation = this.generation;
    await this.shelf.ready;
    if (generation !== this.generation) throw new Error('Run or identity changed before startup.');
    let header = prepareCastStart(foundValley(seed, 0).people, []);
    let heads: Record<string, PersonaEnvelope> = {};
    // Incoming people are pinned before the one batch ownership change.
    if (!localOnly && !this.shelf.enabled) {
      this.shelf.setEnabled(true);
      await this.shelf.ready;
      if (generation !== this.generation) throw new Error('Run or identity changed.');
    }
    if (this.shelf.enabled && !localOnly) {
      const opening = foundValley(seed, 0).people;
      const shelf = this.shelf;
      const guardedShelf: Shelf = {
        get ready() {
          return shelf.ready;
        },
        get enabled() {
          return shelf.enabled;
        },
        setEnabled(value) {
          shelf.setEnabled(value);
        },
        async request<T>(request: PersonaRequest): Promise<T> {
          const result = await shelf.request<T>(request);
          if (request.action === 'prepareBatch') {
            const batch = result as LifeBatchPreparation;
            const reasons = [
              ...batch.inputs.map((entry) => writeBlocker(entry.parent.castId)).filter(Boolean),
              ...batch.blocked.map((entry) => `${canonicalCast(entry.castId).name}: ${entry.reason}`),
            ];
            if (reasons.length) throw new Error(`${reasons.join(' ')} Keep the current game.`);
          }
          return result;
        },
      };
      const chapter = await claimCastChapterBatch(
        guardedShelf,
        ALLOCATION.map((p) => p.castId),
        this.stamps(rules ?? null),
        async (inputs) => {
          const initial = prepareCastStart(opening, inputs);
          newGame(seed, initial, true, true, rules); // Construct and tick the complete opening before any CAS.
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
    const g = newGame(seed, header, false, true, rules);
    this.game = g;
    this.failedCheckpoint = false;
    this.runId = crypto.randomUUID();
    this.heads = heads;
    this.sources = {};
    this.archiveHeads = {};
    this.fileOrigin = false;
    this.localOnly = localOnly;
    this.status = header.inputs.length
      ? `Loaded ${header.inputs.length} matching histories together. All six people keep the versions loaded at the start. ${header.inputs.map((i) => canonicalCast(i.parent.castId).name).join(', ')}. The source file keeps the original run.`
      : 'The people start fresh in this game. No other history was loaded.';
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
    fileArchive?: Pick<SavedGame, 'castHeads' | 'castSources' | 'castSourceRefs'>,
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
        head.transfer.castPassport === 'hf-portable-person/2' &&
        head.source.rules === HOST_RULES;
      if ((fileOrigin || meta?.localOnly) && !nativeOwned)
        throw new Error('Imported receipts do not grant alternative ownership.');
      const initial = g.cast?.claims.find((c) => c.castId === id);
      const initialClaim = initial?.revision === head.revision;
      const terminalOfClaim = !!head.terminal && initial?.revision === head.parentRevision;
      if (
        (!initialClaim && head.source.game !== 'valley') ||
        (!initialClaim && !terminalOfClaim && head.transfer.hostRun !== runId) ||
        (initial && head.branchId !== initial.branchId && !nativeOwned)
      )
        throw new Error('Invalid local ownership receipt.');
      heads[id] = head;
    }
    const sources = structuredClone(fileArchive?.castSources ?? meta?.sources ?? {});
    const refs = fileArchive?.castSourceRefs ?? meta?.sourceRefs ?? {};
    if (Object.keys(sources).length > 6 || Object.keys(refs).length > 6)
      throw new Error('Too many source receipts.');
    for (const [id, ref] of Object.entries(refs)) {
      if (
        !ALLOCATION.some((c) => c.castId === id) ||
        Object.keys(ref).sort().join(',') !== 'actorId,fullHash,revision' ||
        ref.actorId !== localRole(id) ||
        typeof ref.revision !== 'string' ||
        typeof ref.fullHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(ref.fullHash)
      )
        throw new Error('Invalid source reference.');
      const person = g.valley.castReleased?.[ref.actorId] ?? g.valley.castDeaths?.[ref.actorId];
      if (!person) throw new Error('The game has no frozen source for this receipt.');
      const source = nativeSource(person);
      if (source.archive.hashes.full !== ref.fullHash)
        throw new Error('The source reference differs from the played game.');
      if (
        sources[id] &&
        (sources[id].revision !== ref.revision ||
          canonicalPersona(sources[id].person) !== canonicalPersona(source))
      )
        throw new Error('Conflicting source receipts.');
      sources[id] = { revision: ref.revision, person: source };
    }
    for (const [id, source] of Object.entries(sources)) {
      if (!ALLOCATION.some((c) => c.castId === id) || source.person.actorId !== localRole(id))
        throw new Error('Invalid source archive identity.');
      const head = archiveHeads[id];
      if (!head || head.revision !== source.revision)
        throw new Error('Source archive lacks its exact receipt.');
      if (head.terminal) await validateTerminalSource(source.person, head);
      else await validateCheckpointSource(source.person, head);
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
      ? 'This game was loaded from a file. Its saved receipts do not let you update the original people. When recording is on, recorded play links automatically.'
      : 'The saved game and its local receipts have been checked and loaded. The people keep their saved versions. The latest versions in browser storage were not read.';
    this.render();
  }
  private sourceRefs(): Record<string, CastSourceRef> {
    return Object.fromEntries(
      Object.entries(this.sources).map(([id, source]) => [
        id,
        {
          revision: source.revision,
          actorId: source.person.actorId,
          fullHash: source.person.archive.hashes.full,
        },
      ]),
    );
  }
  metadata(): LocalCastReceipt {
    return structuredClone({
      runId: this.runId,
      fileOrigin: this.fileOrigin,
      localOnly: this.localOnly,
      heads: this.heads,
      sources: {},
      sourceRefs: this.sourceRefs(),
      archiveHeads: this.archiveHeads,
    });
  }
  exportRun(run: SavedGame) {
    return {
      ...run,
      castSourceRefs: this.sourceRefs(),
      castHeads: structuredClone({ ...this.archiveHeads, ...this.heads }),
    };
  }
  private stamps(_rules: RulesEdition | null = (this.game ? rulesOf(this.game.valley) : undefined) ?? null) {
    return {
      game: 'valley',
      build: this.lab.build().c ?? 'development',
      engine: ENGINE_VERSION,
      rules: HOST_RULES,
    };
  }
  /** The complete game log verifies the physical world before publication.
   * A passport cannot remove the host’s unfinished food or work responsibilities. */
  private publicationGuard(g: Game): () => void {
    const source = () => {
      const { savedAt: _savedAt, ...run } = save(g);
      return canonicalPersona({ run, metadata: this.metadata() });
    };
    load(save(g));
    const captured = source();
    const generation = this.generation;
    return () => {
      if (this.game !== g || this.generation !== generation || source() !== captured)
        throw new Error('Source, ownership or file origin changed before publication. Keep the native game.');
    };
  }
  async queryRecording(_allow?: boolean): Promise<void> {
    this.lab.allowPersonaRecording(true);
    this.render();
  }
  async checkpoint(manual = false): Promise<void> {
    if (!this.shelf) return;
    // Public native/source authority is checked even when the older edition gate
    // will also refuse publication. Stripping both new copies is not a bypass.
    if (this.game && manual) {
      try {
        this.publicationGuard(this.game);
      } catch (error) {
        this.failedCheckpoint = true;
        this.status = `The checkpoint was refused: ${error instanceof Error ? error.message : String(error)} Keep or download the native game.`;
        this.render();
        return;
      }
    }
    if ((this.failedCheckpoint && !manual) || this.busy || !this.game || !this.shelf.enabled) return;
    this.busy = true;
    const generation = this.generation;
    const g = this.game;
    try {
      const blocked: string[] = [];
      for (const c of ALLOCATION) {
        const id = localRole(c.castId);
        const parent = this.heads[c.castId];
        if ((this.fileOrigin || this.localOnly) && !parent) continue;
        const dead = g.valley.castDeaths?.[id];
        if (parent?.terminal) continue;
        if ((dead && parent) || g.valley.castReleased?.[id]) {
          const reason = writeBlocker(c.castId);
          if (reason) {
            blocked.push(reason);
            continue;
          }
        }
        if (dead && parent) {
          const stillCurrent = this.publicationGuard(g);
          const terminal = await closePersonaBranch(parent, this.stamps(), Math.round(dead.now * 60000));
          const native = nativeSource(dead);
          await validateTerminalSource(native, terminal);
          if (generation !== this.generation) break;
          stillCurrent();
          await this.shelf.request({ action: 'put', envelope: terminal });
          stillCurrent();
          if (generation !== this.generation) break;
          this.lab.setPersonaRecording(`valley-group-${crypto.randomUUID()}`);
          this.lab.allowPersonaRecording(true);

          this.heads[c.castId] = terminal;
          this.sources[c.castId] = { revision: terminal.revision, person: native };
          this.saveLocal?.();
          await this.queryRecording();
          continue;
        }
        const raw = g.valley.castReleased?.[id];
        if (!raw) continue;
        if (
          parent?.transfer.hostRun === this.runId &&
          (parent.transfer.checkpoint as { at?: number } | undefined)?.at === Math.round(raw.now * 60000)
        )
          continue;
        const stillCurrent = this.publicationGuard(g);
        const prepared = await checkpointTransfer(
          raw,
          c.castId,
          this.stamps(),
          parent,
          departureObligations(g.valley, id),
        );
        const priorSource = this.sources[c.castId];
        if (priorSource && parent?.revision === priorSource.revision)
          await validateCheckpointLineage(prepared.source, priorSource.person, c.castId);
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
          transfer: { ...prepared.transfer, hostRun: this.runId, life },
          limitations: [
            'Supported retained history continues. The complete source Run and host world stay in the native game file.',
          ],
        });
        if (portablePersonRole(envelope, 'valley') !== raw.id)
          throw new Error('Checkpoint identity differs.');
        const nextSources = {
          ...this.sources,
          [c.castId]: { revision: envelope.revision, person: prepared.source },
        };
        const authored = !parent && !g.cast?.inputs.length && !this.fileOrigin;
        if (generation !== this.generation) break;
        stillCurrent();
        await this.shelf.request({
          action: 'put',
          envelope,
          authored,
        });
        stillCurrent();
        if (generation !== this.generation) break;
        this.lab.setPersonaRecording(`valley-group-${crypto.randomUUID()}`);
        this.lab.allowPersonaRecording(true);

        this.heads[c.castId] = envelope;
        this.sources = nextSources;
        this.status = `${c.name}: the saved checkpoint was accepted. Details this game cannot use remain in the local archive.`;
        this.saveLocal?.();
        await this.queryRecording();
      }
      if (blocked.length) this.status = `${blocked.join(' ')} Keep or download this game.`;
    } catch (error) {
      if (generation !== this.generation) return;
      this.failedCheckpoint = true;
      this.status = `The checkpoint was refused: ${error instanceof Error ? error.message : String(error)} Keep this game or download a copy. If its previous version is out of date, the game will not retry with the latest version.`;
    } finally {
      this.busy = false;
      this.render();
    }
  }
  /** Explicit new root from this played source, never adoption of embedded ownership. */
  async alternative(castId: string): Promise<void> {
    if (!this.shelf) return;
    if (this.busy) return;
    const g = this.game;
    const generation = this.generation;
    const runId = this.runId;
    this.busy = true;
    try {
      const c = ALLOCATION.find((p) => p.castId === castId);
      if (!g || !c || !this.shelf.enabled)
        throw new Error('Open a game you have played and turn on continuing people in this browser first.');
      const reason = writeBlocker(castId);
      if (reason) throw new Error(reason);
      const stillCurrent = this.publicationGuard(g);
      const raw = g.valley.castReleased?.[localRole(castId)];
      if (!raw?.body.alive || raw.activity)
        throw new Error(
          'This person must finish their current work and pause first. This action does not remove any activity, care or goal.',
        );
      const previous =
        this.heads[castId] ?? this.archiveHeads[castId] ?? g.cast?.claims.find((p) => p.castId === castId);
      const prepared = await checkpointTransfer(
        raw,
        castId,
        this.stamps(),
        previous,
        departureObligations(g.valley, raw.id),
      );
      const branchId = crypto.randomUUID();
      const envelope = await createPersona({
        format: 'hf-persona/1',
        castId,
        castRevision: c.revision,
        branchId,
        parentRevision: null,
        source: this.stamps(),
        transfer: {
          ...prepared.transfer,
          hostRun: runId,
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
          'Explicit alternative from a played Valley chapter. Prior receipts remain history and grant no ownership of this new root. Full source state stays in the source export.',
        ],
      });
      if (portablePersonRole(envelope, 'valley') !== raw.id) throw new Error('Checkpoint identity differs.');
      const sources = { ...this.sources, [castId]: { revision: envelope.revision, person: prepared.source } };
      await this.shelf.ready;
      if (generation !== this.generation || this.game !== g || this.runId !== runId) return;
      stillCurrent();
      await this.shelf.request({ action: 'put', envelope, fork: true });
      stillCurrent();
      if (generation !== this.generation || this.game !== g || this.runId !== runId) return;
      this.lab.setPersonaRecording(`valley-group-${crypto.randomUUID()}`);
      this.lab.allowPersonaRecording(true);

      this.heads[castId] = envelope;
      this.sources = sources;
      this.failedCheckpoint = false;
      this.status = `${c.name}: a new alternative history with no parent was accepted. The previous history is kept. Download this game’s checkpoint and keep a full copy of the game.`;
      this.saveLocal?.();
      await this.queryRecording();
    } catch (error) {
      if (generation === this.generation)
        this.status = `The alternative history was refused: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.busy = false;
      this.render();
    }
  }
  connect(saveLocal: () => void) {
    this.saveLocal = saveLocal;
    if (this.shelf)
      watchPersonaCheckpoint(() => {
        // Local editions cannot publish. Keep complete source validation on explicit
        // checkpoint/alternative actions rather than replaying on document exit.
        if (
          !this.game ||
          (!Object.keys(this.game.valley.castReleased ?? {}).length &&
            !Object.keys(this.game.valley.castDeaths ?? {}).length)
        )
          return;
        return this.checkpoint();
      });
  }
  mount(host: HTMLElement, saveLocal: () => void) {
    if (!this.shelf) return;
    this.saveLocal = saveLocal;
    this.panel = document.createElement('section');
    this.panel.className = 'cast-controls';
    this.panel.innerHTML = `<h3>People between chapters</h3><label><input type="checkbox" data-continuity> Continue people in this browser</label><p>All matching people assigned to this game enter together when you start a new game. A loaded game keeps its saved versions of people. This device’s stored people are separate from recording and analysis.</p><label>Person to save <select data-cast-person>${ALLOCATION.map((c) => `<option value="${c.castId}">${c.name}</option>`).join('')}</select></label><button data-cast-close>End this person’s visit</button><p>Keep playing until the person finishes their current work. Five visitors stay for thirty days. The game has no agreement for handing over Yusuf’s household care so he can leave. Ending a visit does not remove duties or health restrictions.</p><button data-cast-publish>Save people who are ready in this browser</button><button data-cast-alternative>Start a new alternative history for this person</button><p>An alternative keeps the previous history and starts a new history with no parent from this person’s current paused state. Receipts loaded from a file do not let you update the original person. Current work, goals, care and medical restrictions must still allow a checkpoint to be saved.</p><button data-cast-download>Download this person’s game checkpoint</button><p data-cast-status role="status"></p>`;
    host.append(this.panel);
    const box = this.panel.querySelector<HTMLInputElement>('[data-continuity]');
    box?.addEventListener('change', () => {
      const enabled = box.checked;
      this.invalidate();
      this.shelf?.setEnabled(enabled);
      this.status = enabled
        ? 'People can now continue between games in this browser. New games check all matching people before starting.'
        : 'People will not continue between games in this browser. You can still play here and download a copy.';
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
          'You have asked this person to leave. Close the menu and keep playing until they finish their work. Then save the people who are ready.';
        this.saveLocal?.();
      } else
        this.status =
          id === 'yusuf'
            ? 'Yusuf cannot leave. The game has no agreed handover of household and pregnancy care. Keep his game here.'
            : 'This person has already been asked, has paused, is absent or cannot leave. Continue the current work. You can still download a copy.';
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
          `Create a new alternative history for ${canonicalCast(id).name} from their current state after they have finished work and paused? The previous history stays. The new history has no parent. Receipts loaded from a file will not let you update the original person.`,
        )
      )
        void this.alternative(id);
    });
    this.panel.querySelector('[data-cast-download]')?.addEventListener('click', () => {
      const id = this.panel?.querySelector<HTMLSelectElement>('[data-cast-person]')?.value;
      const head = id ? this.heads[id] : undefined;
      if (head?.transfer.castPassport !== 'hf-portable-person/2') return;
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
    window.addEventListener('storage', (event) => {
      if (event.key === null) changed();
    });
    void this.shelf.ready.then(() => this.render());
    this.render();
  }
  render() {
    if (!this.panel) return;
    const status = this.panel.querySelector('[data-cast-status]');
    if (status)
      status.textContent = `${this.status} Recorded play links across games on this device when recording is on. Change recording in the menu.`;
    const box = this.panel.querySelector<HTMLInputElement>('[data-continuity]');
    if (box) box.checked = this.shelf?.enabled ?? false;
  }
}

function nativeSource(person: Person): NativeCastSource {
  const run = personRun(person);
  if (!run) throw new Error('The current person has no native Run.');
  return { actorId: person.id, archive: structuredClone(exportRun(run)) as NativeCastSource['archive'] };
}
