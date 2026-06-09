import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import {
  BALL_RADIUS,
  CEILING_Y,
  COURT_HALF_WIDTH,
  NET_HALF_WIDTH,
  NET_HEIGHT,
  Side,
} from '../game/constants';
import { ContactEvent, SimState } from '../game/Simulation';
import { BlobMesh } from './BlobMesh';
import { ParticleSystem } from './Particles';
import {
  makeBeachBallTexture,
  makeBlobShadowTexture,
  makeSandTexture,
  makeSkyTexture,
} from './textures';

export const LEFT_COLOR = 0x3ec6ff;
export const RIGHT_COLOR = 0xff5470;

const LOOK_AT_Y = 4.2;

export class GameRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;

  private blobs: [BlobMesh, BlobMesh];
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private blobShadows: [THREE.Mesh, THREE.Mesh];
  private particles: ParticleSystem;

  private ballSpin = new THREE.Vector3();
  private prevBall = new THREE.Vector2();
  private shake = 0;
  private camBaseY = 7.2;
  private time = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene.background = makeSkyTexture('#2a3a8c', '#9fd3ff');
    this.scene.fog = new THREE.Fog(0x9fd3ff, 38, 75);

    this.camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.1, 200);
    this.camera.position.set(0, this.camBaseY, 28);
    this.fitCamera();
    this.camera.lookAt(0, LOOK_AT_Y, 0);

    this.buildLights();
    this.buildArena();

    // Blobs.
    this.blobs = [new BlobMesh(LEFT_COLOR), new BlobMesh(RIGHT_COLOR)];
    this.scene.add(this.blobs[0].group, this.blobs[1].group);

    // Ball.
    const ballMat = new THREE.MeshStandardMaterial({
      map: makeBeachBallTexture(),
      roughness: 0.35,
      metalness: 0.0,
    });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 40, 30), ballMat);
    this.ball.castShadow = true;
    this.scene.add(this.ball);

    // Shadows (fake contact shadows that scale with height).
    const shadowTex = makeBlobShadowTexture();
    this.ballShadow = this.makeShadowSprite(shadowTex, 2.4);
    this.blobShadows = [this.makeShadowSprite(shadowTex, 4), this.makeShadowSprite(shadowTex, 4)];
    this.scene.add(this.ballShadow, this.blobShadows[0], this.blobShadows[1]);

    // Particles.
    this.particles = new ParticleSystem();
    this.scene.add(this.particles.points);

    // Post-processing: subtle bloom for a glossy, modern glow.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.55, // strength
      0.7, // radius
      0.85, // threshold
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(container.clientWidth, container.clientHeight);

    window.addEventListener('resize', this.onResize);
  }

  /** Pull the camera back far enough that the full court fits on any aspect. */
  private fitCamera(): void {
    const margin = 1.8;
    const halfW = COURT_HALF_WIDTH + margin;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distW = halfW / Math.tan(hFov / 2);
    const distH = 6.8 / Math.tan(vFov / 2); // vertical framing around the action
    this.camera.position.z = Math.max(distW, distH, 18);
  }

  private makeShadowSprite(tex: THREE.Texture, size: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.rotation.x = -Math.PI / 2; // lay flat on the floor
    return m;
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0xe9c98a, 0.85);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    sun.position.set(-9, 18, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    const d = 16;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 4;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
    rim.position.set(8, 6, -10);
    this.scene.add(rim);
  }

  private buildArena(): void {
    // --- Floor (sand) ---
    const floorMat = new THREE.MeshStandardMaterial({ map: makeSandTexture(), roughness: 0.95, metalness: 0 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Court playing area highlight.
    const courtMat = new THREE.MeshStandardMaterial({ color: 0xd9b066, roughness: 0.9, transparent: true, opacity: 0.5 });
    const court = new THREE.Mesh(new THREE.PlaneGeometry(COURT_HALF_WIDTH * 2 + 1.2, 9), courtMat);
    court.rotation.x = -Math.PI / 2;
    court.position.set(0, 0.01, 0);
    court.receiveShadow = true;
    this.scene.add(court);

    // Court border line.
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 });
    const makeLine = (w: number, h: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.02, z);
      this.scene.add(m);
    };
    const halfW = COURT_HALF_WIDTH + 0.4;
    makeLine(halfW * 2, 0.12, 0, -4.5);
    makeLine(halfW * 2, 0.12, 0, 4.5);
    makeLine(0.12, 9, -halfW, 0);
    makeLine(0.12, 9, halfW, 0);

    // --- Net ---
    const netGroup = new THREE.Group();
    // Posts.
    const postMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.4, metalness: 0.2 });
    const postGeo = new THREE.CylinderGeometry(0.12, 0.14, NET_HEIGHT + 0.6, 16);
    for (const z of [-4.6, 4.6]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(0, (NET_HEIGHT + 0.6) / 2, z);
      post.castShadow = true;
      netGroup.add(post);
    }
    // Net mesh (semi-transparent grid).
    const netMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      roughness: 0.6,
    });
    const netPanel = new THREE.Mesh(new THREE.PlaneGeometry(NET_HALF_WIDTH * 2 + 0.02, NET_HEIGHT, 1, 1), netMat);
    netPanel.position.set(0, NET_HEIGHT / 2, 0);
    netPanel.rotation.y = Math.PI / 2;
    netPanel.scale.z = 9.2;
    netGroup.add(netPanel);
    // Net top band (glowing accent — picked up by bloom).
    const bandMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const band = new THREE.Mesh(new THREE.BoxGeometry(NET_HALF_WIDTH * 2 + 0.06, 0.22, 9.2), bandMat);
    band.position.set(0, NET_HEIGHT, 0);
    netGroup.add(band);
    this.scene.add(netGroup);

    // --- Decorative glowing boundary pillars (bloom accents) ---
    const accentMat = (color: number) =>
      new THREE.MeshBasicMaterial({ color });
    for (const [x, color] of [
      [-COURT_HALF_WIDTH - 0.4, LEFT_COLOR],
      [COURT_HALF_WIDTH + 0.4, RIGHT_COLOR],
    ] as const) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.18, CEILING_Y, 0.18), accentMat(color));
      pillar.position.set(x, CEILING_Y / 2, -4.6);
      this.scene.add(pillar);
      const pillar2 = pillar.clone();
      pillar2.position.z = 4.6;
      this.scene.add(pillar2);
    }
  }

  /** Sync all meshes from the authoritative simulation state. */
  sync(state: SimState, dt: number, alpha = 1): void {
    this.time += dt;
    const ball = state.ball;

    // Ball position.
    this.ball.position.set(ball.pos.x, ball.pos.y, 0);

    // Spin the ball based on horizontal travel.
    const travelX = ball.pos.x - this.prevBall.x;
    const travelY = ball.pos.y - this.prevBall.y;
    this.prevBall.set(ball.pos.x, ball.pos.y);
    this.ballSpin.x += travelY * 0.9;
    this.ballSpin.z -= travelX * 0.9;
    this.ball.rotation.set(this.ballSpin.x, 0, this.ballSpin.z);

    // Blobs.
    const ballWorld = new THREE.Vector3(ball.pos.x, ball.pos.y, 0);
    for (const side of [Side.Left, Side.Right]) {
      const b = state.blobs[side];
      this.blobs[side].update(b.pos.x, b.pos.y, b.vel.x, b.vel.y, ballWorld);
    }

    // Shadows.
    this.updateShadow(this.ballShadow, ball.pos.x, ball.pos.y, 2.4, 1.0);
    for (const side of [Side.Left, Side.Right]) {
      const b = state.blobs[side];
      this.updateShadow(this.blobShadows[side], b.pos.x, b.pos.y, 4, 1.4);
    }

    // Particles + camera shake decay.
    this.particles.update(dt);
    this.shake *= Math.pow(0.001, dt);
    void alpha;

    // Gentle camera life.
    const sway = Math.sin(this.time * 0.4) * 0.15;
    this.camera.position.x = sway + (Math.random() - 0.5) * this.shake;
    this.camera.position.y = this.camBaseY + (Math.random() - 0.5) * this.shake;
    this.camera.lookAt(0, LOOK_AT_Y, 0);
  }

  private updateShadow(mesh: THREE.Mesh, x: number, y: number, base: number, falloff: number): void {
    mesh.position.set(x, 0.03, 0);
    // Higher up => bigger, fainter shadow.
    const h = Math.max(0, y);
    const scale = base * (1 - Math.min(0.55, h * 0.05 * falloff));
    mesh.scale.set(scale / base, scale / base, 1);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - Math.min(0.7, h * 0.06));
  }

  /** Turn simulation contacts into particle bursts + shake + spin kicks. */
  handleContacts(contacts: ContactEvent[]): void {
    for (const c of contacts) {
      switch (c.type) {
        case 'blob': {
          const color = c.side === Side.Left ? new THREE.Color(LEFT_COLOR) : new THREE.Color(RIGHT_COLOR);
          this.particles.burst(c.x, c.y, 14, color, Math.min(8, 3 + c.strength * 0.25));
          this.shake = Math.min(0.45, this.shake + c.strength * 0.012);
          break;
        }
        case 'ground': {
          this.particles.burst(c.x, c.y, 26, new THREE.Color(0xe9c98a), Math.min(10, 4 + c.strength * 0.3));
          this.shake = Math.min(0.6, this.shake + 0.25);
          break;
        }
        case 'net':
          this.particles.burst(c.x, c.y, 8, new THREE.Color(0xffffff), 4);
          break;
        case 'wall':
        case 'ceiling':
          this.particles.burst(c.x, c.y, 6, new THREE.Color(0xbfe3ff), 4);
          break;
      }
    }
  }

  /** Burst of celebratory confetti at a point (used on scoring). */
  celebrate(side: Side): void {
    const x = side === Side.Left ? -COURT_HALF_WIDTH * 0.5 : COURT_HALF_WIDTH * 0.5;
    const color = side === Side.Left ? new THREE.Color(LEFT_COLOR) : new THREE.Color(RIGHT_COLOR);
    for (let i = 0; i < 4; i++) {
      this.particles.burst(x + (Math.random() - 0.5) * 4, 2 + Math.random() * 4, 24, color, 9);
    }
    this.shake = 0.4;
  }

  render(): void {
    this.composer.render();
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.fitCamera();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
