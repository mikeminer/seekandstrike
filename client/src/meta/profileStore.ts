/**
 * Device storage of the player profile. Every access is guarded: private windows, cleared or blocked storage
 * simply start from a fresh profile and the game still works.
 */
import { type Profile, dayKey, newProfile, parseProfile } from './progression';

const KEY = 'seekstrike.profile.v1';

export function loadProfile(now = new Date()): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    return parseProfile(raw ? JSON.parse(raw) : null, now);
  } catch {
    return newProfile(now);
  }
}

export function saveProfile(p: Profile): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable: progress lasts for this session */ }
}

/**
 * One free offline match per (UTC) day without a Daily Pass (owner decision 2026-11-02). The pass stays
 * required for unlimited play and for online. This is a courtesy trial kept on the device, not a security
 * boundary.
 */
export const freeMatchAvailable = (p: Profile, now = new Date()): boolean => p.freeDay !== dayKey(now);
export function useFreeMatch(p: Profile, now = new Date()): void { p.freeDay = dayKey(now); saveProfile(p); }
