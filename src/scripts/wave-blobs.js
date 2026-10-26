const FRAME_MS = 33;
const HOVER_SECONDS = 2.65;
const MAX_PIXEL_RATIO = 2;

const VERT = `
attribute vec2 aCorner;
void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uDark;
uniform float uFromTop;
uniform float uPixelRatio;
uniform float uHover;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.11369, 0.13787));
  q += dot(q, q.yzx + 19.19);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float shore(float x, float time, float ratio) {
  float amp = 25.0 * ratio;
  float swell = noise(vec2(x * 0.008, time * 0.08));
  float chop = noise(vec2(x * 0.02, time * 0.04 + 50.0));
  return 50.0 * ratio + (swell * 2.0 - 1.0) * amp + (chop * 2.0 - 1.0) * amp * 0.4;
}

vec2 warp(vec2 p, float time) {
  float nx = noise(p * 0.5 + vec2(time * 0.05, 3.0)) - 0.5;
  float ny = noise(p * 0.32 + vec2(18.0, -time * 0.03)) - 0.5;
  return p + vec2(nx, ny) * 0.85;
}

vec2 spray(vec2 p, float time, float hover, float phase) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  float field = 0.0;
  float accent = 0.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 id = cell + vec2(float(x), float(y));
      vec2 jitter = vec2(hash(id), hash(id + vec2(5.2, 1.3)));
      vec2 center = 0.5 + 0.4 * sin(time * 0.3 + phase + 6.2831853 * jitter);
      vec2 delta = vec2(float(x), float(y)) + center - local;
      float radius = max(0.0, 1.0 - dot(delta, delta));
      float weight = radius * radius * radius;
      field += weight;

      float marked = step(0.92, hash(id + vec2(2.4, 9.1)));
      float delay = hash(id + vec2(7.7, 3.3)) * 0.75;
      float reveal = smoothstep(delay, delay + 0.25, hover);
      accent += weight * marked * reveal;
    }
  }

  return vec2(field, accent);
}

void main() {
  float ratio = max(uPixelRatio, 1.0);
  vec2 frag = gl_FragCoord.xy;
  float inland = mix(frag.y, uResolution.y - frag.y, uFromTop);
  float edge = shore(frag.x / ratio, uTime, ratio);
  float depth = inland - edge;
  float gather = smoothstep(40.0 * ratio, 0.0, depth) * 0.25;
  float fade = smoothstep(-30.0 * ratio, 0.0, depth);

  vec2 p = frag * 0.0128;
  vec2 deepPoint = warp(p * 0.68 + vec2(uTime * 0.018, uTime * 0.012), uTime * 0.55);
  vec2 foamPoint = warp(p + vec2(uTime * 0.055, -uTime * 0.016) + vec2(90.0, 12.0), uTime);
  vec2 deep = spray(deepPoint, uTime, uHover, 0.0);
  vec2 foam = spray(foamPoint, uTime, uHover, 1.7);

  float deepField = (deep.x + gather) * fade;
  float foamField = (foam.x + gather) * fade;
  float aa = 0.006 / ratio;
  float deepMask = smoothstep(0.9 - aa, 0.9 + aa, deepField);
  float foamMask = smoothstep(0.94 - aa, 0.94 + aa, foamField);

  vec3 page = mix(vec3(1.0), vec3(0.105882, 0.192157, 0.337255), uDark);
  vec3 navy = mix(vec3(0.04, 0.22, 0.44), vec3(0.12, 0.24, 0.40), uDark);
  vec3 bright = mix(vec3(0.10, 0.42, 0.70), vec3(0.32, 0.55, 0.82), uDark);
  vec3 accent = mix(vec3(0.803922, 0.054902, 0.054902), vec3(1.0, 0.4, 0.4), uDark);

  float deepRed = deep.x > 0.001 ? smoothstep(0.28, 0.62, deep.y / deep.x) : 0.0;
  float foamRed = foam.x > 0.001 ? smoothstep(0.28, 0.62, foam.y / foam.x) : 0.0;

  vec3 color = mix(page, mix(navy, accent, deepRed), deepMask);
  color = mix(color, mix(bright, accent, foamRed), foamMask);
  gl_FragColor = vec4(color, 1.0);
}
`;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function pageIsDark() {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'dark') return 1;
  if (theme === 'light') return 0;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 1 : 0;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function pixelRatio() {
  const ratio = window.devicePixelRatio || 1;
  return Math.min(Math.max(ratio, 1), MAX_PIXEL_RATIO);
}

