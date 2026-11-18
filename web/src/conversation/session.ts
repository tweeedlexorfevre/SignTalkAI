import type { Locale } from '../locale';
export type CollegeScene = 'lesson' | 'office' | 'peers';
export interface Message {
  id: string;
  role: 'me' | 'partner';
  text: string;
  language: Locale;
  source: 'typed' | 'phrase' | 'speech';
}
interface State {
  draft: string;
  reply: string;
  scene: CollegeScene;
  messages: Message[];
}
/** Conversation contents stay in memory, including when navigating to another page. */
export class ConversationSession {
  private state: State = { draft: '', reply: '', scene: 'lesson', messages: [] };
  private listeners = new Set<() => void>();
  getSnapshot = (): State => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => {
      f();
    });
  }
  setDraft(value: string) {
    this.update({ draft: value.slice(0, 1000) });
  }
  setReply(value: string) {
    this.update({ reply: value.slice(0, 1000) });
  }
  setScene(scene: CollegeScene) {
    this.update({ scene });
  }
  send(role: Message['role'], text: string, language: Locale, source: Message['source'] = 'typed') {
    const value = text.trim();
    if (!value) return;
    const message: Message = {
      id: crypto.randomUUID(),
      role,
      text: value.slice(0, 1000),
      language,
      source,
    };
    this.update({ messages: [...this.state.messages, message].slice(-40) });
  }
  clear() {
    this.update({ draft: '', reply: '', messages: [] });
  }
}
export const conversation = new ConversationSession();
