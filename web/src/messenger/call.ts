/**
 * One-to-one video call over WebRTC. Signalling (invite, ring, accept, SDP and
 * ICE) and live captions go through the SignTalk server's WebSocket; audio and
 * video flow peer-to-peer (or via TURN when configured on the server).
 */
import { useSyncExternalStore } from 'react';
import type { User } from './api';
import { messenger, type ServerEvent } from './store';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';
export type CaptionSource = 'sign' | 'speech' | 'text' | 'status';

export interface CallSnapshot {
  phase: CallPhase;
  callId: string | null;
  peer: User | null;
  direction: 'out' | 'in' | null;
  /** When media started flowing. */
  startedAt: number | null;
  endStatus: string | null;
  endReason: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  mediaNote: 'no-camera' | 'no-microphone' | 'no-media' | null;
  /** Waiting for the browser's camera/microphone permission. */
  mediaPending: boolean;
  remoteCaption: { text: string; source: CaptionSource; final: boolean; at: number } | null;
}

const IDLE: CallSnapshot = {
  phase: 'idle',
  callId: null,
  peer: null,
  direction: null,
  startedAt: null,
  endStatus: null,
  endReason: null,
  localStream: null,
  remoteStream: null,
  micOn: true,
  camOn: true,
  mediaNote: null,
  mediaPending: false,
  remoteCaption: null,
};

type Signal = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

