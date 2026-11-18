/**
 * Turns a stream of per-window letter guesses into spelled text.
 *
 * Each model window (8 frames ≈ 0.5 s) yields one label or `null` (no letter /
 * not confident). A letter is written once it wins `confirm` windows in a row,
 * and the same letter is written again only after something else (usually a
 * pause → `null`) was confirmed in between, so «АА» needs a short pause.
 */
export interface SpellState {
  text: string;
  committed: string | null;
  pending: string | null;
  streak: number;
}
export const EMPTY_SPELL: SpellState = { text: '', committed: null, pending: null, streak: 0 };
export const MAX_SPELL_LENGTH = 300;

export function spellStep(state: SpellState, label: string | null, confirm = 2): SpellState {
  const streak = label === state.pending ? state.streak + 1 : 1;
  const next = { ...state, pending: label, streak };
  if (streak !== confirm || label === state.committed) return next;
  next.committed = label;
  if (label !== null && next.text.length < MAX_SPELL_LENGTH) next.text += label;
  return next;
}

/** Manual edits keep the detector state so a held letter is not re-added. */
export function editSpell(
  state: SpellState,
  action: 'space' | 'backspace' | 'clear' | { add: string },
): SpellState {
  if (action === 'clear') return EMPTY_SPELL;
  if (action === 'backspace')
    return { ...state, text: Array.from(state.text).slice(0, -1).join('') };
  const add = action === 'space' ? ' ' : action.add;
  if (action === 'space' && (state.text === '' || state.text.endsWith(' '))) return state;
  if (state.text.length >= MAX_SPELL_LENGTH) return state;
  return { ...state, text: state.text + add };
}
