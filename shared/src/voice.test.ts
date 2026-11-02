import { describe, expect, it } from 'vitest';
import { VOICE, VoiceBudget, checkUp, packUp, relayDown, unpackDown, voiceRecipients } from './voice';

const frame = (n: number, fill: number): Uint8Array => new Uint8Array(n).fill(fill);

describe('team voice wire format', () => {
  it('pack → check → relay → unpack keeps the audio bytes and adds the speaker', () => {
    const frames = [frame(40, 1), frame(55, 2), frame(38, 3)];
    const up = packUp(513, frames);
    expect(checkUp(up)).toEqual({ seq: 513, n: 3 });
    const down = unpackDown(relayDown(up, 7))!;
    expect(down.speaker).toBe(7);
    expect(down.seq).toBe(513);
    expect(down.frames.map((f) => [...f])).toEqual(frames.map((f) => [...f]));
  });

  it('rejects malformed or oversized packets', () => {
    expect(checkUp(new Uint8Array([0x56, 1, 0, 0, 0]))).toBeNull(); // zero frames
    expect(checkUp(new Uint8Array([0x41, 1, 0, 0, 1, 0, 1, 9]))).toBeNull(); // wrong magic
    const ok = packUp(1, [frame(10, 1)]);
    expect(checkUp(ok.subarray(0, ok.length - 1))).toBeNull(); // truncated
    const extra = new Uint8Array(ok.length + 1); extra.set(ok);
    expect(checkUp(extra)).toBeNull(); // trailing bytes
    expect(checkUp(packUp(1, [frame(VOICE.maxFrameBytes + 1, 1)]))).toBeNull();
    expect(checkUp(new Uint8Array(VOICE.maxPacketBytes + 1))).toBeNull();
    expect(unpackDown(packUp(1, [frame(10, 1)]))).toBeNull(); // an upstream packet is not a downstream one
  });

  it('only connected teammates hear a speaker', () => {
    const team: Record<number, number> = { 0: 0, 1: 0, 2: 0, 6: 1, 7: 1 };
    const to = voiceRecipients(1, (id) => team[id], [0, 1, 2, 6, 7]);
    expect(to.sort()).toEqual([0, 2]);
    expect(voiceRecipients(6, (id) => team[id], [0, 6, 7])).toEqual([7]);
    expect(voiceRecipients(9, (id) => team[id], [0, 1])).toEqual([]);
  });

  it('a speaker cannot flood the room', () => {
    const b = new VoiceBudget();
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (b.allow(1000 + i * 5)) allowed++; // 100 packets in half a second
    expect(allowed).toBe(VOICE.maxPacketsPerSecond);
    expect(b.allow(2100)).toBe(true); // next second
  });
});
