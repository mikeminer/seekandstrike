import { formatUnits } from '../bytes';
import { PASS_DECIMALS } from '../constants';
import { locale } from '../../ui/i18n';
import { INTL_TAG } from '../../i18n/lang';
import { pt } from './copy';

const loc = (): string => INTL_TAG[locale()];
const dec = (): string => new Intl.NumberFormat(loc()).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';

function group(whole: string): string {
  return new Intl.NumberFormat(loc()).format(BigInt(whole));
}
function units(raw: bigint, decimals: number): string {
  const s = formatUnits(raw, decimals);
  const [w, f] = s.split('.');
  return f ? `${group(w!)}${dec()}${f}` : group(w!);
}
/** Exact SOL amount (no rounding, trailing zeros trimmed). */
export const sol = (lamports: bigint): string => units(lamports, 9);
/** Exact pass-token amount from raw units (6 decimals). */
export const passUnits = (raw: bigint): string => units(raw, PASS_DECIMALS);
export const pct = (bps: number): string =>
  new Intl.NumberFormat(loc(), { minimumFractionDigits: bps % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(bps / 100);

export function localTime(unixS: number): string {
  return new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(unixS * 1000));
}
export function utcTime(unixS: number): string {
  return new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(unixS * 1000));
}
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? pt('dur', { h, m }) : pt('durS', { m, s: s % 60 });
}
export const shortAddr = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;