function createEffect(band) {
  const canvas = band.querySelector('canvas');
  if (!canvas) return null;
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;

  const vertex = compile(gl, gl.VERTEX_SHADER, VERT);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vertex || !fragment) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'aCorner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    resolution: gl.getUniformLocation(program, 'uResolution'),
    time: gl.getUniformLocation(program, 'uTime'),
    dark: gl.getUniformLocation(program, 'uDark'),
    fromTop: gl.getUniformLocation(program, 'uFromTop'),
    pixelRatio: gl.getUniformLocation(program, 'uPixelRatio'),
    hover: gl.getUniformLocation(program, 'uHover'),
  };
  gl.uniform1f(uniforms.fromTop, band.dataset.blob === 'bottom' ? 1 : 0);

  return { band, canvas, gl, uniforms, hover: 0, target: 0, dirty: true };
}

function resize(effect) {
  const { canvas, gl, uniforms } = effect;
  const ratio = pixelRatio();
  if (canvas.clientWidth < 2 || canvas.clientHeight < 2) return false;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
  gl.uniform1f(uniforms.pixelRatio, ratio);
  effect.dirty = false;
  return true;
}

function paint(effect, time) {
  const { gl, uniforms } = effect;
  if (effect.dirty && !resize(effect)) return;
  gl.uniform1f(uniforms.time, time);
  gl.uniform1f(uniforms.dark, pageIsDark());
  gl.uniform1f(uniforms.hover, effect.hover);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function markStatic(band) {
  band.classList.add('is-static');
  band.dataset.blobState = 'static';
}

export function mountWaveBlobs() {
  const bands = [...document.querySelectorAll('[data-blob]')];
  if (!bands.length || bands.some((band) => band.dataset.blobState)) return;

  const reduced = prefersReducedMotion();
  const effects = [];
  for (const band of bands) {
    const effect = createEffect(band);
    if (!effect) {
      markStatic(band);
      continue;
    }
    effects.push(effect);
    band.classList.add('is-live');
    band.dataset.blobState = reduced ? 'still' : 'live';
  }
  if (!effects.length) return;

  const started = performance.now();
  const paintAll = (hoverEnabled) => {
    const time = reduced ? 12.4 : (performance.now() - started) / 1000;
    for (const effect of effects) {
      if (!hoverEnabled) effect.hover = 0;
      paint(effect, time);
    }
  };

  paintAll(false);
  if (reduced) return;

  for (const effect of effects) {
    effect.band.addEventListener('pointerenter', () => {
      effect.target = 1;
    });
    effect.band.addEventListener('pointerleave', () => {
      effect.target = 0;
    });
  }

  const visible = new Set();
  let pageVisible = !document.hidden;
  let raf = 0;
  let last = 0;
  let previous = performance.now();

  const running = () => pageVisible && visible.size > 0;

  const frame = (now) => {
    raf = 0;
    if (!running()) return;
    if (now - last < FRAME_MS) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const step = Math.min(0.05, (now - previous) / 1000);
    previous = now;
    last = now;
    const time = (now - started) / 1000;
    const dark = pageIsDark();
    for (const effect of effects) {
      if (effect.target > effect.hover) effect.hover = Math.min(effect.target, effect.hover + step / HOVER_SECONDS);
      else if (effect.target < effect.hover) effect.hover = Math.max(effect.target, effect.hover - step / HOVER_SECONDS);
      if (!visible.has(effect.canvas)) continue;
      effect.gl.uniform1f(effect.uniforms.dark, dark);
      paint(effect, time);
    }
    raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    if (!raf && running()) raf = requestAnimationFrame(frame);
  };

  document.addEventListener('visibilitychange', () => {
    pageVisible = !document.hidden;
    previous = performance.now();
    kick();
  });

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    kick();
  });

  for (const effect of effects) observer.observe(effect.canvas);

  const onResize = () => {
    for (const effect of effects) effect.dirty = true;
    if (!running()) paintAll(true);
  };
  window.addEventListener('resize', onResize);

  const theme = new MutationObserver(() => {
    paintAll(true);
  });
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    observer.disconnect();
    theme.disconnect();
    window.removeEventListener('resize', onResize);
    for (const effect of effects) {
      effect.hover = 0;
      effect.target = 0;
      effect.band.dataset.blobState = 'still';
    }
    paintAll(false);
  };
  if (motion.addEventListener) motion.addEventListener('change', (event) => {
    if (event.matches) stop();
  });
}
