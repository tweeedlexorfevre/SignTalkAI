/**
 * The messenger session: account, contacts, chat histories and the realtime
 * WebSocket. Framework-free; React reads it through useSyncExternalStore.
 * Call signalling events are forwarded to listeners (see call.ts).
 */
import { useSyncExternalStore } from 'react';
import { parseCallBody } from './format';
import {
  ApiError,
  readToken,
  request,
  writeToken,
  type AuthResult,
  type Contact,
  type Device,
  type Message,
  type MessageKind,
  type User,
} from './api';

export interface ChatState {
  messages: Message[];
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
}

export interface MessengerSnapshot {
  auth: 'checking' | 'anon' | 'ready';
  user: User | null;
  sessionId: number | null;
  connection: 'offline' | 'connecting' | 'online';
  contacts: Contact[];
  contactsLoaded: boolean;
  chats: Readonly<Record<string, ChatState>>;
  activeChat: string | null;
  /** Peer IDs currently typing. */
  typing: Readonly<Record<string, boolean>>;
}

/** Events from the server that the call manager handles. */
export type ServerEvent = { type: string } & Record<string, unknown>;

const EMPTY_CHAT: ChatState = { messages: [], loaded: false, loading: false, hasMore: false };

export function mergeMessages(
  current: readonly Message[],
  incoming: readonly Message[],
): Message[] {
  const byId = new Map<number, Message>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** Every message counts, except calls that were answered. */
function countsAsUnread(message: Message): boolean {
  return message.kind !== 'call' || parseCallBody(message.body).status !== 'completed';
}

function sortContacts(list: Contact[]): Contact[] {
  return [...list].sort(
    (a, b) => (b.lastMessage?.createdAt ?? b.addedAt) - (a.lastMessage?.createdAt ?? a.addedAt),
  );
}

export class Messenger {
  private snapshot: MessengerSnapshot = {
    auth: 'checking',
    user: null,
    sessionId: null,
    connection: 'offline',
    contacts: [],
    contactsLoaded: false,
    chats: {},
    activeChat: null,
    typing: {},
  };
  private token: string | null = null;
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: number | null = null;
  private pingTimer: number | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: ServerEvent) => void>();
  private lastTypingSent = 0;
  private readonly typingTimers = new Map<string, number>();
  /** Local arrival time of messages received live (server clocks may differ). */
  private readonly arrivals = new Map<number, number>();

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.snapshot.activeChat)
        this.markRead(this.snapshot.activeChat);
    });
    window.addEventListener('online', () => {
      if (this.token && !this.ws) this.connect();
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): MessengerSnapshot => this.snapshot;
  private set(patch: Partial<MessengerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }
  onEvent(listener: (event: ServerEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Signed-in request to the REST API (used by the personal gesture library). */
  authed<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.api<T>(method, path, body);
  }

  private api<T>(method: string, path: string, body?: unknown): Promise<T> {
    return request<T>(
      method,
      path,
      body === undefined ? { token: this.token } : { token: this.token, body },
    ).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401 && this.token) this.signedOut();
      throw error;
    });
  }

  // --- account -----------------------------------------------------------------
  async init(): Promise<void> {
    const token = readToken();
    if (!token) {
      this.set({ auth: 'anon' });
      return;
    }
    this.token = token;
    try {
      const me = await request<{ user: User; sessionId: number }>('GET', '/me', { token });
      this.start(me.user, me.sessionId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.signedOut();
      else {
        // Offline at start-up: keep the token and retry, so a flaky network does not sign people out.
        this.set({ auth: 'checking' });
        window.setTimeout(() => void this.init(), 4000);
      }
    }
  }

  async register(username: string, displayName: string, password: string): Promise<void> {
    const result = await request<AuthResult>('POST', '/auth/register', {
      body: { username, displayName, password },
    });
    this.signedIn(result);
  }

  async login(login: string, password: string): Promise<void> {
    const result = await request<AuthResult>('POST', '/auth/login', { body: { login, password } });
    this.signedIn(result);
  }

  async logout(): Promise<void> {
    try {
      await this.api('POST', '/auth/logout', {});
    } catch {
      /* signed out locally either way */
    }
    this.signedOut();
  }

  private signedIn(result: AuthResult): void {
    this.token = result.token;
    writeToken(result.token);
    this.start(result.user, result.sessionId);
  }

  private start(user: User, sessionId: number): void {
    this.set({ auth: 'ready', user, sessionId });
    void this.refreshContacts();
    this.connect();
  }

  private signedOut(): void {
    this.token = null;
    writeToken(null);
    this.disconnect();
    this.emit({ type: 'local:signed-out' });
    this.set({
      auth: 'anon',
      user: null,
      sessionId: null,
      contacts: [],
      contactsLoaded: false,
      chats: {},
      activeChat: null,
      typing: {},
    });
  }

  async rename(displayName: string): Promise<void> {
    const { user } = await this.api<{ user: User }>('PATCH', '/me', { displayName });
    this.set({ user });
  }

  async devices(): Promise<Device[]> {
    return (await this.api<{ devices: Device[] }>('GET', '/devices')).devices;
  }

  async revokeDevice(id: number): Promise<void> {
    await this.api('DELETE', `/devices/${id}`);
    if (id === this.snapshot.sessionId) this.signedOut();
  }

  async iceServers(): Promise<RTCIceServer[]> {
    try {
      return (await this.api<{ iceServers: RTCIceServer[] }>('GET', '/ice')).iceServers;
    } catch {
      return [{ urls: 'stun:stun.l.google.com:19302' }];
    }
  }

  // --- contacts ----------------------------------------------------------------
  async refreshContacts(): Promise<void> {
    try {
      const { contacts } = await this.api<{ contacts: Contact[] }>('GET', '/contacts');
      this.set({ contacts: sortContacts(contacts), contactsLoaded: true });
    } catch {
      this.set({ contactsLoaded: true });
    }
  }

  lookup(query: string): Promise<{ user: User; self: boolean; contact: boolean }> {
    return this.api('GET', `/users/lookup?q=${encodeURIComponent(query.trim())}`);
  }

  async addContact(id: string): Promise<Contact> {
    const { contact } = await this.api<{ contact: Contact }>('POST', '/contacts', { id });
    this.upsertContact(contact);
    return contact;
  }

  async removeContact(id: string): Promise<void> {
    await this.api('DELETE', `/contacts/${id}`);
    this.set({
      contacts: this.snapshot.contacts.filter((c) => c.user.id !== id),
      activeChat: this.snapshot.activeChat === id ? null : this.snapshot.activeChat,
    });
  }

  contact(id: string | null): Contact | undefined {
    return id ? this.snapshot.contacts.find((c) => c.user.id === id) : undefined;
  }

  private upsertContact(contact: Contact): void {
    const rest = this.snapshot.contacts.filter((c) => c.user.id !== contact.user.id);
    this.set({ contacts: sortContacts([...rest, contact]) });
  }

  private patchContact(id: string, patch: (c: Contact) => Partial<Contact>): void {
    const index = this.snapshot.contacts.findIndex((c) => c.user.id === id);
    const current = this.snapshot.contacts[index];
    if (!current) return;
    const contacts = [...this.snapshot.contacts];
    contacts[index] = { ...current, ...patch(current) };
    this.set({ contacts: sortContacts(contacts) });
  }

  private setTyping(id: string, on: boolean): void {
    const timer = this.typingTimers.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    this.typingTimers.delete(id);
    if (on)
      this.typingTimers.set(
        id,
        window.setTimeout(() => {
          this.setTyping(id, false);
        }, 4000),
      );
    if (!!this.snapshot.typing[id] === on) return;
    this.set({
      typing: Object.fromEntries(
        Object.entries({ ...this.snapshot.typing, [id]: on }).filter(([, value]) => value),
      ),
    });
  }

  /** When a live message reached this device, or undefined for history. */
  arrivedAt(id: number): number | undefined {
    return this.arrivals.get(id);
  }

  // --- chats -------------------------------------------------------------------
  chat(id: string): ChatState {
    return this.snapshot.chats[id] ?? EMPTY_CHAT;
  }

  private setChat(id: string, patch: Partial<ChatState>): void {
    this.set({ chats: { ...this.snapshot.chats, [id]: { ...this.chat(id), ...patch } } });
  }

  openChat(id: string | null): void {
    this.set({ activeChat: id });
    if (!id) return;
    if (!this.chat(id).loaded) void this.loadHistory(id);
    this.markRead(id);
  }

  async loadHistory(id: string, older = false): Promise<void> {
    const chat = this.chat(id);
    if (chat.loading) return;
    this.setChat(id, { loading: true });
    const before = older ? chat.messages[0]?.id : undefined;
    try {
      const { messages, hasMore } = await this.api<{ messages: Message[]; hasMore: boolean }>(
        'GET',
        `/chats/${id}/messages?limit=50${before ? `&before=${before}` : ''}`,
      );
      const current = this.chat(id);
      this.setChat(id, {
        messages: mergeMessages(current.messages, messages),
        loaded: true,
        loading: false,
        hasMore: older || !current.loaded ? hasMore : current.hasMore,
      });
      if (this.snapshot.activeChat === id) this.markRead(id);
    } catch (error) {
      this.setChat(id, { loading: false, loaded: true });
      throw error;
    }
  }

  async send(
    to: string,
    body: string,
    kind: Exclude<MessageKind, 'call'> = 'text',
  ): Promise<Message> {
    const { message } = await this.api<{ message: Message }>('POST', `/chats/${to}/messages`, {
      kind,
      body,
    });
    this.receive(message);
    return message;
  }

  markRead(id: string): void {
    const contact = this.contact(id);
    if (document.visibilityState !== 'visible') return;
    const lastFromPeer = [...this.chat(id).messages]
      .reverse()
      .find((m) => m.from === id && !m.readAt);
    if (!lastFromPeer && !contact?.unread) return;
    const upTo = lastFromPeer?.id ?? contact?.lastMessage?.id;
    if (!upTo) return;
    this.patchContact(id, () => ({ unread: 0 }));
    this.api('POST', `/chats/${id}/read`, { upTo }).catch(() => undefined);
  }

  sendTyping(to: string): void {
    const now = Date.now();
    if (now - this.lastTypingSent < 2500) return;
    this.lastTypingSent = now;
    this.wsSend({ type: 'typing', to });
  }

  private receive(message: Message): void {
    const me = this.snapshot.user?.id;
    if (!me) return;
    if (!this.arrivals.has(message.id)) this.arrivals.set(message.id, Date.now());
    const peer = message.from === me ? message.to : message.from;
    const chat = this.chat(peer);
    // Live messages can arrive while the first history request is still in flight.
    this.setChat(peer, { messages: mergeMessages(chat.messages, [message]) });
    const incoming = message.from === peer;
    if (incoming) this.setTyping(peer, false);
    if (!this.contact(peer)) {
      void this.refreshContacts();
      return;
    }
    const viewing = this.snapshot.activeChat === peer && document.visibilityState === 'visible';
    this.patchContact(peer, (c) => ({
      lastMessage: c.lastMessage && c.lastMessage.id > message.id ? c.lastMessage : message,
      unread: incoming && !viewing && countsAsUnread(message) ? c.unread + 1 : c.unread,
    }));
    if (incoming) {
      if (viewing) this.markRead(peer);
    }
  }

  // --- realtime ----------------------------------------------------------------
  wsSend(message: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN || this.snapshot.connection !== 'online')
      return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  private connect(): void {
    if (!this.token || this.ws) return;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const url = new URL(`${import.meta.env.BASE_URL}ws`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.ws = ws;
    this.set({ connection: 'connecting' });
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: this.token }));
    };
    ws.onmessage = (event: MessageEvent<string>) => {
      let data: ServerEvent;
      try {
        data = JSON.parse(event.data) as ServerEvent;
      } catch {
        return;
      }
      this.onServerEvent(data);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.set({ connection: 'offline' });
      this.emit({ type: 'local:disconnected' });
      if (event.code === 4001 || event.code === 4003) {
        this.signedOut();
        return;
      }
      if (!this.token) return;
      const delay = Math.min(15000, 1000 * 2 ** this.retry++);
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        this.connect();
      }, delay);
    };
  }

  private disconnect(): void {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.set({ connection: 'offline' });
  }

  private emit(event: ServerEvent): void {
    for (const l of this.eventListeners) l(event);
  }

  private onServerEvent(event: ServerEvent): void {
    switch (event.type) {
      case 'ready': {
        this.retry = 0;
        const online = new Set(event['online'] as string[]);
        this.set({
          connection: 'online',
          user: event['user'] as User,
          contacts: this.snapshot.contacts.map((c) => ({ ...c, online: online.has(c.user.id) })),
        });
        this.pingTimer = window.setInterval(() => {
          this.wsSend({ type: 'ping', t: Date.now() });
        }, 25000);
        // Catch up on anything missed while disconnected.
        void this.refreshContacts();
        for (const id of Object.keys(this.snapshot.chats))
          if (this.chat(id).loaded) void this.loadHistory(id).catch(() => undefined);
        break;
      }
      case 'presence':
        this.patchContact(event['user'] as string, () => ({ online: event['online'] === true }));
        break;
      case 'message:new':
        this.receive(event['message'] as Message);
        break;
      case 'read': {
        const me = this.snapshot.user?.id;
        const reader = event['reader'] as string;
        const peer = event['peer'] as string;
        const upTo = event['upTo'] as number;
        if (reader === me) this.patchContact(peer, () => ({ unread: 0 }));
        else {
          const chat = this.snapshot.chats[reader];
          if (chat)
            this.setChat(reader, {
              messages: chat.messages.map((m) =>
                m.from === me && m.id <= upTo && !m.readAt
                  ? { ...m, readAt: event['readAt'] as number }
                  : m,
              ),
            });
          this.patchContact(reader, (c) =>
            c.lastMessage && c.lastMessage.from === me && c.lastMessage.id <= upTo
              ? { lastMessage: { ...c.lastMessage, readAt: event['readAt'] as number } }
              : {},
          );
        }
        break;
      }
      case 'contact:added':
        this.upsertContact(event['contact'] as Contact);
        break;
      case 'contact:removed':
        this.set({ contacts: this.snapshot.contacts.filter((c) => c.user.id !== event['user']) });
        break;
      case 'typing':
        this.setTyping(event['from'] as string, true);
        break;
      case 'session:revoked':
        this.signedOut();
        break;
      default:
        if (event.type.startsWith('call:') || event.type === 'gestures:changed') this.emit(event);
    }
  }
}

export const messenger = new Messenger();

export function useMessenger(): MessengerSnapshot {
  return useSyncExternalStore(messenger.subscribe, messenger.getSnapshot);
}
