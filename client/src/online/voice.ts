/**
 * Team voice chat, push-to-talk (online only).
 * Capture: getUserMedia (echo cancellation, noise suppression, auto gain) → MediaStreamTrackProcessor → WebCodecs
 * AudioEncoder (Opus 16 kbps, 20 ms frames) → 5 frames per packet → server → teammates.
 * The microphone is opened when the talk button goes down and CLOSED when it is released (the system mic
 * indicator turns off). Playback: one AudioDecoder per speaker, scheduled ~120 ms ahead to absorb network jitter.
 */
import { VOICE, packUp, unpackDown } from '@shared/voice';

type Enc = { configure(c: unknown): void; encode(d: unknown): void; flush(): Promise<void>; close(): void; state: string };
type Dec = { configure(c: unknown): void; decode(c: unknown): void; close(): void; state: string };
interface AudioDataLike { sampleRate: number; numberOfFrames: number; numberOfChannels: number; copyTo(dst: Float32Array, o: { planeIndex: number; format?: string }): void; close(): void }

const W = globalThis as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Whether this WebView can do voice (WebCodecs Opus + track processor + microphone API). */
export const voiceSupported = (): boolean =>
  typeof W.AudioEncoder === 'function' && typeof W.AudioDecoder === 'function' && typeof W.MediaStreamTrackProcessor === 'function' &&
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export type VoiceState = 'idle' | 'opening' | 'talking' | 'denied' | 'unsupported';

export class VoiceChat {
  state: VoiceState = voiceSupported() ? 'idle' : 'unsupported';
  /** Seat id → last time (ms) audio from it was heard (for the "speaking" indicator). */
  readonly heard = new Map<number, number>();
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private stream: MediaStream | null = null;
  private reader: ReadableStreamDefaultReader<AudioDataLike> | null = null;
  private enc: Enc | null = null;
  private pending: Uint8Array[] = [];
  private seq = 0;
  private decoders = new Map<number, { dec: Dec; next: number }>();
  private wantTalk = false;
  private volume = 1;
  enabled = true;

  constructor(private readonly send: (packet: Uint8Array) => void, private readonly onState: (s: VoiceState) => void = () => {}) {}

  setVolume(v: number): void { this.volume = Math.min(1, Math.max(0, v)); if (this.out) this.out.gain.value = this.volume; }

