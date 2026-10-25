/* halftone.js — vanilla-JS port of the HalftoneDots React component.
   Renders an image as an interactive halftone dot field on a <canvas>:
   staggered morph reveal, hover lens (with optional dot "parting"),
   click ripples, and a confetti dot-burst after 7 quick presses.
   Auto-inits every [data-halftone] element; config via data attributes:
     data-src        image url (same-origin; sampled to a dot lattice)
     data-from/to    optional hex pair -> forces a top-to-bottom dot gradient
     data-accent     hex for the corner registration marks (default electric)
     data-displace   "1" -> the lens pushes dots aside instead of only boosting
   Fixes vs the React source: entrance morph from a blank field on first
   reveal, dots are restored after a burst (one-shot -> recoverable),
   roundRect fallback, debounced resize, lazy load when near the viewport,
   zero-size render guard, no per-instance theme MutationObserver. */
(function () {
  "use strict";

  var MORPH = 200, MORPH_STAGGER = 220, MORPH_DIP = 0.5;
  var CELL = 6, SUP = 4, SPILL = 72;
  var DOT_FLOOR = 0.22, DOT_COVERAGE = 0.18, DOT_TONE = 0.52;
  var TONE_CONTRAST = 1.6, COLOR_CONTRAST = 1.25, PAPER_R = 0.3, PAPER_ALPHA = 0.28;
  var LATENT_FLOOR = 0.14, LATENT_COVERAGE = 0.1, LATENT_TONE = 0.26;
  var LATENT_ALPHA = 0.2, LATENT_BOOST = 0.45, LATENT_LIFT = 210;
  var MARK_INSET = 24, MARK_CLEAR = CELL * 2 + 6, MARK_R = 0.7;
  var FULL_FROM = 0.8, FULL_CORNER = 0.82, FULL_GROW = 1.05;
  var LENS_RADIUS = 64, LENS_BOOST = 0.55, LENS_FOLLOW = 55;
  var LENS_FADE_IN = 140, LENS_FADE_OUT = 220, LENS_WOBBLE = 0.22, LENS_DRIFT = 0.0011;
  var LENS_ATTACK = 60, LENS_RELEASE = 420;
  var LENS_PUSH = 4.5, SPRING_STIFFNESS = 1600, SPRING_DAMPING = 68, SPRING_STEP = 8;
  var RIPPLE_SPEED = 0.75, RIPPLE_WIDTH = 30, RIPPLE_PUSH = 5.8, RIPPLE_LIFE = 400;
  var BURST_PRESSES = 7, BURST_GAP = 500, BURST_MAX = 2600;
  var BURST_SPEED = 800, BURST_GRAVITY = 850, BURST_DRAG = 0.72;
  var BURST_BOUNCE = 0.34, BURST_FRICTION = 0.82, BURST_REST = 90;
  var SOLID = "[data-halftone-solid]";

  function hexRgb(hex) {
    var n = hex.replace("#", "");
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  }
  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function blank(n) {
    return {
      r: new Float32Array(n),
      rgb: new Float32Array(n * 3),
      alpha: new Float32Array(n),
      reveal: new Float32Array(n),
    };
  }

  /* ---- burst layer: one fixed full-viewport canvas on <body> (was createPortal) ---- */
  var burstSurface = null, burstRaf = 0;
  function mountBurst(dots, onDone) {
    if (burstSurface) {
      cancelAnimationFrame(burstRaf);
      burstSurface.remove();
      burstSurface = null;
    }
    var surface = document.createElement("canvas");
    surface.className = "hf-burst";
    surface.setAttribute("aria-hidden", "true");
    document.body.appendChild(surface);
    burstSurface = surface;
    var ctx = surface.getContext("2d");
    var ss = Math.min(2, window.devicePixelRatio || 1);
    var size = function () {
      surface.width = Math.round(window.innerWidth * ss);
      surface.height = Math.round(window.innerHeight * ss);
    };
    size();

    var flying = dots.map(function (dot) {
      var copy = {}; for (var k in dot) copy[k] = dot[k]; copy.life = 1; return copy;
    });
    var solids = [].slice.call(document.querySelectorAll(SOLID)).map(function (el) {
      return el.getBoundingClientRect();
    });
    var last = 0, gone = false;

    var frame = function (now) {
      if (gone) return;
      var dt = Math.min(64, last ? now - last : 16) / 1000;
      last = now;
      ctx.setTransform(ss, 0, 0, ss, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      var alive = 0;
      for (var j = 0; j < flying.length; j += 1) {
        var dot = flying[j];
        dot.vy += BURST_GRAVITY * dt;
        var drag = Math.pow(BURST_DRAG, dt);
        dot.vx *= drag; dot.vy *= drag;
        dot.x += dot.vx * dt; dot.y += dot.vy * dt;

        for (var b = 0; b < solids.length; b += 1) {
          var box = solids[b];
          if (dot.x < box.left - dot.r || dot.x > box.right + dot.r) continue;
          if (dot.vy <= 0 || dot.y < box.top || dot.y > box.bottom) continue;
          dot.y = box.top;
          dot.vy = -dot.vy * BURST_BOUNCE;
          dot.vx *= BURST_FRICTION;
          if (Math.abs(dot.vy) < BURST_REST) dot.vy = 0;
          dot.vx += (dot.x < (box.left + box.right) / 2 ? -1 : 1) * 40;
        }
        dot.life = Math.max(0, dot.life - dt * 0.26);
        if (dot.life <= 0) continue;
        var onScreen = dot.x > -40 && dot.x < window.innerWidth + 40 && dot.y < window.innerHeight + 40;
        if (!onScreen) continue;
        alive += 1;
        ctx.globalAlpha = dot.life;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r * (0.4 + dot.life * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = dot.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (alive === 0) {
        gone = true;
        window.removeEventListener("resize", size);
        surface.remove();
        if (burstSurface === surface) burstSurface = null;
        onDone();
        return;
      }
      burstRaf = requestAnimationFrame(frame);
    };
    window.addEventListener("resize", size);
    burstRaf = requestAnimationFrame(frame);
  }

  /* ---- one halftone instance per container ---- */
  function attach(box, opts) {
    var src = opts.src;
    var gradient = opts.gradient || null;
    var accent = opts.accent || "#0A5CFF";
    var displace = !!opts.displace;

    var surface = document.createElement("canvas");
    surface.className = "hf-canvas";
    surface.setAttribute("aria-hidden", "true");
    surface.style.cssText =
      "position:absolute;pointer-events:none;inset:" + -SPILL + "px;" +
      "width:calc(100% + " + SPILL * 2 + "px);height:calc(100% + " + SPILL * 2 + "px)";
    box.appendChild(surface);

    var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var hoverable = window.matchMedia("(hover: hover) and (pointer: fine)").matches && !still;

    var lattice = null;
    var lens = { x: 0, y: 0, tx: 0, ty: 0, strength: 0, target: 0 };
    var swells = new Float32Array(0);
    var springs = { ox: new Float32Array(0), oy: new Float32Array(0), vx: new Float32Array(0), vy: new Float32Array(0) };
    var ripples = [];
    var ink = { text: [], key: new Int32Array(0) };
    var exploded = false;
    var presses = [];
    var raf = 0, running = false, last = 0, gone = false;
    var firstReveal = true;
    var image = null, scene = null;
    var crop = { sx: 0, sy: 0, sw: 1, sh: 1 };
    var pushX = 0, pushY = 0;

    function paperRgb() {
      var probe = document.createElement("canvas");
      probe.width = 1; probe.height = 1;
      var pctx = probe.getContext("2d", { willReadFrequently: true });
      if (!pctx) return [128, 128, 128];
      pctx.fillStyle = getComputedStyle(box).color;
      pctx.fillRect(0, 0, 1, 1);
      var d = pctx.getImageData(0, 0, 1, 1).data;
      return [d[0] || 0, d[1] || 0, d[2] || 0];
    }

    /* canvas must stay untainted for pixel sampling; file:// and CORS-less
       hosts taint it — probe once and fall back to the gradient plate */
    function probeTaint(img) {
      try {
        var probe = document.createElement("canvas");
        probe.width = 2; probe.height = 2;
        var pctx = probe.getContext("2d");
        pctx.drawImage(img, 0, 0, 2, 2);
        pctx.getImageData(0, 0, 1, 1);
        return false;
      } catch (e) {
        return true;
      }
    }

    function sample(img) {
      var boxW = box.clientWidth, boxH = box.clientHeight;
      if (!boxW || !boxH) return null;
      var width = boxW + SPILL * 2, height = boxH + SPILL * 2;
      var cols = Math.max(1, Math.round(width / CELL));
      var rows = Math.max(1, Math.round(height / CELL));
      var cw = width / cols, ch = height / rows;
      var maxR = Math.min(cw, ch) / 2;
      var n = cols * rows;

      var frameX = SPILL - MARK_INSET + MARK_CLEAR;
      var frameY = SPILL - MARK_INSET + MARK_CLEAR;
      var frameW = boxW + MARK_INSET * 2 - MARK_CLEAR * 2;
      var frameH = boxH + MARK_INSET * 2 - MARK_CLEAR * 2;
      var fadeX = SPILL - MARK_INSET, fadeY = SPILL - MARK_INSET;
      var fadeW = boxW + MARK_INSET * 2, fadeH = boxH + MARK_INSET * 2;
      var fadeReach = SPILL - MARK_INSET;

      var bw = cols * SUP, bh = rows * SUP;
      var px = bw / width;
      var sx = crop.sx, sy = crop.sy, sw = crop.sw, sh = crop.sh;
      var fit = Math.min((frameW * px) / sw, (frameH * px) / sh);
      var dw = sw * fit, dh = sh * fit;
      var dx0 = (frameX + frameW / 2) * px - dw / 2;
      var dy0 = (frameY + frameH) * px - dh;

      var sampler = document.createElement("canvas");
      sampler.width = bw; sampler.height = bh;
      var sctx = sampler.getContext("2d", { willReadFrequently: true });
      if (!sctx) return null;
      sctx.drawImage(img, sx, sy, sw, sh, dx0, dy0, dw, dh);
      var data = sctx.getImageData(0, 0, bw, bh).data;

      var behind = null;
      if (scene) {
        var b2 = document.createElement("canvas");
        b2.width = bw; b2.height = bh;
        var bctx = b2.getContext("2d", { willReadFrequently: true });
        if (bctx) {
          bctx.beginPath();
          bctx.rect(frameX * px, frameY * px, frameW * px, frameH * px);
          bctx.clip();
          bctx.drawImage(scene, dx0 - sx * fit, dy0 - sy * fit, scene.width * fit, scene.height * fit);
          behind = bctx.getImageData(0, 0, bw, bh).data;
        }
      }

      var paper = paperRgb();
      var darkPaper = (0.299 * paper[0] + 0.587 * paper[1] + 0.114 * paper[2]) / 255 > 0.5;
      var inkC = hexRgb(accent);
      var top = gradient ? hexRgb(gradient[0]) : null;
      var bottom = gradient ? hexRgb(gradient[1]) : null;
      var rowTop = frameY / ch, rowSpan = frameH / ch;

      var x = new Float32Array(n), y = new Float32Array(n), w = new Float32Array(n);
      var field = blank(n);
      var coverage = new Float32Array(n), lum = new Float32Array(n);
      var darkest = 1, lightest = 0;
      var latent = new Uint8Array(n);
      var sceneDarkest = 1, sceneLightest = 0;
      var cx = width / 2, cy = height / 2;
      var reachOut = Math.hypot(frameW / 2, frameH / 2) || 1;

      for (var yy = 0; yy < rows; yy += 1) {
        for (var xx = 0; xx < cols; xx += 1) {
          var i = yy * cols + xx;
          x[i] = (xx + 0.5) * cw;
          y[i] = (yy + 0.5) * ch;
          w[i] = Math.min(1, Math.hypot(x[i] - cx, y[i] - cy) / reachOut);
          var cr = 0, cg = 0, cb = 0, inked = 0;
          var read = function (pixels) {
            for (var sy2 = 0; sy2 < SUP; sy2 += 1) {
              for (var sx2 = 0; sx2 < SUP; sx2 += 1) {
                var k = ((yy * SUP + sy2) * bw + (xx * SUP + sx2)) * 4;
                if (pixels[k + 3] < 24) continue;
                var r0 = pixels[k], g0 = pixels[k + 1], b0 = pixels[k + 2];
                if ((0.299 * r0 + 0.587 * g0 + 0.114 * b0) / 255 > 0.92) continue;
                cr += r0; cg += g0; cb += b0; inked += 1;
              }
            }
          };
          var color = function () {
            if (top && bottom) {
              var t = Math.min(1, Math.max(0, (yy - rowTop) / (rowSpan || 1)));
              field.rgb[i * 3] = top[0] + (bottom[0] - top[0]) * t;
              field.rgb[i * 3 + 1] = top[1] + (bottom[1] - top[1]) * t;
              field.rgb[i * 3 + 2] = top[2] + (bottom[2] - top[2]) * t;
            } else {
              field.rgb[i * 3] = cr / inked;
              field.rgb[i * 3 + 1] = cg / inked;
              field.rgb[i * 3 + 2] = cb / inked;
            }
          };
          read(data);
          if (inked === 0 && behind) {
            read(behind);
            if (inked > 0) {
              latent[i] = 1;
              coverage[i] = inked / (SUP * SUP);
              lum[i] = (0.299 * cr + 0.587 * cg + 0.114 * cb) / inked / 255;
              if (lum[i] < sceneDarkest) sceneDarkest = lum[i];
              if (lum[i] > sceneLightest) sceneLightest = lum[i];
              field.alpha[i] = LATENT_ALPHA;
              field.reveal[i] = 1 - LATENT_ALPHA;
              color();
              if (!top || !bottom) {
                var peak = Math.max(field.rgb[i * 3], field.rgb[i * 3 + 1], field.rgb[i * 3 + 2]);
                if (peak > 0 && peak < LATENT_LIFT) {
                  var lift = LATENT_LIFT / peak;
                  field.rgb[i * 3] *= lift; field.rgb[i * 3 + 1] *= lift; field.rgb[i * 3 + 2] *= lift;
                }
              }
              continue;
            }
          }
          if (inked === 0) {
            var dx = Math.max(fadeX - x[i], 0, x[i] - (fadeX + fadeW));
            var dy = Math.max(fadeY - y[i], 0, y[i] - (fadeY + fadeH));
            var out = Math.hypot(dx, dy) / fadeReach;
            var fade = out >= 1 ? 0 : (1 - out) * (1 - out);
            field.r[i] = fade > 0 ? maxR * PAPER_R : 0;
            field.alpha[i] = PAPER_ALPHA * fade;
            field.rgb[i * 3] = paper[0];
            field.rgb[i * 3 + 1] = paper[1];
            field.rgb[i * 3 + 2] = paper[2];
            continue;
          }
          coverage[i] = inked / (SUP * SUP);
          lum[i] = (0.299 * cr + 0.587 * cg + 0.114 * cb) / inked / 255;
          if (lum[i] < darkest) darkest = lum[i];
          if (lum[i] > lightest) lightest = lum[i];
          field.alpha[i] = 1;
          color();
        }
      }

      var range = lightest - darkest || 1;
      var count = 0, mean = [0, 0, 0];
      for (var m = 0; m < n; m += 1) {
        if (field.alpha[m] !== 1) continue;
        count += 1;
        mean[0] += field.rgb[m * 3]; mean[1] += field.rgb[m * 3 + 1]; mean[2] += field.rgb[m * 3 + 2];
      }
      for (var mk = 0; mk < 3; mk += 1) mean[mk] /= count || 1;
      var spread = function (t) {
        var c = t - 0.5;
        return Math.min(1, Math.max(0, 0.5 + Math.sign(c) * Math.pow(Math.abs(c) * 2, 1 / TONE_CONTRAST) * 0.5));
      };
      var sceneRange = sceneLightest - sceneDarkest || 1;
      for (var q = 0; q < n; q += 1) {
        if (latent[q]) {
          var toneL = spread((darkPaper ? lum[q] - sceneDarkest : sceneLightest - lum[q]) / sceneRange);
          field.r[q] = maxR * (LATENT_FLOOR + coverage[q] * LATENT_COVERAGE + toneL * LATENT_TONE);
          continue;
        }
        if (field.alpha[q] !== 1) continue;
        var tone = spread((lightest - lum[q]) / range);
        field.r[q] = maxR * Math.min(0.92, DOT_FLOOR + coverage[q] * DOT_COVERAGE + tone * DOT_TONE);
        if (!top || !bottom) {
          for (var ck = 0; ck < 3; ck += 1) {
            var v = mean[ck] + (field.rgb[q * 3 + ck] - mean[ck]) * COLOR_CONTRAST;
            field.rgb[q * 3 + ck] = Math.min(255, Math.max(0, v));
          }
        }
      }

      var setMark = function (col, row) {
        if (col < 0 || row < 0 || col >= cols || row >= rows) return;
        var mi = row * cols + col;
        field.r[mi] = maxR * MARK_R;
        field.alpha[mi] = 1;
        field.rgb[mi * 3] = inkC[0]; field.rgb[mi * 3 + 1] = inkC[1]; field.rgb[mi * 3 + 2] = inkC[2];
      };
      var colA = Math.round(fadeX / cw), colB = Math.round((fadeX + fadeW) / cw) - 1;
      var rowA = Math.round(fadeY / ch), rowB = Math.round((fadeY + fadeH) / ch) - 1;
      var marks = [[colA, rowA, 1, 1], [colB, rowA, -1, 1], [colA, rowB, 1, -1], [colB, rowB, -1, -1]];
      for (var mm = 0; mm < marks.length; mm += 1) {
        setMark(marks[mm][0] + marks[mm][2], marks[mm][1]);
        setMark(marks[mm][0], marks[mm][1] + marks[mm][3]);
        setMark(marks[mm][0] + marks[mm][2], marks[mm][1] + marks[mm][3]);
      }

      return { cols: cols, rows: rows, x: x, y: y, w: w, maxR: maxR, width: width, height: height, field: field };
    }

    function render(animate) {
      var ctx = surface.getContext("2d");
      if (!image || !ctx || gone) return;
      var laid = sample(image);
      if (!laid) return;
      var cols = laid.cols, rows = laid.rows, x = laid.x, y = laid.y, w = laid.w;
      var maxR = laid.maxR, width = laid.width, height = laid.height, field = laid.field;
      var n = cols * rows;

      var ss = Math.min(3, (window.devicePixelRatio || 1) * 1.5);
      surface.width = Math.round(width * ss);
      surface.height = Math.round(height * ss);
      ctx.setTransform(ss, 0, 0, ss, 0, 0);

      var previous = lattice;
      var sameGrid = previous !== null && previous.cols === cols && previous.rows === rows;
      var carried = !animate && sameGrid && previous !== null && !previous.settled;
      var morph = (animate || carried) && !still && sameGrid;
      var origin = !morph || !previous ? field : carried ? previous.from : previous.now;
      if (animate && !sameGrid && firstReveal && !still) {
        /* entrance fix: first reveal morphs in from a blank field (React source
           rendered static on first paint because sameGrid was false) */
        morph = true;
        origin = null;
      }
      var from = blank(n);
      if (origin) {
        from.r.set(origin.r); from.rgb.set(origin.rgb);
        from.alpha.set(origin.alpha); from.reveal.set(origin.reveal);
      }
      var now = blank(n);
      now.r.set(from.r); now.rgb.set(from.rgb);
      now.alpha.set(from.alpha); now.reveal.set(from.reveal);

      lattice = {
        cols: cols, rows: rows, x: x, y: y, w: w, maxR: maxR, width: width, height: height,
        now: now, from: from, to: field,
        started: carried && previous ? previous.started : performance.now(),
        settled: !morph,
      };
      if (!sameGrid) {
        swells = new Float32Array(n);
        springs = {
          ox: new Float32Array(n), oy: new Float32Array(n),
          vx: new Float32Array(n), vy: new Float32Array(n),
        };
      }
      firstReveal = false;
      ensureLoop();
    }

    function reach(angle, now) {
      return LENS_RADIUS *
        (1 + LENS_WOBBLE *
          (0.5 * Math.sin(3 * angle + now * LENS_DRIFT) +
            0.32 * Math.sin(5 * angle - now * LENS_DRIFT * 1.7) +
            0.18 * Math.sin(2 * angle + now * LENS_DRIFT * 0.6)));
    }
    function ask(pxX, pyY, now) {
      pushX = 0; pushY = 0;
      var l = lens;
      if (l.strength <= 0.001) return 0;
      var dx = pxX - l.x, dy = pyY - l.y;
      var dist = Math.hypot(dx, dy);
      if (dist >= LENS_RADIUS * (1 + LENS_WOBBLE)) return 0;
      var d = dist / reach(Math.atan2(dy, dx), now);
      if (d >= 1) return 0;
      var falloff = (1 - d * d) * (1 - d * d);
      if (displace) {
        var shove = (l.strength * LENS_PUSH * 6.75 * d * (1 - d) * (1 - d)) / (dist || 1);
        pushX = dx * shove; pushY = dy * shove;
      }
      return l.strength * falloff;
    }

    function frame(now) {
      var ctx = surface.getContext("2d");
      var lat = lattice;
      if (!ctx || !lat || gone) return;
      if (exploded) {
        ctx.clearRect(0, 0, lat.width, lat.height);
        running = false; last = 0;
        return;
      }
      var dt = last ? Math.min(64, now - last) : 16;
      last = now;

      var l = lens;
      var follow = 1 - Math.exp(-dt / LENS_FOLLOW);
      l.x += (l.tx - l.x) * follow;
      l.y += (l.ty - l.y) * follow;
      var fade = 1 - Math.exp(-dt / (l.target > l.strength ? LENS_FADE_IN : LENS_FADE_OUT));
      l.strength += (l.target - l.strength) * fade;
      if (Math.abs(l.target - l.strength) < 0.002) l.strength = l.target;
      var up = 1 - Math.exp(-dt / LENS_ATTACK);
      var down = 1 - Math.exp(-dt / LENS_RELEASE);
      var held = swells;
      var ox = springs.ox, oy = springs.oy, vx = springs.vx, vy = springs.vy;

      var pieces = Math.max(1, Math.ceil(dt / SPRING_STEP));
      var step = dt / pieces / 1000;
      var residue = 0;

      var rings = ripples;
      for (var k = rings.length - 1; k >= 0; k -= 1) {
        if (now - rings[k].at > RIPPLE_LIFE * 2.5) rings.splice(k, 1);
      }
      var ringR = rings.map(function (ring) { return (now - ring.at) * RIPPLE_SPEED; });
      var ringAmp = rings.map(function (ring) { return Math.exp(-(now - ring.at) / RIPPLE_LIFE); });

      var el = now - lat.started;
      var settled = true;
      var x = lat.x, y = lat.y, w = lat.w, maxR = lat.maxR;
      var cur = lat.now, from = lat.from, to = lat.to;

      ctx.clearRect(0, 0, lat.width, lat.height);

      if (ink.key.length !== x.length) {
        ink = {
          text: new Array(x.length).fill(""),
          key: new Int32Array(x.length),
        };
      }
      var inkText = ink.text, inkKey = ink.key;

      for (var i = 0; i < x.length; i += 1) {
        if (!lat.settled) {
          var t = Math.min(1, Math.max(0, (el - w[i] * MORPH_STAGGER) / MORPH));
          if (t < 1) settled = false;
          var e = easeInOut(t);
          var dip = 1 - MORPH_DIP * Math.sin(Math.PI * t);
          cur.r[i] = (from.r[i] + (to.r[i] - from.r[i]) * e) * dip;
          cur.alpha[i] = from.alpha[i] + (to.alpha[i] - from.alpha[i]) * e;
          cur.reveal[i] = from.reveal[i] + (to.reveal[i] - from.reveal[i]) * e;
          cur.rgb[i * 3] = from.rgb[i * 3] + (to.rgb[i * 3] - from.rgb[i * 3]) * e;
          cur.rgb[i * 3 + 1] = from.rgb[i * 3 + 1] + (to.rgb[i * 3 + 1] - from.rgb[i * 3 + 1]) * e;
          cur.rgb[i * 3 + 2] = from.rgb[i * 3 + 2] + (to.rgb[i * 3 + 2] - from.rgb[i * 3 + 2]) * e;
        }
        var want = ask(x[i], y[i], now);

        var ring = 0;
        for (var rk = 0; rk < rings.length; rk += 1) {
          var rdx = x[i] - rings[rk].x, rdy = y[i] - rings[rk].y;
          var dist = Math.hypot(rdx, rdy);
          var u = (dist - ringR[rk]) / RIPPLE_WIDTH;
          if (u < -2.5 || u > 2.5) continue;
          var bell = Math.exp(-u * u) * ringAmp[rk];
          if (bell > ring) ring = bell;
          var shove = (RIPPLE_PUSH * bell) / (dist || 1);
          pushX += rdx * shove; pushY += rdy * shove;
        }
        var have = held[i];
        var next = have + (want - have) * (want > have ? up : down);
        held[i] = next < 0.002 && want === 0 ? 0 : next;
        if (held[i] > residue) residue = held[i];
        for (var p = 0; p < pieces; p += 1) {
          vx[i] = vx[i] + (SPRING_STIFFNESS * (pushX - ox[i]) - SPRING_DAMPING * vx[i]) * step;
          vy[i] = vy[i] + (SPRING_STIFFNESS * (pushY - oy[i]) - SPRING_DAMPING * vy[i]) * step;
          ox[i] = ox[i] + vx[i] * step;
          oy[i] = oy[i] + vy[i] * step;
        }
        var moving = Math.abs(ox[i]) + Math.abs(oy[i]) + Math.abs(vx[i]) + Math.abs(vy[i]);
        if (moving < 0.02 && pushX === 0 && pushY === 0) {
          ox[i] = 0; oy[i] = 0; vx[i] = 0; vy[i] = 0;
        } else if (moving > residue) {
          residue = moving;
        }
        var liftV = Math.max(held[i], ring);

        var boost = cur.reveal[i] > 0 ? LENS_BOOST * LATENT_BOOST : LENS_BOOST;
        var r = Math.min(maxR * FULL_GROW, cur.r[i] * (1 + boost * liftV));
        var a = cur.alpha[i] + cur.reveal[i] * liftV;
        if (r <= 0.06 || a <= 0.004) continue;
        ctx.globalAlpha = a;

        var rr = Math.round(cur.rgb[i * 3]);
        var gg = Math.round(cur.rgb[i * 3 + 1]);
        var bb = Math.round(cur.rgb[i * 3 + 2]);
        var key = (rr << 16) | (gg << 8) | bb;
        if (inkKey[i] !== key || inkText[i] === "") {
          inkKey[i] = key;
          inkText[i] = "rgb(" + rr + " " + gg + " " + bb + ")";
        }
        ctx.fillStyle = inkText[i];
        ctx.beginPath();

        var cx = x[i] + ox[i], cy2 = y[i] + oy[i];
        var full = Math.min(1, Math.max(0, (r / maxR - FULL_FROM) / (1 - FULL_FROM)));
        if (full > 0 && ctx.roundRect) {
          var corner = r * (1 - (1 - FULL_CORNER) * full);
          ctx.roundRect(cx - r, cy2 - r, r * 2, r * 2, corner);
        } else {
          ctx.arc(cx, cy2, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (settled) lat.settled = true;

      if (!lat.settled || l.strength > 0 || residue > 0 || rings.length > 0) {
        raf = requestAnimationFrame(frame);
      } else {
        running = false;
        last = 0;
      }
    }

    function ensureLoop() {
      if (running) return;
      running = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }

    function aim(event) {
      var lat = lattice;
      if (!lat) return;
      var rect = surface.getBoundingClientRect();
      var px = ((event.clientX - rect.left) / rect.width) * lat.width;
      var py = ((event.clientY - rect.top) / rect.height) * lat.height;
      if (lens.target === 0) { lens.x = px; lens.y = py; }
      lens.tx = px; lens.ty = py;
      lens.target = 1;
      ensureLoop();
    }
    function leave() {
      lens.target = 0;
      ensureLoop();
    }
    function drop(event) {
      var lat = lattice;
      if (!lat) return;

      if (!still && !exploded) {
        var at = performance.now();
        var previous = presses.length ? presses[presses.length - 1] : 0;
        presses = at - previous < BURST_GAP ? presses.concat([at]) : [at];
        if (presses.length >= BURST_PRESSES) {
          var dots = scatterFrom(lat, surface.getBoundingClientRect(), event);
          if (dots.length > 0) {
            exploded = true;
            ensureLoop();
            mountBurst(dots, function () {
              /* fix: recover after the burst instead of staying empty */
              exploded = false;
              render(false);
            });
            try { window.dispatchEvent(new CustomEvent("halftone:burst", { bubbles: true })); } catch (e) { /* older browsers */ }
            return;
          }
        }
      }

      if (still) return;
      var rect = surface.getBoundingClientRect();
      ripples.push({
        x: ((event.clientX - rect.left) / rect.width) * lat.width,
        y: ((event.clientY - rect.top) / rect.height) * lat.height,
        at: performance.now(),
      });
      ensureLoop();
    }

    function scatterFrom(lat, rect, from2) {
      var scale = rect.width / lat.width;
      var dots = [];
      var stride = Math.max(1, Math.ceil(lat.x.length / (BURST_MAX * 2)));
      for (var i = 0; i < lat.x.length; i += stride) {
        var alpha = lat.now.alpha[i];
        if (lat.now.r[i] <= 0.06 || alpha <= 0.004) continue;
        var r = lat.now.r[i] * scale;
        var x = rect.left + lat.x[i] * scale;
        var y = rect.top + lat.y[i] * scale;
        var dx = x - from2.clientX, dy = y - from2.clientY;
        var reach2 = Math.max(40, Math.hypot(rect.width, rect.height) / 2);
        var near = Math.max(0.55, 1 - Math.hypot(dx, dy) / reach2);
        var angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 2;
        var speed = BURST_SPEED * near * (0.35 + Math.random() * 1.1);
        dots.push({
          x: x, y: y, r: r,
          color: "rgb(" + Math.round(lat.now.rgb[i * 3]) + " " + Math.round(lat.now.rgb[i * 3 + 1]) + " " +
            Math.round(lat.now.rgb[i * 3 + 2]) + " / " + alpha.toFixed(2) + ")",
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 200 * near,
          spin: 0,
        });
      }
      return dots;
    }

    function measure(img) {
      var scale = Math.min(1, 256 / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var probe = document.createElement("canvas");
      probe.width = w; probe.height = h;
      var pctx = probe.getContext("2d", { willReadFrequently: true });
      if (!pctx) return { sx: 0, sy: 0, sw: img.width, sh: img.height };
      pctx.drawImage(img, 0, 0, w, h);
      var data = pctx.getImageData(0, 0, w, h).data;
      var left = w, right = -1, top = h, bottom = -1;
      for (var yy = 0; yy < h; yy += 1) {
        for (var xx = 0; xx < w; xx += 1) {
          var i = (yy * w + xx) * 4;
          if (data[i + 3] < 24) continue;
          if ((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255 > 0.92) continue;
          if (xx < left) left = xx;
          if (xx > right) right = xx;
          if (yy < top) top = yy;
          if (yy > bottom) bottom = yy;
        }
      }
      if (right < left) return { sx: 0, sy: 0, sw: img.width, sh: img.height };
      return {
        sx: left / scale, sy: top / scale,
        sw: (right - left + 1) / scale, sh: (bottom - top + 1) / scale,
      };
    }

    function load() {
      var img = new Image();
      /* crossOrigin only for http(s): on file:// it blocks the load outright,
         and same-origin sampling never needs it */
      if (location.protocol !== "file:") img.crossOrigin = "anonymous";
      img.onload = function () {
        if (probeTaint(img)) {
          box.classList.add("halftone-failed");
          return;
        }
        image = img;
        crop = measure(img);
        render(true);
      };
      img.onerror = function () {
        box.classList.add("halftone-failed");
      };
      img.src = src;
    }

    /* lazy: load + first render only when the card approaches the viewport */
    if ("IntersectionObserver" in window) {
      var vio = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i += 1) {
          if (entries[i].isIntersecting) {
            vio.disconnect();
            load();
            break;
          }
        }
      }, { rootMargin: "480px 0px" });
      vio.observe(box);
    } else {
      load();
    }

    var roTimer = 0;
    var watcher = new ResizeObserver(function () {
      clearTimeout(roTimer);
      roTimer = setTimeout(function () {
        if (lattice && !gone && box.clientWidth && box.clientHeight) render(false);
      }, 160);
    });
    watcher.observe(box);

    box.addEventListener("pointerdown", drop);
    if (hoverable) {
      box.addEventListener("pointermove", aim);
      box.addEventListener("pointerleave", leave);
    }

    return function dispose() {
      gone = true;
      cancelAnimationFrame(raf);
      clearTimeout(roTimer);
      watcher.disconnect();
      box.removeEventListener("pointerdown", drop);
      if (hoverable) {
        box.removeEventListener("pointermove", aim);
        box.removeEventListener("pointerleave", leave);
      }
      surface.remove();
    };
  }

  function initAll(root) {
    var nodes = root.querySelectorAll("[data-halftone]");
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (el.__halftone) continue;
      var from = el.getAttribute("data-from");
      var to = el.getAttribute("data-to");
      el.__halftone = attach(el, {
        src: el.getAttribute("data-src"),
        gradient: from && to ? [from, to] : null,
        accent: el.getAttribute("data-accent") || "#0A5CFF",
        displace: el.getAttribute("data-displace") === "1",
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { initAll(document); });
  } else {
    initAll(document);
  }

  window.HalftoneDots = { attach: attach, initAll: initAll };
})();
