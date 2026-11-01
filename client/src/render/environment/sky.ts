/**
 * One sky model shared by the sky dome, sea reflections, haze and image-based light
 * (DevFridge Game Builder v1.10.0: threejs-atmosphere-aerial-perspective, "small scene, no orbital
 * camera → analytic height/distance approximation"; sky and haze share sun direction and colours;
 * threejs-landscape: six gradient stops, horizon stop slightly below the geometric horizon so fog
 * and sky meet without a line).
 */
import * as THREE from 'three';

export interface SkyModel {
  /** Unit vector towards the sun. */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  /** Six stops from below the horizon to the zenith, at SKY_STOPS elevations (sin of angle). */
  stops: [THREE.Color, THREE.Color, THREE.Color, THREE.Color, THREE.Color, THREE.Color];
  /** Exponential-squared haze density per metre (THREE.FogExp2); its colour is the horizon stop. */
  hazeDensity: number;
}

/** sin(elevation) of each gradient stop; stop 1 sits just below the geometric horizon. */
export const SKY_STOPS = [-0.2, -0.015, 0.05, 0.16, 0.38, 1.0] as const;

/** Compass azimuth (0 = north, clockwise) and elevation in degrees → unit vector (x east, z south). */
export function sunDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg), el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

/** Late afternoon over the Gulf of Trieste: warm haze at the horizon, clear blue overhead. */
export function lateAfternoonSky(sunDir: THREE.Vector3): SkyModel {
  return {
    sunDir: sunDir.clone().normalize(),
    sunColor: new THREE.Color(0xffd7a8),
    stops: [
      new THREE.Color(0xb9b6ad), new THREE.Color(0xd9cfc0), new THREE.Color(0xc9d3d9),
      new THREE.Color(0xaec2d3), new THREE.Color(0x8aa8c6), new THREE.Color(0x6a8db8),
    ],
    hazeDensity: 0.0022,
  };
}

/** The horizon colour is also the haze colour, so distant geometry fades into the sky exactly. */
export const hazeColor = (m: SkyModel): THREE.Color => m.stops[1].clone();

/** Uniforms + GLSL `skyRadiance(dir)` used by every shader that sees the sky. */
export function skyUniforms(m: SkyModel): Record<string, THREE.IUniform> {
  return {
    uSunDir: { value: m.sunDir },
    uSunColor: { value: m.sunColor },
    uSkyStops: { value: m.stops },
    uSkyStopY: { value: [...SKY_STOPS] },
  };
}

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyStops[6];
uniform float uSkyStopY[6];
vec3 skyGradient(float y) {
  vec3 c = uSkyStops[0];
  for (int i = 1; i < 6; i++) c = mix(c, uSkyStops[i], smoothstep(uSkyStopY[i - 1], uSkyStopY[i], y));
  return c;
}
// Sky radiance along a direction: gradient + forward-scattering glow around the sun (no disc).
vec3 skyRadiance(vec3 dir) {
  float mu = max(dot(normalize(dir), uSunDir), 0.0);
  float horizon = 1.0 - smoothstep(0.0, 0.35, abs(dir.y));
  vec3 glow = uSunColor * (0.22 * pow(mu, 8.0) + 0.5 * pow(mu, 64.0)) * (0.5 + 0.5 * horizon);
  return skyGradient(dir.y) + glow;
}
`;

/** Back-side sphere that follows the camera; drawn first, never fogged, never writes depth. */
export function createSkyDome(m: SkyModel, radius: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    name: 'sky-dome',
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: skyUniforms(m),
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        vec3 c = skyRadiance(vDir);
        float disc = smoothstep(0.99985, 0.99995, dot(normalize(vDir), uSunDir));
        c += uSunColor * disc * 6.0;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  dome.name = 'sky-dome';
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}

/** Image-based light from the same sky (no sun disc: the directional light carries the sun). */
export function environmentFromSky(renderer: THREE.WebGLRenderer, m: SkyModel): THREE.Texture {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyUniforms(m),
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${SKY_GLSL}\nvarying vec3 vDir; void main(){ gl_FragColor = vec4(skyRadiance(vDir), 1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 0.1, 100);
  pmrem.dispose();
  mat.dispose();
  return target.texture;
}
