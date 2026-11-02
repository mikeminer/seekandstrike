/**
 * Procedural WebAudio SFX (no audio assets). Rifle report in layers (transient crack, body, low thump with a
 * pitch drop, outdoor slap-back through a generated reverb), distance filtering and delay, impacts, reloads,
 * footsteps (own and nearby enemies, panned: they tell where people are), hit / headshot / takedown confirms,
 * level-up and challenge stingers. Context is created on the first user gesture and suspended when hidden.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private verbIn: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private active = 0;
  private volume = 0.8;

  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6 * this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.15;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 1.2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.5; }
    // Outdoor reverb: sparse early reflections (quay walls) + a short diffuse decay, generated once.
    const irLen = Math.floor(ctx.sampleRate * 1.1);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const o = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) { const tt = i / ctx.sampleRate; o[i] = (Math.random() * 2 - 1) * Math.exp(-tt * 5.5) * 0.35; }
      for (const [at, g] of [[0.045, 0.5], [0.083, 0.35], [0.14, 0.28], [0.21, 0.18]] as const) {
        const k = Math.floor((at + ch * 0.007) * ctx.sampleRate);
        for (let j = 0; j < 60 && k + j < irLen; j++) o[k + j]! += (Math.random() * 2 - 1) * g * (1 - j / 60);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.verbIn = ctx.createGain();
    this.verbIn.gain.value = 0.55;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    this.verbIn.connect(lp).connect(conv).connect(this.master);
  }

  /** 0..1 (settings). */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(0.6 * this.volume, this.ctx.currentTime, 0.02);
  }

  suspend(): void { void this.ctx?.suspend(); }
  resume(): void { void this.ctx?.resume(); }

  private burst(opts: { gain: number; freq: number; q: number; dur: number; type?: BiquadFilterType; delay?: number; pan?: number; verb?: number; attack?: number }): void {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master || !this.noise || this.active > 32) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass'; f.frequency.value = opts.freq; f.Q.value = opts.q;
    const g = ctx.createGain();
    if (opts.attack) { g.gain.setValueAtTime(0.0008, t0); g.gain.exponentialRampToValueAtTime(opts.gain, t0 + opts.attack); }
    else g.gain.setValueAtTime(opts.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + opts.dur);
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    src.connect(f).connect(g).connect(p).connect(master);
    let send: GainNode | null = null;
    if (opts.verb && this.verbIn) { send = ctx.createGain(); send.gain.value = opts.verb; p.connect(send).connect(this.verbIn); }
    src.start(t0, Math.random() * 0.5, opts.dur + 0.05);
    this.active++;
    src.onended = () => { this.active--; src.disconnect(); g.disconnect(); p.disconnect(); send?.disconnect(); };
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0, toFreq?: number, pan = 0): void {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p).connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
    o.onended = () => { o.disconnect(); g.disconnect(); p.disconnect(); };
  }

  /** distance in metres, pan -1..1 (left/right of the listener). */
  shot(distance: number, pan: number, own: boolean, heavy = false): void {
    if (heavy) { this.heavyShot(distance, pan, own); return; }
    const att = own ? 1 : Math.min(0.9, 9 / Math.max(9, distance));
    const delay = own ? 0 : Math.min(0.25, distance / 343);
    const far = Math.min(1, distance / 80);
    if (own || distance < 25) this.burst({ gain: 0.7 * att, freq: 7000, q: 0.5, dur: 0.025, type: 'highpass', delay, pan }); // transient crack
    this.burst({ gain: 0.95 * att, freq: 2400 - far * 1700, q: 0.7, dur: 0.08, delay, pan, verb: own ? 0.5 : 0.9 }); // body
    this.tone(own ? 130 : 105, 0.16 + far * 0.1, 0.55 * att, 'sine', delay, 42, pan); // thump with pitch drop
    this.burst({ gain: 1.0 * att, freq: 170, q: 0.9, dur: 0.2 + far * 0.25, type: 'lowpass', delay, pan });
    this.burst({ gain: 0.22 * att, freq: 900, q: 0.4, dur: 0.55 + far * 0.6, type: 'lowpass', delay: delay + 0.04, pan, verb: 1 }); // tail
    if (own) this.tone(3400, 0.03, 0.04, 'square', 0.035); // mechanism
  }

  /** SR-7: a deeper, longer crack that carries further. */
  private heavyShot(distance: number, pan: number, own: boolean): void {
    const att = own ? 1 : Math.min(1, 14 / Math.max(14, distance));
    const delay = own ? 0 : Math.min(0.35, distance / 343);
    this.burst({ gain: 1.0 * att, freq: 6000, q: 0.5, dur: 0.03, type: 'highpass', delay, pan });
    this.burst({ gain: 1.1 * att, freq: 1500, q: 0.6, dur: 0.12, delay, pan, verb: 1 });
    this.tone(90, 0.3, 0.75 * att, 'sine', delay, 30, pan);
    this.burst({ gain: 0.4 * att, freq: 700, q: 0.4, dur: 1.2, type: 'lowpass', delay: delay + 0.05, pan, verb: 1.2 });
    if (own) { this.tone(900, 0.05, 0.08, 'square', 0.45); this.tone(700, 0.06, 0.08, 'square', 0.62); } // bolt cycle
  }

  /** LR-1 rocket leaving the tube: a thump and a rushing hiss. */
  rocket(distance = 0, pan = 0): void {
    const att = Math.min(1, 10 / Math.max(10, distance));
    this.tone(70, 0.25, 0.8 * att, 'sine', 0, 35, pan);
    this.burst({ gain: 0.9 * att, freq: 2500, q: 0.4, dur: 0.9, pan, attack: 0.02, verb: 0.7 });
    this.burst({ gain: 0.5 * att, freq: 400, q: 0.6, dur: 0.6, type: 'lowpass', pan });
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
    this.burst({ gain: 0.18 * att, freq: 2600, q: 2, dur: 0.05, delay: 0.22 }); // mag release
    this.tone(320, 0.05, 0.15 * att, 'square', 0.25);
    this.burst({ gain: 0.25 * att, freq: 1800, q: 1.5, dur: 0.06, delay: 0.98 }); // mag seated
    this.tone(240, 0.06, 0.18 * att, 'square', 1.0);
    if (empty) { this.burst({ gain: 0.3 * att, freq: 3000, q: 1.2, dur: 0.05, delay: 1.88 }); this.tone(500, 0.05, 0.18 * att, 'square', 1.9); }
  }

  /** One footstep. distance 0 = own (quiet, centred); enemies within ~22 m are audible and panned. */
  footstep(distance: number, pan: number, sprint: boolean): void {
    if (distance > 22) return;
    const att = distance === 0 ? 0.12 : Math.min(0.5, 3 / Math.max(3, distance)) * (sprint ? 1.4 : 1);
    this.burst({ gain: att, freq: 420 + Math.random() * 160, q: 1.4, dur: 0.07, pan, attack: 0.004 });
    this.burst({ gain: att * 0.5, freq: 2600, q: 1, dur: 0.03, pan, delay: 0.01 }); // grit
  }

  /** Bullet landed on an enemy: a short thwack; headshots add a bright ring. */
  hit(head: boolean): void {
    this.burst({ gain: 0.32, freq: 900, q: 1.6, dur: 0.05 });
    this.tone(head ? 1900 : 1300, 0.05, 0.11, 'triangle');
    if (head) this.tone(2850, 0.18, 0.07, 'sine', 0.02);
  }
  /** Takedown confirmed. */
  takedown(head: boolean): void {
    this.tone(660, 0.09, 0.12, 'triangle');
    this.tone(990, 0.14, 0.1, 'triangle', 0.07);
    if (head) this.tone(1480, 0.2, 0.08, 'sine', 0.13);
  }
  levelUp(): void { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 0.1, 'triangle', i * 0.09)); }
  challenge(): void { this.tone(880, 0.12, 0.09, 'triangle'); this.tone(1320, 0.2, 0.09, 'triangle', 0.1); }
  hurt(): void { this.burst({ gain: 0.4, freq: 240, q: 1, dur: 0.15, type: 'lowpass' }); }
  beep(urgent: boolean): void { this.tone(urgent ? 1760 : 1320, 0.07, 0.08, 'sine'); }
  /** distance in metres (0 = the charge/own blast, full volume). */
  explosion(distance = 0, pan = 0): void {
    const att = Math.min(1, 14 / Math.max(14, distance));
    this.tone(90, 0.9, 0.7 * att, 'sine', 0, 28, pan);
    this.burst({ gain: 1.6 * att, freq: 120, q: 0.6, dur: 1.8, type: 'lowpass', pan, verb: 0.8 });
    this.burst({ gain: 0.8 * att, freq: 900, q: 0.5, dur: 0.6, type: 'lowpass', pan, verb: 0.6 });
    this.burst({ gain: 0.25 * att, freq: 4000, q: 0.8, dur: 0.9, delay: 0.12, pan }); // debris
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
