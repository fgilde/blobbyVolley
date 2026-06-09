import * as THREE from 'three';
import { BLOB_RADIUS } from '../game/constants';

// Purely cosmetic: the collision circle is centered on the ground (so the blob
// is a dome = upper hemisphere), but rendering exactly half a sphere reads as
// "buried in the sand". Lifting the mesh a bit shows more than a hemisphere, so
// the blob looks like a rounded body sitting ON the sand.
const GROUND_LIFT = BLOB_RADIUS * 0.42;

/**
 * A friendly Blobby avatar: a glossy dome with two googly eyes. It squashes and
 * stretches based on vertical velocity and leans in the direction of travel.
 */
export class BlobMesh {
  group = new THREE.Group();
  private body: THREE.Mesh;
  private eyeL: THREE.Group;
  private eyeR: THREE.Group;
  private pupilL: THREE.Mesh;
  private pupilR: THREE.Mesh;
  private squash = 1;

  constructor(color: number) {
    // Dome = a slightly squashed sphere. Pivot at the bottom so it sits on the floor.
    const geo = new THREE.SphereGeometry(BLOB_RADIUS, 48, 36);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.28,
      metalness: 0.0,
      emissive: new THREE.Color(color).multiplyScalar(0.06),
    });
    this.body = new THREE.Mesh(geo, mat);
    this.body.castShadow = true;
    this.body.receiveShadow = false;
    this.body.scale.set(1, 1.05, 1);
    this.group.add(this.body);

    // A subtle rim/clear-coat highlight using a second additive shell.
    const glossGeo = new THREE.SphereGeometry(BLOB_RADIUS * 1.002, 48, 36);
    const glossMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.08,
      roughness: 0.05,
      metalness: 0.4,
      depthWrite: false,
    });
    const gloss = new THREE.Mesh(glossGeo, glossMat);
    this.body.add(gloss);

    this.eyeL = this.makeEye();
    this.eyeR = this.makeEye();
    this.pupilL = this.eyeL.children[1] as THREE.Mesh;
    this.pupilR = this.eyeR.children[1] as THREE.Mesh;

    const eyeY = BLOB_RADIUS * 0.55;
    const eyeX = BLOB_RADIUS * 0.34;
    const eyeZ = BLOB_RADIUS * 0.78;
    this.eyeL.position.set(-eyeX, eyeY, eyeZ);
    this.eyeR.position.set(eyeX, eyeY, eyeZ);
    this.body.add(this.eyeL);
    this.body.add(this.eyeR);
  }

  private makeEye(): THREE.Group {
    const g = new THREE.Group();
    const white = new THREE.Mesh(
      new THREE.SphereGeometry(BLOB_RADIUS * 0.22, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }),
    );
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(BLOB_RADIUS * 0.11, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0x141622, roughness: 0.1 }),
    );
    pupil.position.z = BLOB_RADIUS * 0.16;
    g.add(white);
    g.add(pupil);
    return g;
  }

  /**
   * @param x,y      sim position (y = bottom of blob)
   * @param vx,vy    sim velocity (for squash/stretch + lean)
   * @param lookAt   world-space point the eyes should track (usually the ball)
   */
  update(x: number, y: number, vx: number, vy: number, lookAt: THREE.Vector3): void {
    this.group.position.set(x, y + GROUND_LIFT, 0);

    // Squash & stretch: stretch up when moving up, squash when landing.
    const targetSquash = THREE.MathUtils.clamp(1 + vy * 0.012, 0.82, 1.18);
    this.squash += (targetSquash - this.squash) * 0.25;
    const inv = 1 / this.squash;
    this.body.scale.set(inv, this.squash * 1.05, inv);

    // Lean in the direction of horizontal motion.
    this.body.rotation.z = THREE.MathUtils.clamp(-vx * 0.02, -0.25, 0.25);

    // Eye tracking — pupils drift toward the ball.
    const localTarget = lookAt.clone().sub(this.group.position).normalize();
    const off = BLOB_RADIUS * 0.06;
    this.pupilL.position.x = localTarget.x * off;
    this.pupilL.position.y = localTarget.y * off;
    this.pupilR.position.x = localTarget.x * off;
    this.pupilR.position.y = localTarget.y * off;
  }

  setColor(color: number): void {
    (this.body.material as THREE.MeshStandardMaterial).color.set(color);
    (this.body.material as THREE.MeshStandardMaterial).emissive.set(new THREE.Color(color).multiplyScalar(0.06));
  }
}