  private audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      this.out = this.ctx.createGain();
      this.out.gain.value = this.volume;
      this.out.connect(this.ctx.destination);
    }
    void this.ctx.resume();
    return this.ctx;
  }

  private set(s: VoiceState): void { if (this.state !== s) { this.state = s; this.onState(s); } }

  /** Talk button pressed. */
  async press(): Promise<void> {
    if (this.state === 'unsupported' || !this.enabled) return;
    this.wantTalk = true;
    if (this.state === 'opening' || this.state === 'talking') return;
    this.set('opening');
    this.audio();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch {
      this.set('denied');
      return;
    }
    if (!this.wantTalk) { this.closeMic(); this.set('idle'); return; } // released while the permission prompt was open
    const track = this.stream.getAudioTracks()[0];
    if (!track) { this.closeMic(); this.set('idle'); return; }
    const proc = new W.MediaStreamTrackProcessor({ track });
    this.reader = proc.readable.getReader() as ReadableStreamDefaultReader<AudioDataLike>;
    this.set('talking');
    void this.pump();
  }

  /** Talk button released: flush what was said and close the microphone. */
  release(): void {
    this.wantTalk = false;
    if (this.state === 'talking') void this.stopTalking();
    else if (this.state === 'denied') this.set('idle');
  }

  private async pump(): Promise<void> {
    const reader = this.reader!;
    for (;;) {
      let r: ReadableStreamReadResult<AudioDataLike>;
      try { r = await reader.read(); } catch { break; }
      if (r.done || !r.value) break;
      const data = r.value;
      if (!this.enc) this.enc = this.makeEncoder(data.sampleRate);
      try { this.enc.encode(data); } catch { /* encoder closed */ }
      data.close();
    }
  }

  private makeEncoder(sampleRate: number): Enc {
    const enc = new W.AudioEncoder({
      output: (chunk: { byteLength: number; copyTo(d: Uint8Array): void }) => {
        const b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        if (b.length > VOICE.maxFrameBytes) return;
        this.pending.push(b);
        if (this.pending.length >= 5) this.flushPacket();
      },
      error: () => { /* dropped; the next press re-creates the encoder */ },
    }) as Enc;
    enc.configure({ codec: 'opus', sampleRate, numberOfChannels: 1, bitrate: VOICE.bitrate, opus: { frameDuration: VOICE.frameMs * 1000, application: 'voip' } });
    return enc;
  }

  private flushPacket(): void {
    if (!this.pending.length) return;
    const frames = this.pending.splice(0, VOICE.maxFrames);
    this.send(packUp(this.seq = (this.seq + 1) & 0xffff, frames));
  }

  private async stopTalking(): Promise<void> {
    try { await this.reader?.cancel(); } catch { /* already closed */ }
    this.reader = null;
    try { if (this.enc && this.enc.state === 'configured') await this.enc.flush(); } catch { /* closed */ }
    this.flushPacket();
    try { this.enc?.close(); } catch { /* closed */ }
    this.enc = null;
    this.closeMic();
    this.set(this.wantTalk ? 'idle' : 'idle');
  }

  private closeMic(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }

  /** A downstream packet from the server. */
  receive(buf: ArrayBuffer): void {
    if (!this.enabled || this.state === 'unsupported') return;
    const p = unpackDown(new Uint8Array(buf));
    if (!p) return;
    const ctx = this.audio();
    let d = this.decoders.get(p.speaker);
    if (!d || d.dec.state === 'closed') {
      const speaker = p.speaker;
      const dec = new W.AudioDecoder({
        output: (a: AudioDataLike) => this.play(speaker, a),
        error: () => this.decoders.delete(speaker),
      }) as Dec;
      dec.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
      d = { dec, next: 0 };
      this.decoders.set(p.speaker, d);
    }
    this.heard.set(p.speaker, performance.now());
    let ts = 0;
    for (const f of p.frames) {
      try { d.dec.decode(new W.EncodedAudioChunk({ type: 'key', timestamp: ts, data: f })); } catch { /* decoder reset */ }
      ts += VOICE.frameMs * 1000;
    }
    void ctx;
  }

  private play(speaker: number, a: AudioDataLike): void {
    const ctx = this.ctx, out = this.out, d = this.decoders.get(speaker);
    if (!ctx || !out || !d) { a.close(); return; }
    const buf = ctx.createBuffer(1, a.numberOfFrames, a.sampleRate);
    const ch = new Float32Array(a.numberOfFrames);
    try { a.copyTo(ch, { planeIndex: 0, format: 'f32-planar' }); } catch { a.close(); return; }
    a.close();
    buf.copyToChannel(ch, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    // Jitter buffer: start ~120 ms ahead; if we fell behind (a gap), restart from now + 120 ms.
    const now = ctx.currentTime;
    if (d.next < now + 0.02) d.next = now + 0.12;
    src.start(d.next);
    d.next += buf.duration;
  }

  /** Seats heard in the last 400 ms. */
  speaking(nowMs = performance.now()): number[] {
    const out: number[] = [];
    for (const [id, t] of this.heard) if (nowMs - t < 400) out.push(id);
    return out;
  }

  dispose(): void {
    this.wantTalk = false;
    void this.reader?.cancel().catch(() => {});
    try { this.enc?.close(); } catch { /* closed */ }
    this.closeMic();
    for (const d of this.decoders.values()) { try { d.dec.close(); } catch { /* closed */ } }
    this.decoders.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}
