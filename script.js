(() => {
  "use strict";

  const FRAME_COUNT = 238;
  const framePath = (i) => `frames/${String(i + 1).padStart(3, "0")}.webp`;
  const LERP = 0.1; // lower = silkier/laggier, higher = snappier

  // Two chapters from one clip: wide shot, a held pause, then the close-up.
  const SPLIT = 59;                         // last frame of chapter I (0-based)
  const CH1_END = 0.34, CH2_START = 0.46;   // scroll progress where the pause sits
  function frameAt(p) {
    if (p <= CH1_END) return (p / CH1_END) * SPLIT;
    if (p < CH2_START) return SPLIT;
    return SPLIT + ((p - CH2_START) / (1 - CH2_START)) * (FRAME_COUNT - 1 - SPLIT);
  }
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  document.body.classList.add("is-loading");
  $("#year").textContent = new Date().getFullYear();

  /* ===================== Frame preloading ===================== */
  const images = new Array(FRAME_COUNT);
  const loaded = new Uint8Array(FRAME_COUNT);

  // Load order: first frame, then coarse keyframes, then progressively finer.
  // Scrubbing works almost immediately; detail fills in behind it.
  const order = [];
  const seen = new Set();
  for (const step of [32, 16, 8, 4, 2, 1]) {
    for (let i = 0; i < FRAME_COUNT; i += step) {
      if (!seen.has(i)) { seen.add(i); order.push(i); }
    }
  }
  if (!seen.has(FRAME_COUNT - 1)) order.splice(1, 0, FRAME_COUNT - 1);

  const GATE = order.filter((i) => i % 8 === 0).length + 1; // coarse keyframes needed before reveal
  let loadedCount = 0;
  let revealed = false;

  const loaderBar = $("#loaderBar");
  const loaderPct = $("#loaderPct");

  function onFrameLoaded(i) {
    loaded[i] = 1;
    loadedCount++;
    if (!revealed) {
      const pct = Math.round(clamp(loadedCount / GATE) * 100);
      loaderBar.style.width = pct + "%";
      loaderPct.textContent = pct + "%";
      if (loadedCount >= GATE) reveal();
    }
    if (i === 0 || Math.abs(i - Math.round(state.frame)) < 3) needsDraw = true;
  }

  function reveal() {
    revealed = true;
    $("#loader").classList.add("is-done");
    document.body.classList.remove("is-loading");
    needsDraw = true;
  }

  // Concurrency-limited queue so the browser isn't flooded with 238 requests.
  let cursor = 0;
  const CONCURRENCY = 6;
  function next() {
    if (cursor >= order.length) return;
    const i = order[cursor++];
    const img = new Image();
    img.decoding = "async";
    img.src = framePath(i);
    images[i] = img;
    const done = () => { onFrameLoaded(i); next(); };
    (img.decode ? img.decode() : Promise.reject()).then(done, () => {
      if (img.complete && img.naturalWidth) done();
      else { img.onload = done; img.onerror = () => next(); }
    });
  }
  for (let k = 0; k < CONCURRENCY; k++) next();
  setTimeout(() => !revealed && reveal(), 8000); // never trap users behind the loader

  /* ===================== Canvas ===================== */
  const canvas = $("#seqCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  let cw = 0, ch = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = canvas.clientWidth;
    ch = canvas.clientHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = "high";
    needsDraw = true;
  }

  function nearestLoaded(i) {
    if (loaded[i]) return i;
    for (let d = 1; d < FRAME_COUNT; d++) {
      if (i - d >= 0 && loaded[i - d]) return i - d;
      if (i + d < FRAME_COUNT && loaded[i + d]) return i + d;
    }
    return -1;
  }

  let lastDrawn = -1;
  function drawFrame(idx) {
    const i = nearestLoaded(idx);
    if (i < 0) return;
    if (i === lastDrawn && !forceDraw) return;
    const img = images[i];
    const iw = img.naturalWidth, ih = img.naturalHeight;
    // object-fit: cover, focal point slightly right of centre on narrow screens (where the cup sits)
    const scale = Math.max(cw / iw, ch / ih);
    const w = iw * scale, h = ih * scale;
    const focusX = cw < ch ? 0.52 : 0.5;
    const x = (cw - w) * focusX;
    const y = (ch - h) / 2;
    ctx.drawImage(img, x, y, w, h);
    lastDrawn = i;
    forceDraw = false;
  }

  /* ===================== Scroll state ===================== */
  const seq = $("#sequence");
  const beats = $$(".beat");
  const hint = $("#scrollHint");
  const progressBar = $("#progressBar");
  const dip = $("#seqDip");
  const chapterEl = $("#chapter");
  const chapterNum = $("#chapterNum");
  const chapterName = $("#chapterName");
  const chapterBar = $("#chapterBar");
  let currentChapter = 0;

  const state = { target: 0, progress: 0, frame: 0 };
  let needsDraw = true;
  let forceDraw = false;

  function seqProgress() {
    const r = seq.getBoundingClientRect();
    const total = r.height - innerHeight;
    return clamp(-r.top / total);
  }

  function updateBeats(p) {
    for (const b of beats) {
      const s = +b.dataset.start, e = +b.dataset.end;
      const span = e - s;
      const t = (p - s) / span;
      let o = 0, y = 0;
      if (t >= 0 && t < 1) {
        const fadeIn = s <= 0 ? 1 : clamp(t / 0.22);
        const fadeOut = e > 1 ? 1 : clamp((1 - t) / 0.22);
        o = ease(Math.min(fadeIn, fadeOut));
        y = t < 0.5 ? (1 - ease(fadeIn)) * 40 : -(1 - ease(fadeOut)) * 40;
      } else if (t >= 1 && e > 1) { o = 1; }
      b.style.setProperty("--o", o.toFixed(3));
      b.style.setProperty("--y", y.toFixed(1) + "px");
      b.style.setProperty("--blur", ((1 - o) * 8).toFixed(1) + "px");
      b.classList.toggle("is-active", o > 0.5);
    }
    hint.style.opacity = String(clamp(1 - p * 12));

    // chapter pause: dim the frozen frame, peak in the middle of the pause
    const mid = (CH1_END + CH2_START) / 2, half = (CH2_START - CH1_END) / 2 + 0.03;
    const dipT = clamp(1 - Math.abs(p - mid) / half);
    dip.style.opacity = (ease(dipT) * 0.72).toFixed(3);

    // chapter indicator
    const ch = p < mid ? 0 : 1;
    if (ch !== currentChapter) {
      currentChapter = ch;
      chapterNum.textContent = ch ? "II" : "I";
      chapterName.textContent = ch ? "Up close" : "The wall";
      chapterEl.classList.remove("swap"); void chapterEl.offsetWidth; chapterEl.classList.add("swap");
    }
    chapterBar.style.transform = `scaleX(${ch ? clamp((p - CH2_START) / (1 - CH2_START)) : clamp(p / CH1_END)})`;
  }

  /* ===================== Secondary effects ===================== */
  // Word-by-word scroll highlight
  const split = $("[data-split]");
  if (split) {
    split.innerHTML = split.textContent.trim().split(/\s+/)
      .map((w) => `<span class="word">${w}</span>`).join(" ");
  }
  const words = split ? $$(".word", split) : [];

  // Reveal on enter
  $$(".reveal").forEach((el) => {
    const sibs = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
    el.style.setProperty("--d", sibs.indexOf(el) * 0.12 + "s");
  });
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("in");
      const num = en.target.querySelector("[data-count]");
      if (num) countUp(num);
      io.unobserve(en.target);
    });
  }, { threshold: 0.18, rootMargin: "0px 0px -8% 0px" });
  $$(".reveal").forEach((el) => io.observe(el));

  function countUp(el) {
    const to = +el.dataset.count, dur = 1600, t0 = performance.now();
    const tick = (now) => {
      const t = clamp((now - t0) / dur);
      el.textContent = Math.round(to * ease(t));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Parallax elements
  const parallax = $$(".parallax");

  // Velocity-reactive marquee
  const marquee = $("#marquee");
  let mX = 0, lastY = scrollY, vel = 0;

  // Card tilt
  if (!reduceMotion && matchMedia("(hover: hover)").matches) {
    $$("[data-tilt]").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(900px) rotateY(${px * 8}deg) rotateX(${-py * 8}deg) translateY(-6px)`;
      });
      card.addEventListener("pointerleave", () => (card.style.transform = ""));
    });
  }

  /* ===================== Main loop ===================== */
  function loop() {
    state.target = seqProgress();
    const k = reduceMotion ? 1 : LERP;
    state.progress = lerp(state.progress, state.target, k);
    if (Math.abs(state.progress - state.target) < 0.0001) state.progress = state.target;

    const f = frameAt(state.progress);
    if (Math.round(f) !== Math.round(state.frame) || needsDraw) {
      state.frame = f;
      if (needsDraw) forceDraw = true;
      drawFrame(Math.round(f));
      needsDraw = false;
    }
    state.frame = f;
    updateBeats(state.progress);

    // global progress bar
    const docH = document.documentElement.scrollHeight - innerHeight;
    progressBar.style.transform = `scaleX(${clamp(scrollY / docH)})`;

    // word highlight
    if (words.length) {
      const r = split.getBoundingClientRect();
      const wp = clamp((innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.4));
      const lit = Math.floor(wp * words.length);
      for (let i = 0; i < words.length; i++) words[i].classList.toggle("on", i < lit || reduceMotion);
    }

    if (!reduceMotion) {
      // parallax
      for (const el of parallax) {
        const r = el.parentElement.getBoundingClientRect();
        if (r.bottom < -200 || r.top > innerHeight + 200) continue;
        const c = r.top + r.height / 2 - innerHeight / 2;
        const sp = +el.dataset.speed || 0.1;
        el.style.transform = `translate3d(0, ${(-c * sp).toFixed(1)}px, 0) scale(${el.classList.contains("card__img") ? 1.18 : 1})`;
      }
      // marquee
      const dy = scrollY - lastY;
      lastY = scrollY;
      vel = lerp(vel, dy, 0.1);
      mX -= 0.6 + Math.abs(vel) * 0.25;
      const half = marquee.scrollWidth / 2;
      if (-mX >= half) mX += half;
      marquee.style.transform = `translate3d(${mX}px,0,0) skewX(${clamp(-vel * 0.3, -12, 12)}deg)`;
    }

    requestAnimationFrame(loop);
  }

  addEventListener("resize", resize, { passive: true });
  resize();
  requestAnimationFrame(loop);
})();
