/**
 * Team voice chat wire format (binary WebSocket messages, separate from the JSON protocol).
 * Push-to-talk only; the server relays packets to the speaker's teammates and never decodes, stores or logs audio.
 *
 *   client → server  'V' 0x01 seq:u16 n:u8 { len:u16 opus[len] } × n
 *   server → client  'V' 0x02 speaker:u8 seq:u16 n:u8 { len:u16 opus[len] } × n
 *
 * One packet carries up to VOICE.maxFrames Opus frames of 20 ms (100 ms of audio at 16 kbps ≈ 200-300 bytes).
 */
export const VOICE = {
  magic: 0x56,
  up: 0x01,
  down: 0x02,
  maxFrames: 8,
  maxFrameBytes: 400,
  maxPacketBytes: 1600,
  /** Packets per second a speaker may send (5 frames/packet → 10/s in normal use). */
  maxPacketsPerSecond: 16,
  frameMs: 20,
  bitrate: 16_000,
} as const;

export function packUp(seq: number, frames: readonly Uint8Array[]): Uint8Array {
  const n = Math.min(frames.length, VOICE.maxFrames);
  let size = 5;
  for (let i = 0; i < n; i++) size += 2 + frames[i]!.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = VOICE.magic; out[1] = VOICE.up; dv.setUint16(2, seq & 0xffff); out[4] = n;
  let o = 5;
  for (let i = 0; i < n; i++) { const f = frames[i]!; dv.setUint16(o, f.length); out.set(f, o + 2); o += 2 + f.length; }
  return out;
}

/** Validates an upstream packet (server side). Returns its header + body offset, or null if malformed. */
export function checkUp(buf: Uint8Array): { seq: number; n: number } | null {
  if (buf.length < 5 || buf.length > VOICE.maxPacketBytes || buf[0] !== VOICE.magic || buf[1] !== VOICE.up) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = buf[4]!;
  if (n < 1 || n > VOICE.maxFrames) return null;
  let o = 5;
  for (let i = 0; i < n; i++) {
    if (o + 2 > buf.length) return null;
    const len = dv.getUint16(o);
    if (len < 1 || len > VOICE.maxFrameBytes || o + 2 + len > buf.length) return null;
    o += 2 + len;
  }
  if (o !== buf.length) return null;
  return { seq: dv.getUint16(2), n };
}

/** Server: turns a valid upstream packet into the downstream one (speaker id inserted, audio untouched). */
export function relayDown(up: Uint8Array, speaker: number): Uint8Array {
  const out = new Uint8Array(up.length + 1);
  out[0] = VOICE.magic; out[1] = VOICE.down; out[2] = speaker & 0xff;
  out.set(up.subarray(2), 3);
  return out;
}

export function unpackDown(buf: Uint8Array): { speaker: number; seq: number; frames: Uint8Array[] } | null {
  if (buf.length < 6 || buf[0] !== VOICE.magic || buf[1] !== VOICE.down) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const speaker = buf[2]!, seq = dv.getUint16(3), n = buf[5]!;
  if (n < 1 || n > VOICE.maxFrames) return null;
  const frames: Uint8Array[] = [];
  let o = 6;
  for (let i = 0; i < n; i++) {
    if (o + 2 > buf.length) return null;
    const len = dv.getUint16(o);
    if (len < 1 || o + 2 + len > buf.length) return null;
    frames.push(buf.slice(o + 2, o + 2 + len));
    o += 2 + len;
  }
  return { speaker, seq, frames };
}

/** Who hears a speaker: connected teammates only, never the speaker. */
export function voiceRecipients(speaker: number, teamOf: (id: number) => number | undefined, connected: Iterable<number>): number[] {
  const team = teamOf(speaker);
  if (team === undefined) return [];
  const out: number[] = [];
  for (const id of connected) if (id !== speaker && teamOf(id) === team) out.push(id);
  return out;
}

/** Per-socket packet budget (sliding one-second window). */
export class VoiceBudget {
  private start = 0;
  private n = 0;
  allow(nowMs: number): boolean {
    if (nowMs - this.start >= 1000) { this.start = nowMs; this.n = 0; }
    return ++this.n <= VOICE.maxPacketsPerSecond;
  }
}
