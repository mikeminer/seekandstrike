/**
 * Critically/under-damped spring with an implicit (unconditionally stable) step.
 *
 * Adapted from `Spring` in Claude-of-Duty src/weapons/mathx.js
 * (https://github.com/mshumer/Claude-of-Duty, commit d9b237b75c9304ab8d9ef4cfa0c3568c7c11a853),
 * Copyright (c) 2026 mshumer, MIT License — full text in licenses/Claude-of-Duty-MIT.txt.
 * Rewritten in TypeScript; behaviour: `f` = natural frequency (Hz), `z` = damping ratio.
 */
export class Spring {
  x: number;
  v = 0;
  target: number;
  constructor(public f = 12, public z = 1, value = 0) {
    this.x = value;
    this.target = value;
  }

  set(value: number): this {
    this.x = value; this.v = 0; this.target = value;
    return this;
  }

  /** Instantaneous velocity impulse (per-shot recoil). */
  kick(dv: number): this {
    this.v += dv;
    return this;
  }

  step(dt: number, target = this.target): number {
    this.target = target;
    const w = 2 * Math.PI * this.f;
    const denom = 1 + 2 * this.z * w * dt + w * w * dt * dt;
    this.v = (this.v + w * w * dt * (target - this.x)) / denom;
    this.x += this.v * dt;
    return this.x;
  }
}
