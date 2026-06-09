import * as THREE from 'three';

interface Particle {
  life: number;
  maxLife: number;
}

/**
 * A small GPU-light particle burst system. A fixed pool of points is reused for
 * every hit/landing burst; dead particles are parked off-screen with zero size.
 */
export class ParticleSystem {
  points: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private particles: Particle[];
  private cursor = 0;
  private readonly max: number;

  constructor(max = 600) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.velocities = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.particles = Array.from({ length: max }, () => ({ life: 0, maxLife: 1 }));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    // Custom shader so each particle respects its own `size` attribute
    // (size 0 => invisible, which is how dead particles are hidden) and renders
    // as a soft round sprite instead of a hard square.
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = dot(uv, uv);
          if (d > 0.25) discard;
          float a = smoothstep(0.25, 0.02, d);
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  burst(x: number, y: number, count: number, color: THREE.Color, spread = 6): void {
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const p = this.particles[idx];
      p.maxLife = 0.4 + Math.random() * 0.5;
      p.life = p.maxLife;

      this.positions[idx * 3] = x;
      this.positions[idx * 3 + 1] = y;
      this.positions[idx * 3 + 2] = (Math.random() - 0.5) * 0.6;

      const ang = Math.random() * Math.PI * 2;
      const sp = Math.random() * spread;
      this.velocities[idx * 3] = Math.cos(ang) * sp;
      this.velocities[idx * 3 + 1] = Math.abs(Math.sin(ang) * sp) + 1.5;
      this.velocities[idx * 3 + 2] = (Math.random() - 0.5) * sp * 0.5;

      const c = color.clone().offsetHSL((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.15);
      this.colors[idx * 3] = c.r;
      this.colors[idx * 3 + 1] = c.g;
      this.colors[idx * 3 + 2] = c.b;
      this.sizes[idx] = 0.3 + Math.random() * 0.4;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      const p = this.particles[i];
      if (p.life <= 0) {
        if (this.sizes[i] !== 0) this.sizes[i] = 0;
        continue;
      }
      p.life -= dt;
      const t = i * 3;
      this.velocities[t + 1] += -14 * dt; // gravity
      this.positions[t] += this.velocities[t] * dt;
      this.positions[t + 1] += this.velocities[t + 1] * dt;
      this.positions[t + 2] += this.velocities[t + 2] * dt;
      const k = Math.max(0, p.life / p.maxLife);
      this.sizes[i] = (0.15 + 0.45 * k) ;
      if (p.life <= 0) this.sizes[i] = 0;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
  }
}
