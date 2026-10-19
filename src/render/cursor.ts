/**
 * Kurzor pohľadu: malá bodka na rovine tlačidla a kruh, ktorý sa plní počas dwell.
 * Kruh je shader s uniformou uProgress, takže sa počas plnenia nič neprekresľuje.
 */
import {
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { GazeSystem } from '../core/gaze';

const Z = new Vector3(0, 0, 1);
const normal = new Vector3();

const ringVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFragment = /* glsl */ `
  uniform float uProgress;
  uniform vec3 uColor;
  varying vec2 vUv;
  const float PI2 = 6.28318530718;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float edge = fwidth(r) * 1.5;
    float band = smoothstep(0.62 - edge, 0.62, r) * (1.0 - smoothstep(0.92, 0.92 + edge, r));
    if (band <= 0.0) discard;
    // Uhol od 12. hodiny v smere hodinových ručičiek.
    float a = atan(p.x, p.y);
    if (a < 0.0) a += PI2;
    float filled = step(a / PI2, uProgress);
    vec3 color = mix(vec3(1.0), uColor, filled);
    float alpha = mix(0.28, 1.0, filled) * band;
    gl_FragColor = vec4(color, alpha);
  }
`;

export class GazeCursor {
  readonly group = new Group();
  private readonly ring: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor() {
    const dot = new Mesh(
      new CircleGeometry(0.008, 20),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false }),
    );
    dot.renderOrder = 1001;
    this.ring = new Mesh(
      new PlaneGeometry(0.07, 0.07),
      new ShaderMaterial({
        uniforms: { uProgress: { value: 0 }, uColor: { value: new Color(0xffc72c) } },
        vertexShader: ringVertex,
        fragmentShader: ringFragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.ring.renderOrder = 1000;
    this.group.add(this.ring, dot);
    this.group.visible = false;
  }

  update(gaze: GazeSystem): void {
    this.group.visible = gaze.cursorVisible;
    if (!gaze.cursorVisible) return;
    const c = gaze.cursor;
    const nrm = gaze.cursorNormal;
    this.group.position.set(c.x + nrm.x * 0.01, c.y + nrm.y * 0.01, c.z + nrm.z * 0.01);
    this.group.quaternion.setFromUnitVectors(Z, normal.set(nrm.x, nrm.y, nrm.z));
    this.ring.visible = gaze.focused !== null;
    this.ring.material.uniforms.uProgress!.value = gaze.progress;
  }
}
