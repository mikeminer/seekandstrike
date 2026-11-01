import { Capacitor, registerPlugin } from '@capacitor/core';
import { bytesToB64 } from './bytes';
import type { PurchaseIntent, TxKind } from './txbuilder';
import type { ValidationResult } from './validator';

interface PassValidatorPlugin {
  validate(req: Record<string, string | boolean>): Promise<{ ok: boolean; reason: string }>;
}

/**
 * Second validation layer inside the Android host: the same checks as validator.ts, re-run by native
 * code that does not trust this JavaScript. In a browser there is no native layer and this returns ok
 * (the browser build has no APK threat model). In the APK it fails closed: a missing or failing plugin
 * blocks the wallet request.
 */
export async function nativeValidate(raw: Uint8Array, kind: TxKind, intent: PurchaseIntent, nowS: number): Promise<ValidationResult> {
  if (!Capacitor.isNativePlatform()) return { ok: true };
  try {
    const plugin = registerPlugin<PassValidatorPlugin>('PassValidator');
    const r = await plugin.validate({
      tx: bytesToB64(raw), kind, wallet: intent.wallet, blockhash: intent.blockhash,
      amountIn: intent.amountIn.toString(), minOut: intent.minOut.toString(), target: intent.target.toString(),
      lockId: intent.lockId.toString(), unlockAt: intent.unlockAt.toString(), cuPrice: String(intent.cuPrice),
      includeBuybackCreate: false, wsolExists: intent.wsolExists ?? false, nowS: String(nowS),
    });
    return r.ok ? { ok: true } : { ok: false, reason: `native: ${r.reason}` };
  } catch {
    return { ok: false, reason: 'native validator unavailable' };
  }
}
