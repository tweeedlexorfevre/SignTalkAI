/**
 * Live sign-to-text for a video call. Runs on this device only: MediaPipe
 * tracks the hands in the local camera video (the same video that is sent to
 * the other person), and the result goes out as text:
 *
 *  - personal: the signed-in user's own gestures (stored in the account), from
 *    the chosen set. The continuous spotter (gestures/spotter.ts) reads them
 *    while the user signs, without waiting for a pause, so fluent signing
 *    comes out word by word.
 *  - bukva: the Bukva model for the Russian fingerspelling alphabet
 *    (33 letters). It reads the camera pixels directly (no hand tracker):
 *    letters build a word, and the word is sent after a pause of WORD_GAP_MS
 *    with no letter in view.
 *
 * Nothing leaves the device except the recognised words, which the caller
 * sends as chat messages / captions.
 */
import { TrackerClient } from '../ml/tracker-client';
import { loadMeta, ModelClient, type LoadedModel } from '../ml/model-client';
import { GestureSpotter, type SpotEvent } from '../gestures/spotter';
import { handsMissing } from '../ml/landmarks';
import { LocalModel, type LocalGuess, type LocalLabel, type LocalMeta } from '../ml/local-model';
import { BukvaSampler } from '../ml/bukva-sampler';
import { EMPTY_SPELL, editSpell, spellStep, type SpellState } from '../ml/fingerspell';
import { library } from '../gestures/library';

export type TranslatorModel = 'personal' | 'bukva';

export interface TranslatorGuess {
  text: string;
  probability: number;
}

export type TranslatorEvent =
  | { type: 'state'; state: 'loading' | 'ready' | 'error'; message?: string }
  | { type: 'hands'; visible: boolean }
  | { type: 'signing' }
  /** Bukva only: the word being spelled and the letter in view right now. */
  | { type: 'spelling'; text: string; letter: string | null }
  | { type: 'result'; accepted: boolean; text: string; guesses: TranslatorGuess[] };

/** Bukva: send the spelled word once no letter is in view (hand lowered or
 * relaxed) and no new letter was added for this long. */
const WORD_GAP_MS = 1800;
/** Bukva: a longer word is sent right away. */
const MAX_WORD_LENGTH = 40;

export class LiveTranslator {
  private tracker: TrackerClient | null = null;
  private personal: { loaded: LoadedModel; spotter: GestureSpotter } | null = null;
  private stopped = false;
  private handsVisible = false;
  // Bukva state
  private bukva: {
    model: LocalModel;
    labels: LocalLabel[];
    meta: LocalMeta;
    sampler: BukvaSampler;
  } | null = null;
  private spell: SpellState = EMPTY_SPELL;
  private spellChanged = 0;
  private letterInView: string | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly kind: TranslatorModel,
    private readonly emit: (event: TranslatorEvent) => void,
  ) {}

  async start(): Promise<void> {
    this.emit({ type: 'state', state: 'loading' });
    if (this.kind === 'bukva') return this.startBukva();
    try {
      const meta = await loadMeta().catch(() => ({ featureSet: 'hands_pose_lips' as const }));
      const trackerPromise = TrackerClient.create(meta.featureSet);
      await library.prepare();
      const loaded = await ModelClient.load();
      const spotter = new GestureSpotter(loaded.meta, {
        infer: (input) => loaded.client.infer(input),
        index: () => library.spotIndex(),
        matchBurst: (embedding) => library.match(embedding),
        emit: (event) => {
          this.onSpot(event);
        },
      });
      this.personal = { loaded, spotter };
      const tracker = await trackerPromise;
      if (this.stopped) {
        tracker.dispose();
        return;
      }
      this.tracker = tracker;
      tracker.start(this.video, (f) => {
        this.onFrame(f.frame, f.t);
      });
      this.emit({ type: 'state', state: 'ready' });
    } catch (error) {
      if (!this.stopped)
        this.emit({
          type: 'state',
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      this.stop();
    }
  }

  stop(): void {
    this.stopped = true;
    this.tracker?.dispose();
    this.tracker = null;
    this.bukva?.sampler.stop();
    this.bukva?.model.dispose();
    this.bukva = null;
    this.personal?.spotter.stop();
    this.personal?.loaded.client.dispose();
    this.personal = null;
  }

  /** Sends the word spelled so far right away (Bukva). */
  flushWord(): void {
    const text = this.spell.text.trim();
    this.spell = { ...EMPTY_SPELL, committed: this.spell.committed };
    this.emit({ type: 'spelling', text: '', letter: this.letterInView });
    if (text)
      this.emit({ type: 'result', accepted: true, text, guesses: [{ text, probability: 1 }] });
  }

  /** Manual correction of the word being spelled (Bukva). */
  editWord(action: 'backspace' | 'clear'): void {
    this.spell =
      action === 'clear'
        ? { ...EMPTY_SPELL, committed: this.spell.committed }
        : editSpell(this.spell, 'backspace');
    this.spellChanged = Date.now();
    this.emit({ type: 'spelling', text: this.spell.text, letter: this.letterInView });
  }

  private async startBukva(): Promise<void> {
    const model = new LocalModel();
    try {
      const loaded = await model.load('bukva');
      if (this.stopped) {
        model.dispose();
        return;
      }
      const sampler = new BukvaSampler(
        this.video,
        (input) => model.infer(input),
        (guesses) => {
          this.onLetters(guesses);
        },
        (error) => {
          if (this.stopped) return;
          this.emit({
            type: 'state',
            state: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
          this.stop();
        },
      );
      this.bukva = { model, ...loaded, sampler };
      sampler.start();
      this.emit({ type: 'state', state: 'ready' });
    } catch (error) {
      model.dispose();
      if (!this.stopped)
        this.emit({
          type: 'state',
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      this.stop();
    }
  }

  private onLetters(guesses: LocalGuess[]): void {
    const bukva = this.bukva;
    if (!bukva || this.stopped) return;
    const top = guesses[0];
    const raw = top && top.probability >= bukva.meta.threshold ? bukva.labels[top.index]?.ru : null;
    const letter = raw && raw !== 'no' ? raw : null;
    if (letter !== this.letterInView) {
      this.letterInView = letter;
      this.emit({ type: 'hands', visible: letter !== null });
    }
    const before = this.spell.text;
    this.spell = spellStep(this.spell, letter);
    const now = Date.now();
    if (this.spell.text !== before) {
      if (!before) this.emit({ type: 'signing' });
      this.spellChanged = now;
      this.emit({ type: 'spelling', text: this.spell.text, letter });
      if (Array.from(this.spell.text).length >= MAX_WORD_LENGTH) this.flushWord();
      return;
    }
    if (this.spell.text && letter === null && now - this.spellChanged > WORD_GAP_MS)
      this.flushWord();
  }

  /** Spotter output: each recognised word goes out as soon as it is seen. */
  private onSpot(event: SpotEvent): void {
    if (this.stopped) return;
    if (event.type === 'activity') {
      if (event.active) this.emit({ type: 'signing' });
      return;
    }
    this.emit({
      type: 'result',
      accepted: event.type === 'word',
      text: event.name,
      guesses: [{ text: event.name, probability: Math.max(0, event.similarity) }],
    });
  }

  private onFrame(frame: Float32Array, t: number): void {
    if (this.stopped) return;
    const visible = !handsMissing(frame);
    if (visible !== this.handsVisible) {
      this.handsVisible = visible;
      this.emit({ type: 'hands', visible });
    }
    this.personal?.spotter.push(frame, t);
  }
}
