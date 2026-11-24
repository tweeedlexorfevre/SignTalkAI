/**
 * The signed-in user's personal gestures, stored in the database (Supabase)
 * through the SignTalk API, so the same gestures work on every page
 * (recognition, the dictionary, video calls) and on every device.
 *
 * Gestures are grouped in sets (e.g. "Kazakh sign language" and "Russian sign
 * language"); recognition compares an attempt only with the gestures of the
 * chosen set. A gesture is a meaning (its name) plus 3–5 recorded takes; a
 * take is the on-device sign model's embedding of one attempt (numbers only,
 * never video) and an optional skeleton preview for looking it through.
 *
 * Framework-free; React reads it through useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react';
import { messenger } from '../messenger/store';
import { loadMeta } from '../ml/model-client';
import { GestureStore } from '../lib/gesture-store';
import {
  MAX_TAKES,
  MIN_TAKES,
  cosine,
  isReady,
  matchGesture,
  prototypeOf,
  type Gesture,
  type GestureMatch,
} from '../ml/prototypes';
import type { TakePreview } from './preview';
import type { SpotIndex } from './spotter';

interface ApiGesture {
  id: string;
  setId: string | null;
  name: string;
  modelVersion: string;
  takes: number[][];
  /** Milliseconds per take (null when the take has no preview). */
  durations: (number | null)[];
  /** Only in answers about one gesture; the list and live updates leave them out. */
  previews?: (TakePreview | null)[];
  createdAt: number;
  updatedAt: number;
  scope: 'personal' | 'global';
}

/** A live update from the server (sent to every device of the account). */
interface GestureUpdate {
  type: string;
  gesture?: ApiGesture;
  removed?: string;
  cleared?: string | null;
  set?: GestureSet;
  removedSet?: string;
}

export interface GestureSet {
  id: string;
  name: string;
  createdAt: number;
  scope: 'personal' | 'global';
}

export interface LibraryGesture extends Gesture {
  setId: string | null;
  /** previews[i] belongs to takes[i]; null for takes recorded without one. */
  previews: (TakePreview | null)[];
  /** False until the previews are fetched (they are loaded per gesture, when opened). */
  previewsLoaded: boolean;
  durations: (number | null)[];
  updatedAt: number;
  /** Recorded with another model version: the takes have to be recorded again. */
  stale: boolean;
  scope: 'personal' | 'global';
  readOnly: boolean;
}

export interface LibrarySnapshot {
  status: 'anon' | 'loading' | 'ready' | 'error';
  sets: GestureSet[];
  gestures: LibraryGesture[];
  /** The set used for recognition on this device. */
  activeSetId: string | null;
  /** Gestures imported from this browser's old local storage on this load. */
  imported: number;
  isAdmin: boolean;
}

export type TakeVerdict = 'good' | 'weak' | 'confused';

export interface TakeQuality {
  /** Similarity to the gesture's other takes (leave-one-out prototype). */
  own: number;
  /** The most similar other gesture of the same set. */
  nearest: { name: string; similarity: number } | null;
  verdict: TakeVerdict;
}

const ACTIVE_KEY = 'signtalk.gestureSet';
const EMPTY: LibrarySnapshot = {
  status: 'anon',
  sets: [],
  gestures: [],
  activeSetId: null,
  imported: 0,
  isAdmin: false,
};

function storedActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export class GestureLibrary {
  private snapshot: LibrarySnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private userId: string | null = null;
  private loadToken = 0;
  private meta: {
    version: string;
    embeddingDim: number;
    minSimilarity: number;
    margin: number;
  } | null = null;
  private migrated = false;

  constructor() {
    messenger.subscribe(() => {
      this.onAccount();
    });
    messenger.onEvent((event) => {
      if (event.type === 'gestures:changed' && this.userId) this.applyUpdate(event);
    });
    this.onAccount();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LibrarySnapshot => this.snapshot;

  private set(patch: Partial<LibrarySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private onAccount(): void {
    const account = messenger.getSnapshot();
    const id = account.auth === 'ready' ? (account.user?.id ?? null) : null;
    if (id === this.userId) return;
    this.userId = id;
    this.loadToken++;
    if (!id) {
      this.set({ ...EMPTY, status: account.auth === 'checking' ? 'loading' : 'anon' });
      return;
    }
    this.set({ ...EMPTY, status: 'loading' });
    void this.reload();
  }

  private async model() {
    if (!this.meta) {
      const meta = await loadMeta();
      this.meta = {
        version: meta.version,
        embeddingDim: meta.embeddingDim,
        minSimilarity: meta.teach.minSimilarity,
        margin: meta.teach.margin,
      };
    }
    return this.meta;
  }

  /** Model version the takes must come from. */
  async modelVersion(): Promise<string> {
    return (await this.model()).version;
  }

  /** Load the model thresholds early (the call translator matches right away). */
  async prepare(): Promise<void> {
    await this.model();
  }

  async reload(): Promise<void> {
    const token = ++this.loadToken;
    try {
      const meta = await this.model();
      const data = await messenger.authed<{ sets: GestureSet[]; gestures: ApiGesture[] }>(
        'GET',
        '/gestures',
      );
      if (token !== this.loadToken) return;
      this.set({
        status: 'ready',
        sets: data.sets,
        gestures: data.gestures.map((g) => this.fromApi(g, meta)),
        activeSetId: this.pickActive(data.sets),
        isAdmin: !!messenger.getSnapshot().user?.isAdmin,
      });
      if (!this.migrated) {
        this.migrated = true;
        void this.importLocal(data.gestures);
      }
    } catch {
      if (token === this.loadToken) this.set({ status: 'error' });
    }
  }

  private pickActive(sets: GestureSet[]): string | null {
    const wanted = this.snapshot.activeSetId ?? storedActive();
    return sets.find((s) => s.id === wanted)?.id ?? sets[0]?.id ?? null;
  }

  setActiveSet(id: string): void {
    if (!this.snapshot.sets.some((s) => s.id === id)) return;
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* private mode: lasts until reload */
    }
    this.set({ activeSetId: id });
  }

  private fromApi(g: ApiGesture, meta: { version: string; embeddingDim: number }): LibraryGesture {
    const stale = g.modelVersion !== meta.version;
    const keep = g.takes.map((t) => !stale && t.length === meta.embeddingDim);
    return {
      id: g.id,
      setId: g.setId,
      name: g.name,
      stale,
      takes: g.takes.filter((_, i) => keep[i]).map((t) => Float32Array.from(t)),
      previews: (g.previews ?? []).filter((_, i) => keep[i]),
      previewsLoaded: g.previews !== undefined,
      durations: g.durations.filter((_, i) => keep[i]),
      updatedAt: g.updatedAt,
      scope: g.scope ?? 'personal',
      readOnly: g.scope === 'global' && !messenger.getSnapshot().user?.isAdmin,
    };
  }

  private replace(g: ApiGesture): LibraryGesture | undefined {
    if (!this.meta) return undefined;
    const list = this.snapshot.gestures;
    const current = list.find((x) => x.id === g.id);
    // A list-form update about a version we already hold in full changes nothing.
    if (
      current &&
      g.previews === undefined &&
      current.previewsLoaded &&
      current.updatedAt === g.updatedAt
    )
      return current;
    const next = this.fromApi(g, this.meta);
    this.set({
      gestures: current ? list.map((x) => (x.id === g.id ? next : x)) : [...list, next],
    });
    return next;
  }

  /** Applies a live update instead of downloading the whole library again. */
  private applyUpdate(event: { type: string }): void {
    const u = event as GestureUpdate;
    if (this.snapshot.status !== 'ready') {
      void this.reload();
      return;
    }
    if (u.gesture) {
      this.replace(u.gesture);
    } else if (u.removed) {
      this.set({ gestures: this.snapshot.gestures.filter((g) => g.id !== u.removed) });
    } else if (u.cleared !== undefined) {
      this.set({
        gestures: this.snapshot.gestures.filter((g) => u.cleared !== null && g.setId !== u.cleared),
      });
    } else if (u.set) {
      const set = u.set;
      const sets = this.snapshot.sets;
      this.set({
        sets: sets.some((x) => x.id === set.id)
          ? sets.map((x) => (x.id === set.id ? set : x))
          : [...sets, set],
      });
    } else if (u.removedSet) {
      const sets = this.snapshot.sets.filter((x) => x.id !== u.removedSet);
      this.set({
        sets,
        gestures: this.snapshot.gestures.filter((g) => g.setId !== u.removedSet),
        activeSetId:
          this.snapshot.activeSetId === u.removedSet
            ? (sets[0]?.id ?? null)
            : this.snapshot.activeSetId,
      });
    } else {
      void this.reload();
    }
  }

  /** Fetches the skeleton previews of one gesture (for its card). */
  async loadPreviews(id: string): Promise<void> {
    const { gesture } = await messenger.authed<{ gesture: ApiGesture }>('GET', `/gestures/${id}`);
    this.replace(gesture);
  }

  /**
   * Gestures taught before accounts existed were kept only in this browser
   * (IndexedDB). Move them to the first set once, then delete the local copies.
   */
  private async importLocal(existing: ApiGesture[]): Promise<void> {
    const setId = this.snapshot.sets[0]?.id;
    if (!this.meta || !setId || typeof indexedDB === 'undefined') return;
    const local = new GestureStore();
    let saved: Gesture[];
    try {
      saved = (await local.load(this.meta.version, this.meta.embeddingDim)).gestures;
    } catch {
      return;
    }
    if (!saved.length) return;
    const names = new Set(
      existing.filter((g) => g.setId === setId).map((g) => g.name.toLocaleLowerCase('ru')),
    );
    let imported = 0;
    for (const g of saved) {
      if (names.has(g.name.toLocaleLowerCase('ru'))) continue;
      try {
        const { gesture } = await messenger.authed<{ gesture: ApiGesture }>('POST', '/gestures', {
          setId,
          name: g.name,
          modelVersion: this.meta.version,
          takes: g.takes.slice(0, MAX_TAKES).map((t) => Array.from(t)),
        });
        this.replace(gesture);
        imported++;
      } catch {
        return; // keep the local copies; try again on the next visit
      }
    }
    await local.clear().catch(() => undefined);
    if (imported) this.set({ imported });
  }

  // --- sets -------------------------------------------------------------------
  async createSet(name: string): Promise<GestureSet> {
    const { set } = await messenger.authed<{ set: GestureSet }>('POST', '/gesture-sets', { name });
    this.set({ sets: [...this.snapshot.sets, set] });
    return set;
  }
  async createGlobalSet(name: string): Promise<GestureSet> {
    const { set } = await messenger.authed<{ set: GestureSet }>('POST', '/admin/gesture-sets', { name });
    this.set({ sets: [...this.snapshot.sets, set] });
    return set;
  }

  async renameSet(id: string, name: string): Promise<void> {
    const global = this.snapshot.sets.find((s) => s.id === id)?.scope === 'global';
    const { set } = await messenger.authed<{ set: GestureSet }>('PATCH', global ? `/admin/gesture-sets/${id}` : `/gesture-sets/${id}`, {
      name,
    });
    this.set({ sets: this.snapshot.sets.map((s) => (s.id === id ? set : s)) });
  }

  async deleteSet(id: string): Promise<void> {
    const global = this.snapshot.sets.find((s) => s.id === id)?.scope === 'global';
    await messenger.authed('DELETE', global ? `/admin/gesture-sets/${id}` : `/gesture-sets/${id}`);
    const sets = this.snapshot.sets.filter((s) => s.id !== id);
    this.set({
      sets,
      gestures: this.snapshot.gestures.filter((g) => g.setId !== id),
      activeSetId:
        this.snapshot.activeSetId === id ? (sets[0]?.id ?? null) : this.snapshot.activeSetId,
    });
  }

  // --- gestures ---------------------------------------------------------------
  async create(name: string, setId: string): Promise<LibraryGesture> {
    const modelVersion = await this.modelVersion();
    const { gesture } = await messenger.authed<{ gesture: ApiGesture }>('POST', '/gestures', {
      setId,
      name,
      modelVersion,
    });
    return (
      this.replace(gesture) ?? {
        ...gesture,
        takes: [],
        previews: [],
        previewsLoaded: true,
        durations: [],
        stale: false,
        readOnly: gesture.scope === 'global' && !messenger.getSnapshot().user?.isAdmin,
      }
    );
  }

  /** Admin-only variants use the shared-library API. */
  async createGlobal(name: string, setId: string): Promise<LibraryGesture> {
    const modelVersion = await this.modelVersion();
    const { gesture } = await messenger.authed<{ gesture: ApiGesture }>('POST', '/admin/gestures', { setId, name, modelVersion });
    return this.replace(gesture)!;
  }

  async addTake(
    id: string,
    embedding: Float32Array,
    preview: TakePreview | null,
  ): Promise<LibraryGesture | undefined> {
    const modelVersion = await this.modelVersion();
    const global = this.snapshot.gestures.find((g) => g.id === id)?.scope === 'global';
    const { gesture } = await messenger.authed<{ gesture: ApiGesture }>(
      'POST',
      global ? `/admin/gestures/${id}/takes` : `/gestures/${id}/takes`,
      {
        modelVersion,
        take: Array.from(embedding, (x) => Math.round(x * 1e6) / 1e6),
        ...(preview ? { preview } : {}),
      },
    );
    return this.replace(gesture);
  }

  /** Deletes one take (index), or every take to record the gesture again. */
  async removeTake(id: string, index?: number): Promise<void> {
    const global = this.snapshot.gestures.find((g) => g.id === id)?.scope === 'global';
    const base = global ? `/admin/gestures/${id}/takes` : `/gestures/${id}/takes`;
    const path = index === undefined ? base : `${base}/${index}`;
    const { gesture } = await messenger.authed<{ gesture: ApiGesture }>('DELETE', path);
    this.replace(gesture);
  }

  async update(id: string, patch: { name?: string; setId?: string }): Promise<void> {
    const { gesture } = await messenger.authed<{ gesture: ApiGesture }>(
      'PATCH',
      this.snapshot.gestures.find((g) => g.id === id)?.scope === 'global' ? `/admin/gestures/${id}` : `/gestures/${id}`,
      patch,
    );
    this.replace(gesture);
  }

  async remove(id: string): Promise<void> {
    await messenger.authed('DELETE', this.snapshot.gestures.find((g) => g.id === id)?.scope === 'global' ? `/admin/gestures/${id}` : `/gestures/${id}`);
    this.set({ gestures: this.snapshot.gestures.filter((g) => g.id !== id) });
  }

  async clear(setId: string): Promise<void> {
    await messenger.authed('DELETE', `/gestures?setId=${encodeURIComponent(setId)}`);
    this.set({ gestures: this.snapshot.gestures.filter((g) => g.setId !== setId) });
  }

  // --- recognition ------------------------------------------------------------
  private spotCache: { gestures: LibraryGesture[]; setId: string | null; index: SpotIndex } | null =
    null;

  /**
   * What the continuous spotter looks for in a set: each ready gesture's
   * prototype, its own acceptance threshold and the window lengths to try.
   * A gesture's threshold follows how alike its takes are: 80% of the lowest
   * similarity of a take to the gesture's other takes.
   */
  spotIndex(setId: string | null = this.snapshot.activeSetId): SpotIndex {
    const cache = this.spotCache;
    if (cache && cache.gestures === this.snapshot.gestures && cache.setId === setId)
      return cache.index;
    const floor = this.meta?.minSimilarity ?? 0.08;
    const ready = this.gesturesIn(setId).filter(isReady);
    const durations: number[] = [];
    const gestures = ready.map((g) => {
      const loo = g.takes.map((take, i) =>
        cosine(take, prototypeOf(g.takes.filter((_, k) => k !== i))),
      );
      const threshold = Math.min(0.95, Math.max(floor, 0.8 * Math.min(...loo)));
      const own = g.durations.filter((d): d is number => !!d).sort((a, b) => a - b);
      durations.push(...own);
      const duration = own[Math.floor((own.length - 1) / 2)] ?? 1000;
      return { id: g.id, name: g.name, proto: prototypeOf(g.takes), threshold, duration };
    });
    durations.sort((a, b) => a - b);
    const at = (q: number) => durations[Math.floor(q * (durations.length - 1))] ?? 1000;
    const clamp = (ms: number) => Math.round(Math.min(2500, Math.max(400, ms)) / 100) * 100;
    const windows = durations.length
      ? [...new Set([clamp(at(0.2) * 0.9), clamp(at(0.5)), clamp(at(0.9) * 1.1)])]
      : [700, 1000, 1400];
    const index = { gestures, windows };
    this.spotCache = { gestures: this.snapshot.gestures, setId, index };
    return index;
  }

  gesturesIn(setId: string | null = this.snapshot.activeSetId): LibraryGesture[] {
    return this.snapshot.gestures.filter((g) => g.setId === setId);
  }

  /** Nearest gesture of the set (the active one by default) for one attempt. */
  match(embedding: ArrayLike<number>, setId?: string | null): GestureMatch {
    if (!this.meta) return { kind: 'empty' };
    return matchGesture(embedding, this.gesturesIn(setId), this.meta);
  }

  /** Ready gestures of the set, most similar first (for "did you mean" choices). */
  rank(
    embedding: ArrayLike<number>,
    setId?: string | null,
    limit = 3,
  ): { name: string; similarity: number }[] {
    return this.gesturesIn(setId)
      .filter(isReady)
      .map((g) => ({ name: g.name, similarity: cosine(embedding, prototypeOf(g.takes)) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * How well each take fits its gesture: compared with the gesture's other
   * takes and with the other gestures of the same set. A take closer to
   * another gesture than to its own is "confused"; one that barely resembles
   * its own takes is "weak". Both are worth deleting and recording again.
   */
  quality(gesture: LibraryGesture): TakeQuality[] {
    const others = this.gesturesIn(gesture.setId).filter((g) => g.id !== gesture.id && isReady(g));
    const protos = others.map((g) => ({ name: g.name, proto: prototypeOf(g.takes) }));
    const rows = gesture.takes.map((take, i) => {
      const rest = gesture.takes.filter((_, k) => k !== i);
      const own = rest.length ? cosine(take, prototypeOf(rest)) : 1;
      const nearest =
        protos
          .map((p) => ({ name: p.name, similarity: cosine(take, p.proto) }))
          .sort((a, b) => b.similarity - a.similarity)[0] ?? null;
      return { own, nearest, alone: rest.length === 0 };
    });
    // "Weak" is relative to this gesture's own takes: embedding similarities have
    // no fixed scale, so an outlier is a take far below the gesture's median.
    const owns = rows
      .filter((r) => !r.alone)
      .map((r) => r.own)
      .sort((a, b) => a - b);
    const median = owns.length ? (owns[Math.floor((owns.length - 1) / 2)] ?? 0) : 0;
    return rows.map(({ own, nearest, alone }) => ({
      own,
      nearest,
      verdict:
        !alone && nearest && nearest.similarity >= own
          ? 'confused'
          : !alone && owns.length >= 3 && own < median - Math.max(0.15, Math.abs(median) * 0.35)
            ? 'weak'
            : 'good',
    }));
  }
}

export { MIN_TAKES, MAX_TAKES };

export const library = new GestureLibrary();

export function useGestureLibrary(): LibrarySnapshot {
  return useSyncExternalStore(library.subscribe, library.getSnapshot);
}
