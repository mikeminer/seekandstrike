/** Minimal allocation-light 3D vector helpers for the shared simulation (no Three.js). */
export interface Vec3 { x: number; y: number; z: number }
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy = (o: Vec3, a: Vec3): Vec3 => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const distXZ = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return v3(a.x / l, a.y / l, a.z / l); };
/** Forward vector for yaw (rad, 0 = -Z) and pitch (rad, + = up). */
export const dirFromYawPitch = (yaw: number, pitch: number): Vec3 =>
  v3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
