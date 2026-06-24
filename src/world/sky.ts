import * as THREE from "three";
import {
  positionLocal, normalize, mix, pow, clamp, max, dot, smoothstep, vec3, float,
} from "../nodes/tsl";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { env } from "../core/env";
import { skyColorNode } from "../nodes/sky";
import { cloudLayerMaterial } from "../nodes/clouds";

/**
 * Sky dome + the scene light rig + fog + drifting clouds. ALL of it is driven
 * by `env`, the single lighting source of truth — so the sun light, the sky
 * gradient, the fog colour and the ambient fills always agree, and a day-night
 * cycle is just `env.setSun(elevation)`.
 */
export function buildSky(scene: THREE.Scene, camera: THREE.Camera): {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  resetClouds: () => void;
  update: (dt: number) => void;
} {
  // ---- Gradient sky dome (TSL, no textures) ----
  const skyGeo = new THREE.SphereGeometry(900, 32, 16);
  const skyMat = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });

  skyMat.colorNode = skyColorNode(positionLocal); // shared with the water reflection

  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // ---- Light rig (colours/intensities come from env every frame) ----
  const sun = new THREE.DirectionalLight(env.sunColor.getHex(), env.sunIntensity);
  sun.castShadow = true;
  // Single high-res player-following shadow map. CSM (CSMShadowNode) was fully
  // solved here (the crash was self-inflicted: setting csm.camera skips _init;
  // leaving it null lets setup() build the cascades from the node builder). But
  // MEASURED it more than HALVES fps in this ~2000-draw scene (60 -> 28/37) — the
  // shadow pass re-renders every caster per cascade. Not worth it on this target;
  // the single map gives the same look at 60fps. To revisit: CSM + shadow-caster
  // culling, or fewer cascades + smaller maps.
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 600;
  const s = 160;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);
  env.sunLight = sun;

  // CSM is a working opt-in (`?csm`). Default off: it re-renders every caster per
  // cascade and >halves fps in this ~2-3k-draw scene (the single player-following
  // map above looks equivalent at 60fps). FIX vs the earlier crash: never set
  // csm.camera — setup() builds the cascades from the node-builder's camera only
  // when camera===null.
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("csm")) {
    const csm = new CSMShadowNode(sun, { cascades: 3, maxFar: 300, mode: "practical", lightMargin: 120 });
    (sun.shadow as any).shadowNode = csm;
  }

  const hemi = new THREE.HemisphereLight(env.hemiSky.getHex(), env.hemiGround.getHex(), env.hemiIntensity);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(env.ambient.getHex(), env.ambientIntensity);
  scene.add(ambient);

  // ---- Fog (for the PBR/standard materials; self-lit ones fog via nodes/fog) ----
  scene.fog = new THREE.Fog(env.fogColor.clone(), env.fogNear, env.fogFar);
  scene.background = env.skyBot.clone();

  // ---- Stylized GPU cloud layer (dome-FBM; replaces the old icosphere puffs) ----
  // A back-side dome just inside the sky dome, shaded by animated fractal noise in
  // the fragment shader (coverage + sun-lit gradient + Beer's-law alpha + silver
  // lining). Drifts from env.u.time on the GPU — no per-frame CPU work. Recentred
  // on the camera each frame so the deck reads as infinitely distant.
  const cloudDome = new THREE.Mesh(new THREE.SphereGeometry(860, 48, 28), cloudLayerMaterial());
  cloudDome.frustumCulled = false;
  cloudDome.renderOrder = 2;            // composite over the opaque sky dome
  scene.add(cloudDome);
  const resetClouds = () => {};         // GPU-animated; nothing to reset

  const fog = scene.fog as THREE.Fog;

  return {
    sun, hemi, ambient, resetClouds,
    update: (dt: number) => {
      // sync the real lights + fog to env (env owns the palette)
      sun.color.copy(env.sunColor);
      sun.intensity = env.sunIntensity;
      hemi.color.copy(env.hemiSky);
      hemi.groundColor.copy(env.hemiGround);
      hemi.intensity = env.hemiIntensity;
      ambient.color.copy(env.ambient);
      ambient.intensity = env.ambientIntensity;
      fog.color.copy(env.fogColor);
      fog.near = env.fogNear;
      fog.far = env.fogFar;
      (scene.background as THREE.Color).copy(env.skyBot);

      // keep the sky + cloud domes centred on the viewer so they read as infinitely
      // distant (the cloud noise is direction-based, so only the centre matters)
      camera.getWorldPosition(cloudDome.position);
      sky.position.copy(cloudDome.position);
      void dt;
    },
  };
}
