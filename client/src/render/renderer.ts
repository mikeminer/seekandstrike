import * as THREE from 'three';
import { MAX_DEVICE_PIXEL_RATIO } from '@shared/constants';

/** Creates the WebGL renderer with the colour pipeline and caps used across the game. */
export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO));
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  return renderer;
}

export function setRendererPixelRatio(renderer: THREE.WebGLRenderer, cap: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, cap, MAX_DEVICE_PIXEL_RATIO);
  if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
}
