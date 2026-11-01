import { FRIDGE_PROGRAM } from './constants';
import { SLIPPAGE_ERRORS } from './meteora';

/** Classified on-chain / simulation failure. Copy for each kind lives in ui/copy.ts. */
export type ChainFailure =
  | { kind: 'slippage' }
  | { kind: 'insufficient-sol' }
  | { kind: 'blockhash' }
  | { kind: 'fridge'; code: number }
  | { kind: 'program'; program: string; code: number | null }
  | { kind: 'other'; detail: string };

const FAIL_RE = /^Program (\w+) failed: custom program error: 0x([0-9a-f]+)$/i;

/**
 * Map a simulateTransaction / getSignatureStatuses error (+ logs, when available) to a failure
 * kind. Inner (CPI) failures are attributed through the "Program X failed" log line, so a pump
 * pool slippage error inside the swap is still recognised.
 */
export function classifyChainError(err: unknown, logs: string[] | null = null, topPrograms: string[] = []): ChainFailure {
  const s = JSON.stringify(err ?? null);
  if (/BlockhashNotFound/.test(s)) return { kind: 'blockhash' };
  if (/InsufficientFundsForRent|InsufficientFundsForFee|"InsufficientFunds"/.test(s)) return { kind: 'insufficient-sol' };
  let program: string | null = null;
  let code: number | null = null;
  for (const l of logs ?? []) {
    const m = FAIL_RE.exec(l.trim());
    if (m) { program = m[1]!; code = parseInt(m[2]!, 16); break; }
    if (/insufficient lamports/i.test(l)) return { kind: 'insufficient-sol' };
  }
  const ie = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError;
  if (ie) {
    const [idx, inner] = ie;
    const custom = (inner as { Custom?: number } | null)?.Custom;
    if (code === null && typeof custom === 'number') { code = custom; program = topPrograms[idx] ?? null; }
    if (inner === 'InsufficientFunds' || (code === 1 && program && /Token/.test(program))) return { kind: 'insufficient-sol' };
  }
  if (program && code !== null) {
    if (SLIPPAGE_ERRORS[program]?.has(code)) return { kind: 'slippage' };
    if (program === FRIDGE_PROGRAM && code >= 6000 && code <= 6014) return { kind: 'fridge', code };
    return { kind: 'program', program, code };
  }
  return { kind: 'other', detail: s.slice(0, 200) };
}
