// Liquid-glass rendering for the fold-preview header and control dock, adapted
// from liquid-glass-js (MIT, https://github.com/shuding/liquid-glass).
//
// Architecture: the page behind each glass element has exactly two layers —
//   1. static DOM content (text, background), captured once with html2canvas
//      and re-captured only when layout actually changes;
//   2. the live Three.js WebGL canvas, which is the only thing that ever moves.
// A single rAF loop composites both layers into a small per-element backing
// canvas (two GPU drawImage calls) and uploads it as the shader's texture, so
// the glass refracts the moving model with one-frame precision at negligible
// cost. No html2canvas in the hot path.

const GLASS_PRESETS = {
  dock: {
    edgeIntensity: 0.026,
    rimIntensity: 0.022,
    baseIntensity: 0.02,
    edgeDistance: 0.28,
    rimDistance: 1.272,
    baseDistance: 0.231,
    cornerBoost: 0.029,
    rippleEffect: 0.09,
    blurRadius: 2.387,
    tintOpacity: 0.247,
  },
  header: {
    edgeIntensity: 0.027,
    rimIntensity: 0.141,
    baseIntensity: 0.012,
    edgeDistance: 0.324,
    rimDistance: 1.075,
    baseDistance: 0.18,
    cornerBoost: 0.041,
    rippleEffect: 0.276,
    blurRadius: 2.0,
    tintOpacity: 0.13,
  },
};

class DockGlass {
  constructor(element, { borderRadius, settings } = {}) {
    this.element = element;
    this.settings = settings || GLASS_PRESETS.dock;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'liquid-glass-canvas';
    this.element.prepend(this.canvas);
    this.backing = document.createElement('canvas'); // Composite of what sits behind the element.
    this.backingContext = this.backing.getContext('2d');
    this.measure(borderRadius);
    this.gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (!this.gl) {
      console.warn('Liquid glass disabled: WebGL unavailable');
      this.canvas.remove();
      return;
    }
    new ResizeObserver(() => this.measure()).observe(element);
    element.__glass = this; // Debug handle.
    DockGlass.instances.push(this);
    this.setupShader();
  }

