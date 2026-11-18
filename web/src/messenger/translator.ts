/**
 * Live sign-to-text for a video call. Runs on this device only: MediaPipe
 * tracks the hands in the local camera video (the same video that is sent to
 * the other person), and one of the project's on-device models classifies
 * each sign:
 *
 *  - krsl: the KRSL10 pilot (10 Kazakh-Russian signs). A sign is cut out
 *    automatically: it starts when hands appear and ends when the hands drop
 *    out of view (or after MAX_SIGN_MS), then the pooled hand shapes go to
 *    the model.
 *  - asl:  the original GestureSign ASL model (250 signs) with its own
 *    segmenter and calibrated "not sure" decision.
 *  - bukva: the ai-forever Bukva model for the Russian fingerspelling
 *    alphabet (33 letters). It reads the camera pixels directly (no hand
 *    tracker): letters build a word, and the word is sent after a pause of
 *    WORD_GAP_MS with no letter in view.
 *
 * Nothing leaves the device except the recognised words, which the caller
 * sends as chat messages / captions.
 */
import type { Locale } from '../locale';
import { TrackerClient } from '../ml/tracker-client';
import { loadMeta, ModelClient, type LoadedModel } from '../ml/model-client';
import { Recognizer } from '../ml/recognizer';
import { handsFromFrame, krslFeatures } from '../ml/krsl-features';
import { LocalModel, type LocalGuess, type LocalLabel, type LocalMeta } from '../ml/local-model';
import { BukvaSampler } from '../ml/bukva-sampler';
import { EMPTY_SPELL, editSpell, spellStep, type SpellState } from '../ml/fingerspell';
import vocabulary from '../vocabulary.json';

export type TranslatorModel = 'krsl' | 'asl' | 'bukva';

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

/** End a KRSL sign after this long without hands. */
const GAP_MS = 550;
/** Longest KRSL sign; the model was trained on clips of about 2.3 s. */
const MAX_SIGN_MS = 2600;
/** Hand shapes needed before a segment is worth classifying. */
const MIN_SHAPES = 6;
/** Bukva: send the spelled word once no letter is in view (hand lowered or
 * relaxed) and no new letter was added for this long. */
const WORD_GAP_MS = 1800;
/** Bukva: a longer word is sent right away. */
const MAX_WORD_LENGTH = 40;

export class LiveTranslator {
  private tracker: TrackerClient | null = null;
  private krsl: { model: LocalModel; labels: LocalLabel[]; meta: LocalMeta } | null = null;
  private asl: { loaded: LoadedModel; recognizer: Recognizer } | null = null;
  private stopped = false;
  private handsVisible = false;
  // KRSL segment state
  private active = false;
  private segmentStart = 0;
  private lastHands = 0;
  private shapes: number[][][] = [];
  private busy = false;
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
    private language: Locale,
    private readonly emit: (event: TranslatorEvent) => void,
  ) {}

  setLanguage(language: Locale): void {
    this.language = language;
  }

  async start(): Promise<void> {
    this.emit({ type: 'state', state: 'loading' });
    if (this.kind === 'bukva') return this.startBukva();
    try {
      const meta = await loadMeta().catch(() => ({ featureSet: 'hands_pose_lips' as const }));
      const trackerPromise = TrackerClient.create(meta.featureSet);
      if (this.kind === 'krsl') {
        const model = new LocalModel();
        try {
          const loaded = await model.load('krsl');
          this.krsl = { model, ...loaded };
        } catch (error) {
          model.dispose();
          throw error;
        }
      } else {
        const loaded = await ModelClient.load();
        const recognizer = new Recognizer(
          loaded.meta,
          loaded.labels,
          (input) => loaded.client.infer(input),
          (event) => {
            if (event.type === 'signing') this.emit({ type: 'signing' });
            else if (event.type === 'result') {
              const d = event.result.decision;
              const guesses = d.top.map((g) => ({
                text: this.aslLabel(g.index),
                probability: g.probability,
              }));
              this.emit({
                type: 'result',
                accepted: d.kind === 'sign',
                text: guesses[0]?.text ?? '',
                guesses,
              });
            }
          },
        );
        this.asl = { loaded, recognizer };
      }
      const tracker = await trackerPromise;
      if (this.stopped) {
        tracker.dispose();
        return;
      }
      this.tracker = tracker;
      tracker.start(this.video, (f) => {
        this.onFrame(f.frame, f.t, f.poses);
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
    this.krsl?.model.dispose();
    this.krsl = null;
    this.bukva?.sampler.stop();
    this.bukva?.model.dispose();
    this.bukva = null;
    this.asl?.loaded.client.dispose();
    this.asl = null;
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

  private aslLabel(index: number): string {
    const label = this.asl?.loaded.labels[index];
    if (!label) return '';
    return (
      (vocabulary as Record<string, Record<Locale, string>>)[label.sign]?.[this.language] ??
      label.label
    );
  }

  private krslLabel(label: LocalLabel): string {
    return this.language === 'kk' ? (label.kk ?? label.ru) : label.ru;
  }

  private onFrame(frame: Float32Array, t: number, poses: number): void {
    if (this.stopped) return;
    const hands = handsFromFrame(frame);
    const visible = hands.length > 0;
    if (visible !== this.handsVisible) {
      this.handsVisible = visible;
      this.emit({ type: 'hands', visible });
    }
    if (this.asl) {
      this.asl.recognizer.push({ frame, t, poses });
      return;
    }
    if (!this.krsl) return;
    if (visible) {
      if (!this.active) {
        this.active = true;
        this.segmentStart = t;
        this.shapes = [];
        this.emit({ type: 'signing' });
      }
      this.shapes.push(...hands);
      this.lastHands = t;
    }
    if (this.active && (t - this.lastHands > GAP_MS || t - this.segmentStart > MAX_SIGN_MS)) {
      this.active = false;
      const shapes = this.shapes;
      this.shapes = [];
      if (shapes.length >= MIN_SHAPES) void this.classifyKrsl(shapes);
    }
  }

  private async classifyKrsl(shapes: number[][][]): Promise<void> {
    const krsl = this.krsl;
    if (!krsl || this.busy) return;
    const input = krslFeatures(shapes);
    if (!input) return;
    this.busy = true;
    try {
      const guesses = await krsl.model.infer(input);
      if (this.stopped) return;
      const named = guesses
        .map((g) => ({ label: krsl.labels[g.index], probability: g.probability }))
        .filter((g): g is { label: LocalLabel; probability: number } => !!g.label);
      const top = named[0];
      this.emit({
        type: 'result',
        accepted: !!top && top.probability >= krsl.meta.threshold,
        text: top ? this.krslLabel(top.label) : '',
        guesses: named.map((g) => ({ text: this.krslLabel(g.label), probability: g.probability })),
      });
    } catch {
      /* a failed inference only skips this sign */
    } finally {
      this.busy = false;
    }
  }
}
