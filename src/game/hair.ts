/**
 * Procedural stylized hair — a real hairstyle silhouette instead of a flat sphere
 * cap. Built as a merged mesh (skull cap + forehead fringe/bangs + side locks +
 * back volume) and shaded with `hairToon` (cel bands + the anime silky-sheen
 * highlight). The biggest single upgrade is the FRINGE: downward bang tufts over
 * the forehead read instantly as "hair", not "helmet".
 *
 * Built around the head-sphere CENTRE at local origin; the caller positions the
 * returned mesh at the head centre.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hairToon } from "./charToon";

export type HairStyle = "tousled" | "short" | "long" | "ponytail";

export interface HairOpts {
  color: THREE.ColorRepresentation;
  headR: number;          // head-sphere radius this hair sits on
  fringe?: number;        // number of forehead bang tufts (default 5)
  style?: HairStyle;      // silhouette variant (default "tousled")
  sheenColor?: THREE.ColorRepresentation;
}

/** A stylized hair mesh, centred on the head sphere's centre (local origin). */
export function buildHair(opts: HairOpts): THREE.Mesh {
  const r = opts.headR;
  const style = opts.style ?? "tousled";
  const geos: THREE.BufferGeometry[] = [];

  // skull cap — the crown, LIFTED so its skirt sits above the eye line (the small
  // round head means a head-hugging cap bulges over the eyes; lifting clears the
  // forehead, which is how hair actually sits).
  const cap = new THREE.SphereGeometry(r * 1.02, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cap.scale(1.05, 1.05, 1.05);
  cap.translate(0, r * 0.17, 0);
  geos.push(cap);

  // top tufts — count/length vary by style (short = few + flat; tousled = spiky)
  const n = style === "short" ? 3 : (opts.fringe ?? 5);
  const tuftLen = style === "short" ? r * 0.26 : r * 0.44;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1) - 0.5;
    const tuft = new THREE.ConeGeometry(r * 0.16, tuftLen, 6);
    tuft.rotateX(-0.4 - (i % 2) * 0.14);          // lean back, slight alternation
    tuft.rotateZ(f * 0.55);
    tuft.translate(f * r * 0.72, r * (style === "short" ? 1.05 : 1.12), -r * 0.06);
    geos.push(tuft);
  }

  // swept forelock off the front hairline (sits above the brows, pointing up-forward)
  const fore = new THREE.ConeGeometry(r * 0.22, r * 0.4, 6);
  fore.rotateX(-1.05);
  fore.translate(0, r * 0.78, r * 0.46);
  geos.push(fore);

  // back volume — fuller hair down the nape (behind/below; never touches the face)
  const back = new THREE.SphereGeometry(r * 0.74, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.66);
  back.scale(1.02, 1.05, 0.82);
  back.translate(0, r * 0.08, -r * 0.5);
  geos.push(back);

  if (style === "long") {
    // long hair: a flowing slab down the back + side strands past the shoulders
    const fall = new THREE.BoxGeometry(r * 1.5, r * 2.2, r * 0.35);
    fall.translate(0, -r * 0.85, -r * 0.62);
    geos.push(fall);
    for (const sx of [-1, 1]) {
      const strand = new THREE.BoxGeometry(r * 0.34, r * 1.6, r * 0.3);
      strand.translate(sx * r * 0.78, -r * 0.5, -r * 0.1);
      geos.push(strand);
    }
  } else if (style === "ponytail") {
    // ponytail: a tied tail sweeping down-and-back from the crown
    const tie = new THREE.SphereGeometry(r * 0.26, 10, 8);
    tie.translate(0, r * 0.55, -r * 0.7);
    geos.push(tie);
    const tail = new THREE.ConeGeometry(r * 0.32, r * 1.9, 8);
    tail.rotateX(2.5);                              // point down-and-back
    tail.translate(0, -r * 0.2, -r * 1.0);
    geos.push(tail);
  }

  const merged = mergeGeometries(geos, false)!;
  const mesh = new THREE.Mesh(merged, hairToon(opts.color, { sheenColor: opts.sheenColor }));
  // hair does NOT cast shadow — at this scale a cast shadow only darkens the face
  mesh.castShadow = false;
  return mesh;
}
