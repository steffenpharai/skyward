import * as THREE from "three";
import { Input } from "../core/input";
import { heightAt } from "../core/noise";
import { settings } from "../ui/settings";

/** Third-person orbit camera that follows a target and avoids clipping terrain. */
export class OrbitCamera {
  yaw = 0;
  pitch = 0.35;
  distance = 9;
  private target = new THREE.Vector3();

  constructor(public cam: THREE.PerspectiveCamera, private input: Input) {}

  update(focus: THREE.Vector3, dt: number) {
    const [dx, dy] = this.input.consumeMouse();
    const sens = 0.0024 * settings.state.sensitivity;
    this.yaw -= dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * sens, -0.5, 1.2);

    // Smoothly track a point a bit above the player's feet.
    this.target.lerp(focus.clone().add(new THREE.Vector3(0, 1.6, 0)), 1 - Math.pow(0.001, dt));

    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp
    );
    let desired = this.target.clone().add(dir.multiplyScalar(this.distance));

    // Don't sink the camera below the ground.
    const groundY = heightAt(desired.x, desired.z) + 0.8;
    if (desired.y < groundY) desired.y = groundY;

    this.cam.position.lerp(desired, 1 - Math.pow(0.0001, dt));
    this.cam.lookAt(this.target);
  }

  /** Forward direction projected on the ground plane (for movement). */
  forwardFlat(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }
  rightFlat(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }
}
