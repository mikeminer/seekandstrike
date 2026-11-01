/**
 * Procedural WebAudio SFX (no audio assets in stage 1): rifle report (noise crack + low
 * thump + tail), distant shots filtered by distance, impacts, reload clicks, hit marker,
 * charge beeps. Context is created on the first user gesture and suspended when hidden.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private active = 0;

  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.5; }
  }

  suspend(): void { void this.ctx?.suspend(); }
  resume(): void { void this.ctx?.resume(); }

  private burst(opts: { gain: number; freq: number; q: number; dur: number; type?: BiquadFilterType; delay?: number; pan?: number }): void {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master || !this.noise || this.active > 24) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass'; f.frequency.value = opts.freq; f.Q.value = opts.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + opts.dur);
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    src.connect(f).connect(g).connect(p).connect(master);
    src.start(t0, Math.random() * 0.5, opts.dur + 0.05);
    this.active++;
    src.onended = () => { this.active--; src.disconnect(); g.disconnect(); p.disconnect(); };
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }

  /** distance in metres, pan -1..1 (left/right of the listener). */
  shot(distance: number, pan: number, own: boolean): void {
    const att = own ? 1 : Math.min(0.9, 9 / Math.max(9, distance));
    const delay = own ? 0 : Math.min(0.25, distance / 343);
    const far = Math.min(1, distance / 80);
    this.burst({ gain: 0.9 * att, freq: 2600 - far * 1800, q: 0.7, dur: 0.07, delay, pan });
    this.burst({ gain: 1.1 * att, freq: 180, q: 0.9, dur: 0.18 + far * 0.2, type: 'lowpass', delay, pan });
    this.burst({ gain: 0.25 * att, freq: 900, q: 0.4, dur: 0.5 + far * 0.6, type: 'lowpass', delay: delay + 0.04, pan });
  }

  impact(distance: number, metal: boolean): void {
    if (distance > 60) return;
    const att = Math.min(0.6, 4 / Math.max(4, distance));
    if (metal) this.tone(1800 + Math.random() * 1400, 0.09, 0.12 * att, 'triangle');
    this.burst({ gain: 0.35 * att, freq: metal ? 3500 : 1200, q: 1.2, dur: 0.06 });
  }

  /** Near-miss supersonic crack. */
  crack(pan: number): void { this.burst({ gain: 0.5, freq: 4200, q: 1.5, dur: 0.035, pan }); }

  /** distance in metres: 0 = own weapon, others are quieter and silent beyond 30 m. */
  reload(empty: boolean, distance = 0): void {
    if (distance > 30) return;
    const att = Math.min(1, 4 / Math.max(4, distance));
    this.tone(320, 0.05, 0.15 * att, 'square', 0.25);
    this.tone(240, 0.06, 0.18 * att, 'square', 1.0);
    if (empty) this.tone(500, 0.05, 0.18 * att, 'square', 1.9);
  }

  hit(head: boolean): void { this.tone(head ? 1900 : 1300, 0.05, 0.12, 'triangle'); }
  hurt(): void { this.burst({ gain: 0.4, freq: 240, q: 1, dur: 0.15, type: 'lowpass' }); }
  beep(urgent: boolean): void { this.tone(urgent ? 1760 : 1320, 0.07, 0.08, 'sine'); }
  /** distance in metres (0 = the charge/own blast, full volume). */
  explosion(distance = 0, pan = 0): void {
    const att = Math.min(1, 14 / Math.max(14, distance));
    this.burst({ gain: 1.6 * att, freq: 120, q: 0.6, dur: 1.8, type: 'lowpass', pan });
    this.burst({ gain: 0.8 * att, freq: 900, q: 0.5, dur: 0.6, type: 'lowpass', pan });
  }
  /** Grenade leaving the hand. */
  throwGrenade(distance = 0, pan = 0): void {
    if (distance > 40) return;
    const att = Math.min(1, 6 / Math.max(6, distance));
    this.burst({ gain: 0.3 * att, freq: 700, q: 0.8, dur: 0.22, pan });
    this.tone(1500, 0.04, 0.08 * att, 'triangle'); // spoon release
  }
  /** Metallic clink of a grenade on a surface. */
  bounce(distance: number, pan = 0): void {
    if (distance > 45) return;
    const att = Math.min(0.8, 5 / Math.max(5, distance));
    this.tone(1800 + Math.random() * 900, 0.1, 0.14 * att, 'triangle');
    this.burst({ gain: 0.4 * att, freq: 2400, q: 1.1, dur: 0.07, pan });
  }
  ui(): void { this.tone(880, 0.05, 0.06, 'sine'); }

  dispose(): void { void this.ctx?.close(); this.ctx = null; }
}
