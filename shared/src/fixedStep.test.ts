import { describe, expect, it } from 'vitest';
import { FixedStepper } from './fixedStep';
import { parseClientMessage } from './protocol';

describe('FixedStepper', () => {
  const make = () => new FixedStepper({ stepSeconds: 1 / 60, maxStepsPerFrame: 5, maxFrameSeconds: 0.25 });

  it('runs one step per 60 Hz frame', () => {
    const s = make();
    expect(s.advance(1 / 60).steps).toBe(1);
  });

  it('bounds catch-up and reports dropped time', () => {
    const s = make();
    const r = s.advance(0.25);
    expect(r.steps).toBe(5);
    expect(r.droppedSeconds).toBeGreaterThan(0);
  });

  it('ignores invalid deltas', () => {
    const s = make();
    expect(s.advance(Number.NaN).steps).toBe(0);
    expect(s.advance(-1).steps).toBe(0);
  });

  it('keeps alpha in [0,1)', () => {
    const s = make();
    const r = s.advance(0.025);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThan(1);
  });
});

describe('parseClientMessage', () => {
  it('accepts hello/ping and rejects junk', () => {
    expect(parseClientMessage('{"t":"hello","v":0}')).toEqual({ t: 'hello', v: 0 });
    expect(parseClientMessage('{"t":"ping","id":3}')).toEqual({ t: 'ping', id: 3 });
    expect(parseClientMessage('{"t":"fire"}')).toBeNull();
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('x'.repeat(5000))).toBeNull();
  });
});
