import Phaser from "phaser";

/** The four shades of the original Game Boy screen, darkest first. */
export const POCKET_SHADES = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];

const FRAG = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec3 uTint;
uniform float uPocket;
varying vec2 outTexCoord;
void main() {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  vec3 rgb = c.rgb * uTint;
  if (uPocket > 0.5) {
    float l = dot(rgb, vec3(0.299, 0.587, 0.114));
    if (l < 0.28) rgb = vec3(15.0, 56.0, 15.0) / 255.0;
    else if (l < 0.5) rgb = vec3(48.0, 98.0, 48.0) / 255.0;
    else if (l < 0.72) rgb = vec3(139.0, 172.0, 15.0) / 255.0;
    else rgb = vec3(155.0, 188.0, 15.0) / 255.0;
  }
  gl_FragColor = vec4(rgb, c.a);
}`;

/**
 * Whole-screen effects in one pass (WebGL): the day/night tint (a multiply colour) and
 * "Pocket mode", which redraws everything in four Game Boy greens.
 */
export class ScreenPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  tint: [number, number, number] = [1, 1, 1];
  pocket = false;

  constructor(game: Phaser.Game) {
    super({ game, name: "ScreenPipeline", fragShader: FRAG });
  }

  override onPreRender() {
    this.set3f("uTint", ...this.tint);
    this.set1f("uPocket", this.pocket ? 1 : 0);
  }
}

export function hexToUnitRgb(color: number): [number, number, number] {
  return [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
}
