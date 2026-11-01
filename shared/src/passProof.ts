import { PENDING_DEFAULTS } from './config';

/**
 * Wallet proof for online access. The server sends a challenge text; the player's wallet signs it (a plain-text
 * message, never a transaction); the server checks the Ed25519 signature and then reads the Daily Pass from chain.
 *
 * The text is fixed and human readable so that (a) a wallet shows the player what is being signed and (b) the client
 * can refuse to sign anything that does not match the template (a hostile server must not be able to obtain a
 * signature over bytes that could be read as a transaction).
 */
export const PROOF_TTL_MS = 60_000;
/** Longest challenge text we ever produce or accept. */
export const MAX_CHALLENGE_CHARS = 400;

export const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Standard base64 of exactly 64 bytes. */
export const SIG_B64_RE = /^[A-Za-z0-9+/]{86}==$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const ROOM_RE = /^[0-9a-zA-Z-]{1,64}$/;

export interface Challenge {
  wallet: string;
  room: string;
  /** 128-bit random value, hex. Single use: it only exists on the socket that received it. */
  nonce: string;
  /** Issue and expiry times, unix milliseconds (server clock). */
  iat: number;
  exp: number;
}

const HEAD = 'SEEK & STRIKE online access';
const NOTE = 'Sign to prove you own this wallet. This is not a transaction and costs nothing.';

export function challengeMessage(c: Challenge): string {
  return [
    HEAD, NOTE,
    `Domain: ${PENDING_DEFAULTS.domain}`,
    `Wallet: ${c.wallet}`,
    `Room: ${c.room}`,
    `Nonce: ${c.nonce}`,
    `Issued: ${c.iat}`,
    `Expires: ${c.exp}`,
  ].join('\n');
}

/** Strict inverse of {@link challengeMessage}: anything that does not round-trip exactly is rejected. */
export function parseChallengeMessage(text: string): Challenge | null {
  if (typeof text !== 'string' || text.length > MAX_CHALLENGE_CHARS) return null;
  const lines = text.split('\n');
  if (lines.length !== 8 || lines[0] !== HEAD || lines[1] !== NOTE) return null;
  const field = (i: number, key: string): string | null => (lines[i]!.startsWith(`${key}: `) ? lines[i]!.slice(key.length + 2) : null);
  const domain = field(2, 'Domain'), wallet = field(3, 'Wallet'), room = field(4, 'Room'), nonce = field(5, 'Nonce');
  const iat = field(6, 'Issued'), exp = field(7, 'Expires');
  if (domain !== PENDING_DEFAULTS.domain || wallet === null || room === null || nonce === null || iat === null || exp === null) return null;
  if (!WALLET_RE.test(wallet) || !ROOM_RE.test(room) || !NONCE_RE.test(nonce) || !/^\d{10,16}$/.test(iat) || !/^\d{10,16}$/.test(exp)) return null;
  const c: Challenge = { wallet, room, nonce, iat: Number(iat), exp: Number(exp) };
  return challengeMessage(c) === text ? c : null;
}
