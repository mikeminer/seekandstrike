/**
 * Chrome Local Network Access preflight for local-WebSocket MWA (skill seeker-wallet.md, SDK 0.7.0
 * getIsSupported.ts / loopbackPermissionModal.ts). Kept current so a click can read it synchronously.
 */
export type LoopbackState = 'exempt' | 'granted' | 'prompt' | 'denied' | 'unsupported';

let state: LoopbackState = 'unsupported';
const listeners = new Set<(s: LoopbackState) => void>();

export function isLoopbackOrigin(hostname = location.hostname): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(h) || h === '::1';
}

export async function initLoopback(): Promise<LoopbackState> {
  if (isLoopbackOrigin()) return (state = 'exempt');
  const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
  if (!perms?.query) return (state = 'unsupported');
  for (const name of ['loopback-network', 'local-network-access']) {
    try {
      const st = await perms.query({ name } as unknown as PermissionDescriptor);
      state = st.state as LoopbackState;
      st.onchange = () => { state = st.state as LoopbackState; listeners.forEach((l) => l(state)); };
      return state;
    } catch { /* name not supported by this browser */ }
  }
  return (state = 'unsupported');
}
export function loopbackState(): LoopbackState { return state; }
export function onLoopbackChange(cb: (s: LoopbackState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
/** On 'prompt': raise Chrome's question while visible. Do NOT open the wallet in this click. */
export function requestLoopback(): void {
  void fetch('http://localhost').catch(() => {});
}
