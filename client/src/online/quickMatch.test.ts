import { describe, expect, it } from 'vitest';
import { quickMatchRooms } from './quickMatch';

describe('quick match', () => {
  it('tries the requested room first, then the lobbies once each', () => {
    expect(quickMatchRooms('lobby-1', 3)).toEqual(['lobby-1', 'lobby-2', 'lobby-3']);
    expect(quickMatchRooms('friends-room', 2)).toEqual(['friends-room', 'lobby-1', 'lobby-2']);
  });
});
