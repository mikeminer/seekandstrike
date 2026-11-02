import { describe, expect, it } from 'vitest';
import { quickMatchRooms } from './quickMatch';

describe('quick match', () => {
  it('tries the rooms of the chosen map in order', () => {
    expect(quickMatchRooms('magazzini-sale', 3)).toEqual(['magazzini-sale-1', 'magazzini-sale-2', 'magazzini-sale-3']);
  });
  it('an explicit room goes first, once', () => {
    expect(quickMatchRooms('banchina-est', 2, 'friends-room')).toEqual(['friends-room', 'banchina-est-1', 'banchina-est-2']);
    expect(quickMatchRooms('banchina-est', 2, 'banchina-est-1')).toEqual(['banchina-est-1', 'banchina-est-2']);
  });
});
