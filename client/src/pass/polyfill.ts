// Must be the FIRST import of every Daily Pass entry module (skill rule: each lazy chain chunk
// installs its own Buffer polyfill instead of relying on another chunk's load order).
import { Buffer } from 'buffer';
const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
export {};
