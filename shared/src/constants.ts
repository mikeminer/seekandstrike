/**
 * Engine-level constants (no gameplay tuning lives here yet).
 * Gameplay defaults are proposed in docs/brief.md and will be added once confirmed.
 */
export const CLIENT_SIM_HZ = 60;
/** Authoritative server tick (reference engine default server frame rate is 20 Hz). */
export const SERVER_TICK_HZ = 20;
/** Client -> server input batches per second (each batch carries several sim ticks). */
export const CLIENT_INPUT_SEND_HZ = 10;
/** Server -> client snapshot rate (outgoing WebSocket messages are not billed on DO). */
export const SERVER_SNAPSHOT_HZ = 15;
export const MAX_PLAYERS_PER_ROOM = 8;
/** Hard cap on match length so a room cannot burn the daily free DO duration. */
export const MAX_MATCH_SECONDS = 15 * 60;
/** Reconnect grace before a disconnected seat is released. */
export const RECONNECT_GRACE_MS = 20_000;
/** Release performance gate on a physical Seeker. */
export const RELEASE_MIN_FPS = 50;
export const MAX_DEVICE_PIXEL_RATIO = 1.5;
