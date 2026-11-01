/**
 * Analytic sea surface for the Seeker (DevFridge Game Builder v1.10.0: threejs-water-optics,
 * "analytic surface build order"):
 *  1. wave bands defined once (direction, wavelength, slope, speed);
 *  2. the normal is derived analytically from those same bands;
 *  3. NORMAL-ONLY water, declared: the mesh is flat, nothing is displaced (cheap, no cracks at quays);
 *  4/5. no screen-space refraction; absorption uses a FALLBACK constant deep colour, not scene depth;
 *  6. reflection (shared sky model + sun glint) and refraction blended by Schlick Fresnel;
 *  7. no foam (no crest metric is simulated, so none is faked with a scrolling texture);
 *  8. each band fades out when it gets smaller than a pixel (derivative filter) to avoid sparkle.
 */
import * as THREE from 'three';
import { SKY_GLSL, skyUniforms, type SkyModel } from './sky';

/** [dirX, dirZ, wavelength m, slope (amplitude·k), angular speed] — calm harbour water. */
export const SEA_BANDS: readonly (readonly [number, number, number, number, number])[] = [
  [0.82, 0.57, 11.0, 0.05, 0.9],
  [-0.35, 0.94, 5.3, 0.045, 1.4],
  [0.96, -0.28, 2.1, 0.035, 2.3],
  [-0.71, -0.7, 0.85, 0.025, 3.6],
];

export function createSeaMaterial(m: SkyModel): THREE.ShaderMaterial {
  const bands = SEA_BANDS.map(([dx, dz, L, s, w]) => {
    const n = Math.hypot(dx, dz);
    return new THREE.Vector4(dx / n, dz / n, (2 * Math.PI) / L, s).toArray().concat([w]);
  });
  return new THREE.ShaderMaterial({
    name: 'sea',
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x0e3a44) },
      uBands: { value: bands.map((b) => new THREE.Vector4(b[0], b[1], b[2], b[3])) },
      uSpeeds: { value: bands.map((b) => b[4]) },
    }, skyUniforms(m)]),
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec4 uBands[4];
      uniform float uSpeeds[4];
      varying vec3 vWorld;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 p = vWorld.xz;
        float footprint = length(fwidth(p)); // metres per pixel
        vec2 grad = vec2(0.0);
        for (int i = 0; i < 4; i++) {
          vec4 b = uBands[i];
          float wavelength = 6.2831853 / b.z;
          // Derivative filter: drop bands shorter than ~3 pixels instead of letting them alias.
          float keep = 1.0 - smoothstep(wavelength / 6.0, wavelength / 3.0, footprint);
          float phase = dot(b.xy, p) * b.z - uSpeeds[i] * uTime;
          grad += b.xy * (b.w * cos(phase) * keep);
        }
        vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y); // air-side only: reflections never look below the horizon
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 reflection = skyRadiance(R) + uSunColor * 7.0 * pow(max(dot(R, uSunDir), 0.0), 900.0);
        // Absorption fallback: a constant deep-water colour lit by the sky above (not reconstructed depth).
        vec3 refraction = uDeep * (0.35 + 0.65 * skyGradient(1.0));
        gl_FragColor = vec4(mix(refraction, reflection, F), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** One large disc of sea at the water level (covers the harbour and the horizon). */
export function createSea(m: SkyModel, waterLevel: number, radius: number): { mesh: THREE.Mesh; update: (t: number) => void } {
  const mat = createSeaMaterial(m);
  const geo = new THREE.CircleGeometry(radius, 64);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = waterLevel;
  mesh.name = 'sea';
  mesh.receiveShadow = false;
  return { mesh, update: (t: number) => { mat.uniforms.uTime!.value = t; } };
}
