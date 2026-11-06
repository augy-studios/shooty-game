// God rays for High graphics, after stack-game's (its js/post.js): light
// shafts fanning out of the sky past the trees, the hills, the clouds and
// the goal, towards wherever the sun is, on the screen or off it.
//
// What lights them is the open sky (the background writes no depth, so it
// reads as far off), brighter the nearer it is to the sun; nothing solid
// does. At quarter size, each pixel walks back towards the sun adding up
// the open sky on the way, each step fainter, so whatever stands in front
// of the sky casts dark gaps between bright beams. The beams then go over
// the picture: fully in the air over the sky, only faintly over something
// solid, so they do not streak down the goalposts.
//
// It reads the scene's colour and depth straight after the scene pass and
// before the bow or dart in hand, so those never cast a shaft.

import * as THREE from "three";
import { Pass, FullScreenQuad } from "../vendor/three/examples/jsm/postprocessing/Pass.js";

// How far each pixel looks back towards the sun, as a share of the way
// there, how fast each step fades, how bright the beams, and their tint.
const SAMPLES = 40;
const DENSITY = 0.85;
const DECAY = 0.955;
const RAYS = 0.6;
const TINT = new THREE.Color(1.0, 0.96, 0.86);
// How far from the middle of the screen the sun may be put, in screens.
const REACH = 1.1;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The open sky, weighed by how near it is to the sun.
const SOURCE = /* glsl */ `
  uniform sampler2D uScene;
  uniform sampler2D uDepth;
  uniform vec2 uSun;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    float open = step(0.99999, texture2D(uDepth, vUv).r);
    vec3 c = min(texture2D(uScene, vUv).rgb, vec3(2.0));
    vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
    float glow = 0.25 + 0.75 * exp(-dot(d, d) * 1.6);
    gl_FragColor = vec4(c * glow * open, 1.0);
  }
`;

const BLUR = /* glsl */ `
  #define SAMPLES ${SAMPLES}
  uniform sampler2D uSource;
  uniform vec2 uSun;
  uniform float uDensity;
  uniform float uDecay;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 stride = (vUv - uSun) * uDensity / float(SAMPLES);
    vec2 at = vUv - stride * hash(gl_FragCoord.xy);
    float fade = 1.0;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < SAMPLES; i++) {
      at -= stride;
      sum += texture2D(uSource, clamp(at, 0.0, 1.0)).rgb * fade;
      fade *= uDecay;
    }
    gl_FragColor = vec4(sum / float(SAMPLES), 1.0);
  }
`;

const MIX = /* glsl */ `
  uniform sampler2D uScene;
  uniform sampler2D uDepth;
  uniform sampler2D uRays;
  uniform float uStrength;
  uniform vec3 uTint;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uScene, vUv);
    float open = step(0.99999, texture2D(uDepth, vUv).r);
    c.rgb += texture2D(uRays, vUv).rgb * uTint * uStrength * mix(0.3, 1.0, open);
    gl_FragColor = c;
  }
`;

const material = (fragmentShader, uniforms) =>
  new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader, depthTest: false, depthWrite: false });

const sunPoint = new THREE.Vector3();
const toSun = new THREE.Vector3();
const facing = new THREE.Vector3();

export class GodRaysPass extends Pass {
  constructor() {
    super();
    const linear = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.source = new THREE.WebGLRenderTarget(1, 1, linear);
    this.rays = new THREE.WebGLRenderTarget(1, 1, linear);
    this.sourceMat = material(SOURCE, {
      uScene: { value: null },
      uDepth: { value: null },
      uSun: { value: new THREE.Vector2(0.5, 1.5) },
      uAspect: { value: 1 },
    });
    this.blurMat = material(BLUR, {
      uSource: { value: this.source.texture },
      uSun: { value: this.sourceMat.uniforms.uSun.value },
      uDensity: { value: DENSITY },
      uDecay: { value: DECAY },
    });
    this.mixMat = material(MIX, {
      uScene: { value: null },
      uDepth: { value: null },
      uRays: { value: this.rays.texture },
      uStrength: { value: 0 },
      uTint: { value: TINT },
    });
    this.quad = new FullScreenQuad(this.sourceMat);
    // Set each frame: the camera the scene was drawn with, the direction
    // of the sun in three.js's coordinates, and how bright, 0 to 1.
    this.camera = null;
    this.sun = new THREE.Vector3(0, 1, 1);
    this.level = 0;
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width / 4));
    const h = Math.max(1, Math.floor(height / 4));
    this.source.setSize(w, h);
    this.rays.setSize(w, h);
    this.sourceMat.uniforms.uAspect.value = width / Math.max(1, height);
  }

  // Fading out as the camera turns away from the sun, and off once it is
  // behind; then nothing is drawn and the picture is left as it is.
  strength() {
    if (!this.camera || this.level <= 0.001) return 0;
    this.camera.getWorldDirection(facing);
    toSun.copy(this.sun).normalize();
    return this.level * THREE.MathUtils.smoothstep(facing.dot(toSun), -0.1, 0.4);
  }

  render(renderer, writeBuffer, readBuffer) {
    const strength = this.strength();
    this.needsSwap = strength > 0.001;
    if (!this.needsSwap) return;
    const depth = readBuffer.depthTexture;
    sunPoint.copy(this.camera.position).addScaledVector(toSun, 300).project(this.camera);
    // Through a long lens (archery's) the sun lands far off the screen and
    // every step would fall past its edge, so it is brought in, the same
    // way round, to no more than a little past the edge.
    const sun = this.sourceMat.uniforms.uSun.value.set(sunPoint.x * 0.5, sunPoint.y * 0.5);
    if (sun.length() > REACH) sun.setLength(REACH);
    sun.addScalar(0.5);

    this.sourceMat.uniforms.uScene.value = readBuffer.texture;
    this.sourceMat.uniforms.uDepth.value = depth;
    this.quad.material = this.sourceMat;
    renderer.setRenderTarget(this.source);
    this.quad.render(renderer);

    this.quad.material = this.blurMat;
    renderer.setRenderTarget(this.rays);
    this.quad.render(renderer);

    this.mixMat.uniforms.uScene.value = readBuffer.texture;
    this.mixMat.uniforms.uDepth.value = depth;
    this.mixMat.uniforms.uStrength.value = strength * RAYS;
    this.quad.material = this.mixMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.source.dispose();
    this.rays.dispose();
    this.sourceMat.dispose();
    this.blurMat.dispose();
    this.mixMat.dispose();
    this.quad.dispose();
  }
}
