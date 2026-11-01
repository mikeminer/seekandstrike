/**
 * Fixed-timestep accumulator with bounded catch-up.
 * Shared by the client (prediction/local bots) and the server (authoritative sim).
 * Contains no gameplay: it only decides how many fixed steps to run.
 */
export interface FixedStepOptions {
  /** Simulation step in seconds (e.g. 1/60 on client, 1/20 on server). */
  readonly stepSeconds: number;
  /** Maximum steps per frame before dropping time (prevents the spiral of death). */
  readonly maxStepsPerFrame: number;
  /** Clamp for a single frame delta (tab switch, GC pause, app resume). */
  readonly maxFrameSeconds: number;
}

export interface FixedStepResult {
  /** Number of fixed steps to execute this frame. */
  readonly steps: number;
  /** Interpolation factor in [0, 1) between previous and current sim state. */
  readonly alpha: number;
  /** Seconds discarded because the catch-up bound was reached. */
  readonly droppedSeconds: number;
}

export class FixedStepper {
  private accumulator = 0;
  private totalSteps = 0;

  constructor(private readonly opts: FixedStepOptions) {
    if (!(opts.stepSeconds > 0)) throw new RangeError('stepSeconds must be > 0');
    if (!(opts.maxStepsPerFrame >= 1)) throw new RangeError('maxStepsPerFrame must be >= 1');
  }

  get stepSeconds(): number {
    return this.opts.stepSeconds;
  }

  get tick(): number {
    return this.totalSteps;
  }

  /** Advance by a real frame delta (seconds). Non-finite or negative deltas count as 0. */
  advance(frameSeconds: number): FixedStepResult {
    const dt = Number.isFinite(frameSeconds) && frameSeconds > 0
      ? Math.min(frameSeconds, this.opts.maxFrameSeconds)
      : 0;
    this.accumulator += dt;
    let steps = Math.floor(this.accumulator / this.opts.stepSeconds);
    let droppedSeconds = 0;
    if (steps > this.opts.maxStepsPerFrame) {
      droppedSeconds = (steps - this.opts.maxStepsPerFrame) * this.opts.stepSeconds;
      steps = this.opts.maxStepsPerFrame;
    }
    this.accumulator -= steps * this.opts.stepSeconds + droppedSeconds;
    this.totalSteps += steps;
    const alpha = Math.min(Math.max(this.accumulator / this.opts.stepSeconds, 0), 0.999999);
    return { steps, alpha, droppedSeconds };
  }

  /** Call when the app is paused/resumed so no stale time is replayed. */
  reset(): void {
    this.accumulator = 0;
  }
}
