import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/**
 * Loads bundled CC0 assets (see ASSETS_LICENSES.md). Everything is served from the app's own
 * origin (public/assets → dist/assets); there are no runtime hotlinks.
 * Colour maps are sRGB; normal/roughness/metalness/AO stay linear (NoColorSpace).
 */
export type TextureSetId = 'Asphalt031' | 'Concrete034' | 'CorrugatedSteel005' | 'PaintedMetal009' | 'Planks037B' | 'MetalPlates006';

const SETS: Record<TextureSetId, readonly ('color' | 'normal' | 'roughness' | 'metalness' | 'ao')[]> = {
  Asphalt031: ['color', 'normal', 'roughness', 'ao'],
  Concrete034: ['color', 'normal', 'roughness'],
  CorrugatedSteel005: ['color', 'normal', 'roughness', 'metalness', 'ao'],
  PaintedMetal009: ['color', 'normal', 'roughness', 'metalness', 'ao'],
  Planks037B: ['color', 'normal', 'roughness', 'ao'],
  MetalPlates006: ['color', 'normal', 'roughness', 'metalness'],
};

export interface TextureSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  metalnessMap?: THREE.Texture;
  aoMap?: THREE.Texture;
}

export class AssetStore {
  private loader = new THREE.TextureLoader();
  private sets = new Map<TextureSetId, TextureSet>();
  private owned: { dispose(): void }[] = [];
  constructor(private base: string, private anisotropy: number) {}

  private async tex(url: string, srgb: boolean): Promise<THREE.Texture> {
    const t = await this.loader.loadAsync(url);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.anisotropy;
    this.owned.push(t);
    return t;
  }

  async loadSets(onProgress?: (done: number, total: number) => void): Promise<void> {
    const ids = Object.keys(SETS) as TextureSetId[];
    const total = ids.reduce((n, id) => n + SETS[id].length, 0);
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      const entries = await Promise.all(SETS[id].map(async (k) => {
        const t = await this.tex(`${this.base}assets/textures/${id}/${k}.webp`, k === 'color');
        onProgress?.(++done, total);
        return [k, t] as const;
      }));
      const m = Object.fromEntries(entries) as Record<string, THREE.Texture>;
      this.sets.set(id, { map: m.color!, normalMap: m.normal!, roughnessMap: m.roughness!, metalnessMap: m.metalness, aoMap: m.ao });
    }));
  }

  set(id: TextureSetId): TextureSet {
    const s = this.sets.get(id);
    if (!s) throw new Error(`Texture set ${id} not loaded`);
    return s;
  }

  /** Equirect HDRI → PMREM env map (and a downsampled background). */
  async loadEnvironment(renderer: THREE.WebGLRenderer): Promise<{ env: THREE.Texture; background: THREE.Texture }> {
    const hdr = await new HDRLoader().loadAsync(`${this.base}assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr`);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    pmrem.dispose();
    this.owned.push(env, hdr);
    return { env, background: hdr };
  }

  track<T extends { dispose(): void }>(o: T): T { this.owned.push(o); return o; }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.sets.clear();
  }
}