  // Size the canvas (and capsule radius) from the dock's laid-out dimensions.
  measure(borderRadius) {
    const rect = this.element.getBoundingClientRect();
    const width = Math.max(2, Math.ceil(rect.width));
    const height = Math.max(2, Math.ceil(rect.height));
    if (borderRadius !== undefined) this.borderRadius = borderRadius;
    else this.borderRadius = Math.ceil(height / 2);
    this.canvas.style.borderRadius = this.borderRadius + 'px';
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.backing.width = width;
      this.backing.height = height;
      this.sizeDirty = true;
    }
  }

  static async captureSnapshot() {
    if (DockGlass.capturing) {
      DockGlass.recaptureQueued = true; // Refresh again once the current pass ends.
      return;
    }
    DockGlass.capturing = true;
    try {
      const snapshot = await html2canvas(document.body, {
        scale: 1,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#f6f6f3', // Opaque page background; null would make every pixel transparent (and the glass black).
        // Hide the glass hosts in the cloned document with visibility (layout is
        // preserved, so nothing shifts) — otherwise the glass would refract its
        // own controls/text as ghosts behind the real ones.
        onclone: doc => {
          for (const el of doc.querySelectorAll('.control-dock, .page-header, .liquid-glass-canvas')) {
            el.style.visibility = 'hidden';
          }
        },
      });
      DockGlass.staticPage = snapshot;
      DockGlass.viewCanvas = document.querySelector('#viewport canvas');
    } catch (error) {
      console.error('Liquid glass: static snapshot failed, falling back to background fill', error);
    } finally {
      DockGlass.capturing = false;
      if (DockGlass.recaptureQueued) {
        DockGlass.recaptureQueued = false;
        DockGlass.captureSnapshot();
      }
    }
  }

  init() {
    this.setupShader();
  }

  setupShader() {
    const gl = this.gl;

    const vsSource = `
      attribute vec2 a_position;
      attribute vec2 a_texcoord;
      varying vec2 v_texcoord;
      void main() {
        gl_Position = vec4(a_position, 0, 1);
        v_texcoord = a_texcoord;
      }
    `;

    // The texture now IS the region behind the element (composed per frame), so
    // sampling is 1:1 — no scroll or page-coordinate math left in the shader.
    const fsSource = `
      precision mediump float;
      uniform sampler2D u_image;
      uniform vec2 u_resolution;
      uniform float u_blurRadius;
      uniform float u_borderRadius;
      uniform float u_edgeIntensity;
      uniform float u_rimIntensity;
      uniform float u_baseIntensity;
      uniform float u_edgeDistance;
      uniform float u_rimDistance;
      uniform float u_baseDistance;
      uniform float u_cornerBoost;
      uniform float u_rippleEffect;
      uniform float u_tintOpacity;
      varying vec2 v_texcoord;

      float roundedRectDistance(vec2 coord, vec2 size, float radius) {
        vec2 center = size * 0.5;
        vec2 pixelCoord = coord * size;
        vec2 toCorner = abs(pixelCoord - center) - (center - radius);
        float outsideCorner = length(max(toCorner, 0.0));
        float insideCorner = min(max(toCorner.x, toCorner.y), 0.0);
        return (outsideCorner + insideCorner - radius);
      }

      void main() {
        vec2 coord = v_texcoord;

        float distFromEdgeShape = max(-roundedRectDistance(coord, u_resolution, u_borderRadius), 0.0);
        vec2 shapeNormal = normalize(coord - vec2(0.5));

        float distFromLeft = coord.x;
        float distFromRight = 1.0 - coord.x;
        float distFromTop = coord.y;
        float distFromBottom = 1.0 - coord.y;
        float distFromEdge = distFromEdgeShape / min(u_resolution.x, u_resolution.y);

        float normalizedDistance = distFromEdge * min(u_resolution.x, u_resolution.y);
        float edgeIntensity = exp(-normalizedDistance * u_edgeDistance);
        float rimIntensity = exp(-normalizedDistance * u_rimDistance);

        float totalIntensity = edgeIntensity * u_edgeIntensity + rimIntensity * u_rimIntensity;
        vec2 baseRefraction = shapeNormal * totalIntensity;

        float cornerProximityX = min(distFromLeft, distFromRight);
        float cornerProximityY = min(distFromTop, distFromBottom);
        float cornerDistance = max(cornerProximityX, cornerProximityY);
        float cornerNormalized = cornerDistance * min(u_resolution.x, u_resolution.y);

        float cornerBoost = exp(-cornerNormalized * 0.3) * u_cornerBoost;
        vec2 cornerRefraction = shapeNormal * cornerBoost;

        vec2 perpendicular = vec2(-shapeNormal.y, shapeNormal.x);
        float rippleEffect = sin(distFromEdge * 25.0) * u_rippleEffect * rimIntensity;
        vec2 textureRefraction = perpendicular * rippleEffect;

        vec2 textureCoord = coord + baseRefraction + cornerRefraction + textureRefraction;

        vec4 color = vec4(0.0);
        vec2 texelSize = 1.0 / u_resolution;
        float sigma = u_blurRadius / 2.0;
        vec2 blurStep = texelSize * sigma;

        float totalWeight = 0.0;
        for (float i = -6.0; i <= 6.0; i += 1.0) {
          for (float j = -6.0; j <= 6.0; j += 1.0) {
            float distance = length(vec2(i, j));
            if (distance > 6.0) continue;
            float weight = exp(-(distance * distance) / (2.0 * sigma * sigma));
            vec2 offset = vec2(i, j) * blurStep;
            color += texture2D(u_image, textureCoord + offset) * weight;
            totalWeight += weight;
          }
        }
        color /= totalWeight;

        float gradientPosition = coord.y;
        vec3 topTint = vec3(1.0, 1.0, 1.0);
        vec3 bottomTint = vec3(0.7, 0.7, 0.7);
        vec3 gradientTint = mix(topTint, bottomTint, gradientPosition);
        vec3 tintedColor = mix(color.rgb, gradientTint, u_tintOpacity);
        color = vec4(tintedColor, color.a);

        float topY = 0.2;
        float midY = 0.5;
        float bottomY = 0.8;
        vec3 topColor = vec3(0.0);
        vec3 midColor = vec3(0.0);
        vec3 bottomColor = vec3(0.0);
        float sampleCount = 0.0;
        for (float x = 0.0; x < 1.0; x += 0.05) {
          for (float yOffset = -5.0; yOffset <= 5.0; yOffset += 1.0) {
            vec2 topSample = vec2(x, topY + yOffset * texelSize.y);
            vec2 midSample = vec2(x, midY + yOffset * texelSize.y);
            vec2 bottomSample = vec2(x, bottomY + yOffset * texelSize.y);
            topColor += texture2D(u_image, topSample).rgb;
            midColor += texture2D(u_image, midSample).rgb;
            bottomColor += texture2D(u_image, bottomSample).rgb;
            sampleCount += 1.0;
          }
        }
        topColor /= sampleCount;
        midColor /= sampleCount;
        bottomColor /= sampleCount;

        vec3 sampledGradient;
        if (gradientPosition < 0.1) {
          sampledGradient = topColor;
        } else if (gradientPosition > 0.9) {
          sampledGradient = bottomColor;
        } else {
          float transitionPos = (gradientPosition - 0.1) / 0.8;
          if (transitionPos < 0.5) {
            float t = transitionPos * 2.0;
            sampledGradient = mix(topColor, midColor, t);
          } else {
            float t = (transitionPos - 0.5) * 2.0;
            sampledGradient = mix(midColor, bottomColor, t);
          }
        }

        vec3 finalTinted = mix(color.rgb, sampledGradient, u_tintOpacity * 0.3);
        color = vec4(finalTinted, color.a);

        float maskDistance = roundedRectDistance(coord, u_resolution, u_borderRadius);
        float mask = 1.0 - smoothstep(-1.0, 1.0, maskDistance);

        gl_FragColor = vec4(color.rgb, mask);
      }
    `;

    const program = this.createProgram(gl, vsSource, fsSource);
    if (!program) return;

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const texcoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]), gl.STATIC_DRAW);

    const loc = name => gl.getUniformLocation(program, name);
    this.gl_refs = {
      gl,
      texture: gl.createTexture(),
      resolutionLoc: loc('u_resolution'),
      blurRadiusLoc: loc('u_blurRadius'),
      borderRadiusLoc: loc('u_borderRadius'),
      edgeIntensityLoc: loc('u_edgeIntensity'),
      rimIntensityLoc: loc('u_rimIntensity'),
      baseIntensityLoc: loc('u_baseIntensity'),
      edgeDistanceLoc: loc('u_edgeDistance'),
      rimDistanceLoc: loc('u_rimDistance'),
      baseDistanceLoc: loc('u_baseDistance'),
      cornerBoostLoc: loc('u_cornerBoost'),
      rippleEffectLoc: loc('u_rippleEffect'),
      tintOpacityLoc: loc('u_tintOpacity'),
      imageLoc: loc('u_image'),
      positionLoc: gl.getAttribLocation(program, 'a_position'),
      texcoordLoc: gl.getAttribLocation(program, 'a_texcoord'),
      positionBuffer,
      texcoordBuffer,
    };
    const refs = this.gl_refs;
    const s = this.settings;

    gl.bindTexture(gl.TEXTURE_2D, refs.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, refs.positionBuffer);
    gl.enableVertexAttribArray(refs.positionLoc);
    gl.vertexAttribPointer(refs.positionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, refs.texcoordBuffer);
    gl.enableVertexAttribArray(refs.texcoordLoc);
    gl.vertexAttribPointer(refs.texcoordLoc, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(refs.resolutionLoc, this.canvas.width, this.canvas.height);
    gl.uniform1f(refs.blurRadiusLoc, s.blurRadius);
    gl.uniform1f(refs.borderRadiusLoc, this.borderRadius);
    gl.uniform1f(refs.edgeIntensityLoc, s.edgeIntensity);
    gl.uniform1f(refs.rimIntensityLoc, s.rimIntensity);
    gl.uniform1f(refs.baseIntensityLoc, s.baseIntensity);
    gl.uniform1f(refs.edgeDistanceLoc, s.edgeDistance);
    gl.uniform1f(refs.rimDistanceLoc, s.rimDistance);
    gl.uniform1f(refs.baseDistanceLoc, s.baseDistance);
    gl.uniform1f(refs.cornerBoostLoc, s.cornerBoost);
    gl.uniform1f(refs.rippleEffectLoc, s.rippleEffect);
    gl.uniform1f(refs.tintOpacityLoc, s.tintOpacity);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, refs.texture);
    gl.uniform1i(refs.imageLoc, 0);
  }

  // Composite the static page layer and the live WebGL layer into the backing
  // canvas, then upload it as the shader texture. Everything is document-space
  // aligned, so sticky positioning works out naturally.
  compose() {
    if (!this.gl_refs?.gl) return;
    const bctx = this.backingContext;
    const w = this.backing.width, h = this.backing.height;
    const rect = this.element.getBoundingClientRect();
    bctx.clearRect(0, 0, w, h);

    const snapshot = DockGlass.staticPage;
    if (snapshot) {
      const pageX = Math.round(rect.left), pageY = Math.round(rect.top + (window.pageYOffset || 0));
      bctx.drawImage(snapshot, pageX, pageY, w, h, 0, 0, w, h);
    } else {
      bctx.fillStyle = '#f6f6f3';
      bctx.fillRect(0, 0, w, h);
    }

    const view = (DockGlass.viewCanvas ||= document.querySelector('#viewport canvas'));
    if (view) {
      const vr = view.getBoundingClientRect();
      if (vr.bottom > rect.top && vr.top < rect.bottom) {
        bctx.drawImage(view, vr.left - rect.left, vr.top - rect.top, vr.width, vr.height);
      }
    }

    const gl = this.gl_refs.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.gl_refs.texture);
    if (this.sizeDirty) {
      this.sizeDirty = false;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(this.gl_refs.resolutionLoc, w, h);
      gl.uniform1f(this.gl_refs.borderRadiusLoc, this.borderRadius);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.backing);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.backing);
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  createProgram(gl, vsSource, fsSource) {
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Liquid glass shader error:', gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Liquid glass program link error:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }
}

DockGlass.instances = [];
DockGlass.staticPage = null;
DockGlass.viewCanvas = null;
DockGlass.capturing = false;
DockGlass.recaptureQueued = false;

// Started after the Three.js render loop registers, so each compose sees the
// frame that was just drawn — zero perceptible lag.
export function startGlassLoop() {
  requestAnimationFrame(function frameLoop() {
    if (!document.hidden) {
      for (const glass of DockGlass.instances) glass.compose();
    }
    requestAnimationFrame(frameLoop);
  });
}

export function mountGlass(element, preset = 'dock') {
  const options = { settings: GLASS_PRESETS[preset] };
  if (preset === 'header') options.borderRadius = 16; // Slim bar gets rounded corners; the dock stays a capsule.
  const glass = new DockGlass(element, options);

  // Static layer only changes with layout/fonts — recapture on those events,
  // never on an interval.
  DockGlass.captureSnapshot();
  window.addEventListener('load', () => DockGlass.captureSnapshot());
  document.fonts?.ready.then(() => DockGlass.captureSnapshot());
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => DockGlass.captureSnapshot(), 300);
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) DockGlass.captureSnapshot();
  });
  return glass;
}
