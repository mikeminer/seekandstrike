/** Quick-match room order: the requested room first, then lobby-1..lobby-n without duplicates. */
export function quickMatchRooms(first: string, n: number): string[] {
  const out = [first];
  for (let i = 1; i <= n; i++) { const r = `lobby-${i}`; if (!out.includes(r)) out.push(r); }
  return out;
}
