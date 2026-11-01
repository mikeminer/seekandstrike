import { PublicKey } from '@solana/web3.js';
import { PASS_MINT, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT, PASS_SECONDS, DAMM_POOL } from '../constants';
import type { DammRoute } from '../meteora';
import type { PurchaseIntent } from '../txbuilder';

export const WALLET = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
export const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
export const NOW = 1_793_000_000;

/** The real pool (vault addresses read from mainnet 2026-10-29). */
export function route(): DammRoute {
  return {
    pool: new PublicKey(DAMM_POOL), tokenAMint: new PublicKey(PASS_MINT), tokenBMint: new PublicKey(WSOL_MINT),
    tokenAVault: new PublicKey('Hmokxd8TwUYGPNWgZ2BrFd9R9P1784CpziDF7R4hn7FF'), tokenBVault: new PublicKey('BpQF5AHNPiWZAtuaiH1TPFzSBDkAtQTiL4EWqhxmzGaD'),
    tokenAProgram: TOKEN_2022_PROGRAM, tokenBProgram: TOKEN_PROGRAM,
  };
}

export function intent(over: Partial<PurchaseIntent> = {}): PurchaseIntent {
  return {
    wallet: WALLET, route: route(),
    amountIn: 10_000_000n, minOut: 205_000_000_000n, target: 209_000_000_000n,
    lockId: 3n, unlockAt: BigInt(NOW + PASS_SECONDS), cuPrice: 0, blockhash: BLOCKHASH,
    ...over,
  };
}
