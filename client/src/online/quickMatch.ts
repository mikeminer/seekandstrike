/**
 * Quick-match room order. Rooms are named after their map (`<map-id>-<n>`, the server picks the map from the
 * name): an explicit room first when given, then <map>-1..<map>-n without duplicates.
 */
export function quickMatchRooms(mapId: string, n: number, first?: string): string[] {
  const out = first ? [first] : [];
  for (let i = 1; i <= n; i++) { const r = `${mapId}-${i}`; if (!out.includes(r)) out.push(r); }
  return out;
}