async function openMedia(): Promise<{
  stream: MediaStream | null;
  note: CallSnapshot['mediaNote'];
}> {
  if (!('mediaDevices' in navigator) || typeof navigator.mediaDevices.getUserMedia !== 'function')
    return { stream: null, note: 'no-media' };
  const video: MediaTrackConstraints = {
    facingMode: 'user',
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 24, max: 30 },
  };
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };
  const attempts: [MediaStreamConstraints, CallSnapshot['mediaNote']][] = [
    [{ video, audio }, null],
    [{ video, audio: false }, 'no-microphone'],
    [{ video: false, audio }, 'no-camera'],
  ];
  for (const [constraints, note] of attempts) {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia(constraints), note };
    } catch {
      /* try the next combination */
    }
  }
  return { stream: null, note: 'no-media' };
}

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export class CallManager {
  private snapshot: CallSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private pc: RTCPeerConnection | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private ice: RTCIceServer[] | null = null;
  private dismissTimer: number | null = null;
  private ringer: Ringer | null = null;
  private skipMedia: (() => void) | null = null;

  constructor() {
    messenger.onEvent((event) => {
      this.onEvent(event);
    });
    window.addEventListener('pagehide', () => {
      // A closed tab must not decline a call that still rings on the person's other devices.
      if (this.snapshot.phase !== 'incoming') this.hangUp();
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): CallSnapshot => this.snapshot;
  private set(patch: Partial<CallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  get busy(): boolean {
    return this.snapshot.phase !== 'idle' && this.snapshot.phase !== 'ended';
  }

  /** Camera and microphone, unless the person chooses to continue without them. */
  private async acquireMedia(): Promise<{
    stream: MediaStream | null;
    note: CallSnapshot['mediaNote'];
  }> {
    const skipped = new Promise<null>((resolve) => {
      this.skipMedia = () => {
        resolve(null);
      };
    });
    this.set({ mediaPending: true });
    const media = openMedia();
    const result = await Promise.race([media, skipped]);
    this.skipMedia = null;
    this.set({ mediaPending: false });
    if (result) return result;
    void media.then(({ stream }) => {
      stopStream(stream);
    });
    return { stream: null, note: 'no-media' };
  }

  /** Go on with the call while the permission prompt is still open (or never answered). */
  continueWithoutMedia(): void {
    this.skipMedia?.();
  }

  // --- user actions --------------------------------------------------------------
  async start(peer: User): Promise<void> {
    if (this.busy) return;
    this.clearDismiss();
    const callId = crypto.randomUUID();
    this.set({ ...IDLE, phase: 'outgoing', callId, peer, direction: 'out' });
    const [{ stream, note }, ice] = await Promise.all([
      this.acquireMedia(),
      messenger.iceServers(),
    ]);
    if (this.snapshot.callId !== callId) {
      stopStream(stream);
      return;
    }
    this.ice = ice;
    this.set({
      localStream: stream,
      mediaNote: note,
      micOn: hasTrack(stream, 'audio'),
      camOn: hasTrack(stream, 'video'),
    });
    if (!messenger.wsSend({ type: 'call:invite', callId, to: peer.id })) {
      this.finish('failed', 'offline_self');
      return;
    }
    this.ringer = new Ringer('ringback');
  }

  async accept(): Promise<void> {
    const { phase, callId } = this.snapshot;
    if (phase !== 'incoming' || !callId) return;
    this.ringer?.stop();
    this.ringer = null;
    this.set({ phase: 'connecting' });
    const [{ stream, note }, ice] = await Promise.all([
      this.acquireMedia(),
      messenger.iceServers(),
    ]);
    if (this.snapshot.callId !== callId) {
      stopStream(stream);
      return;
    }
    this.ice = ice;
    this.set({
      localStream: stream,
      mediaNote: note,
      micOn: hasTrack(stream, 'audio'),
      camOn: hasTrack(stream, 'video'),
    });
    this.createPeer();
    if (!messenger.wsSend({ type: 'call:accept', callId })) this.finish('failed', 'offline_self');
  }

  reject(): void {
    const { phase, callId } = this.snapshot;
    if (phase !== 'incoming' || !callId) return;
    messenger.wsSend({ type: 'call:reject', callId });
    this.finish('declined', 'declined');
  }

  hangUp(): void {
    const { callId } = this.snapshot;
    if (!this.busy || !callId) return;
    messenger.wsSend({ type: 'call:end', callId });
    this.finish(this.snapshot.startedAt ? 'completed' : 'cancelled', 'hung_up');
  }

  dismiss(): void {
    if (this.snapshot.phase !== 'ended') return;
    this.clearDismiss();
    this.set(IDLE);
  }

  toggleMic(): void {
    const tracks = this.snapshot.localStream?.getAudioTracks() ?? [];
    if (!tracks.length) return;
    const on = !this.snapshot.micOn;
    for (const t of tracks) t.enabled = on;
    this.set({ micOn: on });
  }

  toggleCam(): void {
    const tracks = this.snapshot.localStream?.getVideoTracks() ?? [];
    if (!tracks.length) return;
    const on = !this.snapshot.camOn;
    for (const t of tracks) t.enabled = on;
    this.set({ camOn: on });
  }

  /** Live caption for the other person (not stored; final words are also sent as chat messages). */
  sendCaption(text: string, source: CaptionSource, final: boolean): void {
    const { callId, phase } = this.snapshot;
    if (!callId || (phase !== 'active' && phase !== 'connecting')) return;
    messenger.wsSend({ type: 'call:caption', callId, text, source, final });
  }

  // --- signalling --------------------------------------------------------------------
  private onEvent(event: ServerEvent): void {
    const callId = event['callId'] as string | undefined;
    switch (event.type) {
      case 'call:incoming': {
        if (this.busy) return; // the server only rings when the user is free, but be safe
        this.clearDismiss();
        this.set({
          ...IDLE,
          phase: 'incoming',
          callId: callId ?? null,
          peer: event['from'] as User,
          direction: 'in',
        });
        this.ringer = new Ringer('ring');
        return;
      }
      case 'local:disconnected':
        if (this.busy) this.finish('failed', 'connection_lost');
        return;
      case 'local:signed-out':
        if (this.busy) this.finish('cancelled', 'signed_out');
        this.dismiss();
        return;
    }
    if (!callId || callId !== this.snapshot.callId) return;
    switch (event.type) {
      case 'call:accepted':
        if (this.snapshot.phase === 'outgoing') void this.makeOffer();
        break;
      case 'call:taken':
        if (this.snapshot.phase === 'incoming') {
          this.ringer?.stop();
          this.ringer = null;
          this.set(IDLE);
        }
        break;
      case 'call:signal':
        void this.onSignal(event['data'] as Signal);
        break;
      case 'call:caption':
        this.set({
          remoteCaption: {
            text: typeof event['text'] === 'string' ? event['text'] : '',
            source: event['source'] as CaptionSource,
            final: event['final'] === true,
            at: Date.now(),
          },
        });
        break;
      case 'call:ended':
        if (this.snapshot.phase === 'incoming' && event['reason'] !== 'timeout') {
          this.finish(String(event['status']), String(event['reason']));
          this.dismiss();
        } else this.finish(String(event['status']), String(event['reason']));
        break;
    }
  }

  private createPeer(): RTCPeerConnection {
    this.pc?.close();
    const pc = new RTCPeerConnection({
      iceServers: this.ice ?? [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    this.pc = pc;
    this.pendingCandidates = [];
    pc.onicecandidate = (e) => {
      if (e.candidate && this.pc === pc) this.signal({ candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      if (this.pc !== pc) return;
      const current = this.snapshot.remoteStream;
      const stream = e.streams[0] ?? current ?? new MediaStream();
      if (!e.streams[0] && !stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      // A new MediaStream object makes React re-attach the <video>.
      this.set({ remoteStream: new MediaStream(stream.getTracks()) });
      e.track.onunmute = () => {
        if (this.pc === pc) this.set({ remoteStream: new MediaStream(stream.getTracks()) });
      };
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected' && this.snapshot.phase !== 'active')
        this.set({ phase: 'active', startedAt: this.snapshot.startedAt ?? Date.now() });
      if (pc.connectionState === 'failed') {
        const { callId } = this.snapshot;
        if (callId) messenger.wsSend({ type: 'call:end', callId });
        this.finish('failed', 'network');
      }
    };
    return pc;
  }

  private async makeOffer(): Promise<void> {
    this.ringer?.stop();
    this.ringer = null;
    this.set({ phase: 'connecting' });
    const pc = this.createPeer();
    const local = this.snapshot.localStream;
    for (const kind of ['audio', 'video'] as const) {
      const track = local?.getTracks().find((t) => t.kind === kind);
      if (track && local) pc.addTrack(track, local);
      else pc.addTransceiver(kind, { direction: 'recvonly' });
    }
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if (this.pc === pc && pc.localDescription) this.signal({ sdp: pc.localDescription.toJSON() });
    } catch {
      this.hangUp();
    }
  }

  private async onSignal(data: Signal): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        for (const c of this.pendingCandidates.splice(0))
          await pc.addIceCandidate(c).catch(() => undefined);
        if (data.sdp.type === 'offer') {
          const local = this.snapshot.localStream;
          if (local) for (const track of local.getTracks()) pc.addTrack(track, local);
          await pc.setLocalDescription(await pc.createAnswer());
          if (this.pc === pc && pc.localDescription)
            this.signal({ sdp: pc.localDescription.toJSON() });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => undefined);
        else this.pendingCandidates.push(data.candidate);
      }
    } catch {
      this.hangUp();
    }
  }

  private signal(data: Signal): void {
    const { callId } = this.snapshot;
    if (callId) messenger.wsSend({ type: 'call:signal', callId, data });
  }

  private finish(status: string, reason: string): void {
    this.ringer?.stop();
    this.ringer = null;
    this.pc?.close();
    this.pc = null;
    this.pendingCandidates = [];
    stopStream(this.snapshot.localStream);
    this.set({
      phase: 'ended',
      endStatus: status,
      endReason: reason,
      localStream: null,
      remoteStream: null,
      remoteCaption: null,
    });
    this.clearDismiss();
    this.dismissTimer = window.setTimeout(() => {
      this.dismiss();
    }, 3500);
  }

  private clearDismiss(): void {
    if (this.dismissTimer !== null) window.clearTimeout(this.dismissTimer);
    this.dismissTimer = null;
  }
}

function hasTrack(stream: MediaStream | null, kind: 'audio' | 'video'): boolean {
  return !!stream?.getTracks().some((t) => t.kind === kind);
}

/** A soft ring (incoming) or ring-back tone (outgoing), plus vibration on phones. */
class Ringer {
  private context: AudioContext | null = null;
  private timer: number | null = null;
  constructor(kind: 'ring' | 'ringback') {
    try {
      this.context = new AudioContext();
      const beep = () => {
        const ctx = this.context;
        if (!ctx) return;
        void ctx.resume().catch(() => undefined);
        const tones = kind === 'ring' ? [880, 0.18, 660, 0.18] : [440, 0.9];
        let at = ctx.currentTime;
        for (let i = 0; i < tones.length; i += 2) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = tones[i] ?? 440;
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(kind === 'ring' ? 0.12 : 0.05, at + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + (tones[i + 1] ?? 0.2));
          osc.connect(gain).connect(ctx.destination);
          osc.start(at);
          osc.stop(at + (tones[i + 1] ?? 0.2));
          at += (tones[i + 1] ?? 0.2) + 0.05;
        }
        if (kind === 'ring' && 'vibrate' in navigator) navigator.vibrate([200, 100, 200]);
      };
      beep();
      this.timer = window.setInterval(beep, kind === 'ring' ? 1800 : 3000);
    } catch {
      this.context = null;
    }
  }
  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    if ('vibrate' in navigator) navigator.vibrate(0);
  }
}

export const calls = new CallManager();

export function useCall(): CallSnapshot {
  return useSyncExternalStore(calls.subscribe, calls.getSnapshot);
}
