import { DAMM_POOL, FRIDGE_PROGRAM, PASS_MINT } from '../constants';
import { locale } from '../../ui/i18n';

/**
 * Details panel copy (check-player-copy --scope details): the only place that names the program,
 * the full mint, the pool and the 2% fee sentence. Shown only on the player's explicit tap.
 */
const IT = {
  program: 'Programma',
  mint: 'Mint PASTA (il token del pass)',
  route: 'Acquisto: 0,01 SOL → PASTA nella pool Meteora DAMM v2, nella stessa transazione che avvia il blocco',
  fee: 'Quando il tuo pass termina e il tuo PASTA esce dal programma, si applica la commissione del 2% prevista dal programma.',
  hold: 'Il pass trattiene il PASTA acquistato nel programma per 1 giorno; a fine pass torna nel tuo wallet insieme ai depositi di rete.',
  network: 'Rete: Solana mainnet-beta',
  passMint: 'Pool dello scambio',
};
type Key = keyof typeof IT;
const EN: Record<Key, string> = {
  program: 'Program',
  mint: 'PASTA mint (the pass token)',
  route: 'Purchase: 0.01 SOL → PASTA in the Meteora DAMM v2 pool, in the same transaction that starts the lock',
  fee: 'When your pass ends and your PASTA leaves the program, the 2% fee defined by the program applies.',
  hold: 'The pass holds the PASTA you bought in the program for 1 day; when the pass ends it goes back to your wallet together with the network deposits.',
  network: 'Network: Solana mainnet-beta',
  passMint: 'Swap pool',
};
export const DETAILS_COPY = { it: IT, en: EN };
export const dt = (k: Key): string => (locale() === 'it' ? IT : EN)[k];
export const DETAILS_ADDRESSES = { program: FRIDGE_PROGRAM, mint: PASS_MINT, pasta: DAMM_POOL };
