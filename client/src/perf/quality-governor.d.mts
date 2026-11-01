// Type declarations for the vendored DevFridge quality governor (pure JS module).
export interface QualityTier {
  readonly detailedCharacters: number;
  readonly crowd: number;
  readonly shadowMap: number;
  readonly dpr: number;
}
export interface GovernorState {
  readonly tierCount: number;
  readonly tier: number;
}
export interface QualityEvent {
  readonly from: number;
  readonly to: number;
  readonly direction: 'down' | 'up';
  readonly fps: number;
  readonly reason: 'failed-step-up' | 'slow-window' | 'two-good-windows';
}
export const DEFAULT_QUALITY_TIERS: readonly QualityTier[];
export function createQualityGovernor(opts?: { tierCount?: number; initialTier?: number; nowMs?: number }): GovernorState;
export function observeFrame(
  state: GovernorState,
  frameMs: number,
  nowMs: number,
): { state: GovernorState; event: QualityEvent | null; sample: { fps: number; skipped?: boolean } | null };
export function formatQualityChange(gameName: string, event: QualityEvent | null): string | null;
