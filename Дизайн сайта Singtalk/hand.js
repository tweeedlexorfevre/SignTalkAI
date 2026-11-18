/* SignTalk «21 точка» — animated primitives: <st-hand>, <st-dots>, <st-wave>, <st-type>, <st-icon>. */
(() => {
  if (customElements.get('st-hand')) return;
  const NS = 'http://www.w3.org/2000/svg';
  const reduced = () =>
    document.documentElement.dataset.motion === 'off' ||
    (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const bool = (v) => v !== null && v !== undefined && v !== 'false' && v !== false;
  const props = (C, names) =>
    names.forEach((n) =>
      Object.defineProperty(C.prototype, n, {
        configurable: true,
        get() { return this.getAttribute(n); },
        set(v) { if (v === null || v === undefined) this.removeAttribute(n); else this.setAttribute(n, String(v)); },
      }),
    );

  // 21 MediaPipe landmarks, same coordinates as web/src/components/LandmarkHand.tsx
  const OPEN = [[50,92],[35,84],[25,74],[18,64],[13,54],[37,57],[34,41],[32,31],[31,20],[49,55],[49,37],[49,25],[49,13],[61,57],[63,40],[64,29],[65,19],[72,63],[77,51],[80,43],[83,35]];
  const W = [[50,92]];
  const TA = [[37,84],[31,75],[36,66],[44,62]];
  const IC = [[37,57],[36,46],[41,41],[43,49]];
  const MC = [[49,55],[49,44],[54,39],[55,48]];
  const RC = [[61,57],[62,47],[66,43],[66,51]];
  const PC = [[72,63],[73,55],[76,51],[75,58]];
  const POSES = [
    OPEN,
    [...W, ...TA, ...OPEN.slice(5, 9), ...MC, ...RC, ...PC],
    [...W, ...TA, [37,57],[31,42],[27,32],[23,21], [49,55],[52,38],[54,27],[56,15], ...RC, ...PC],
    [...W, [35,84],[25,75],[21,66],[26,55], [37,57],[32,46],[25,46],[25,54], [49,55],[51,37],[52,25],[53,13], [61,57],[65,41],[68,30],[70,20], [72,63],[79,52],[84,44],[88,36]],
    [...W, ...TA, ...IC, ...MC, ...RC, ...PC],
    [...W, [35,84],[24,77],[15,70],[7,63], ...IC, ...MC, ...RC, [72,63],[79,52],[84,44],[89,35]],
  ];
  const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  const TIPS = [4, 8, 12, 16, 20];
  const DELAY = (i) => (i === 0 ? 0 : ((i - 1) % 4) * 45 + Math.floor((i - 1) / 4) * 18);
  const clamp = (v) => Math.max(0, Math.min(1, v));

  class StHand extends HTMLElement {
    static get observedAttributes() { return ['pose']; }
    connectedCallback() {
      if (!this._svg) this._build();
      this.style.display = 'block';
      if (!this.style.width) this.style.width = '100%';
      if (!this.style.height) this.style.height = '100%';
      const now = performance.now();
      this._intro = now;
      this._vis = true;
      if (!this._cur) {
        const p = this._idx();
        this._cur = POSES[p].map((a) => a.slice());
        this._from = this._cur.map((a) => a.slice());
        this._to = POSES[p];
        this._ms = now - 5000;
        this._auto = now;
        this._autoI = p;
      }
      this._io = new IntersectionObserver((es) => { this._vis = es[0].isIntersecting; });
      this._io.observe(this);
      const host = this.closest('[data-hover]');
      if (host && this.getAttribute('replay') === 'hover') {
        this._host = host;
        this._onEnter = () => { this._intro = performance.now(); };
        host.addEventListener('mouseenter', this._onEnter);
      }
      const tick = (t) => { this._raf = requestAnimationFrame(tick); if (this._vis) this._frame(t); };
      this._raf = requestAnimationFrame(tick);
    }
    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      if (this._io) this._io.disconnect();
      if (this._host) this._host.removeEventListener('mouseenter', this._onEnter);
    }
    attributeChangedCallback(n, o, v) { if (n === 'pose' && o !== v && this._cur) this._go(this._idx()); }
    _idx() { const v = parseInt(this.getAttribute('pose'), 10); return isNaN(v) ? 0 : ((v % POSES.length) + POSES.length) % POSES.length; }
    _go(i) { this._from = this._cur.map((a) => a.slice()); this._to = POSES[i]; this._ms = performance.now(); }
    _build() {
      const el = (tag, parent) => { const e = document.createElementNS(NS, tag); parent.appendChild(e); return e; };
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.overflow = 'visible';
      svg.style.display = 'block';
      const gBox = el('g', svg), gB = el('g', svg), gR = el('g', svg), gJ = el('g', svg), gL = el('g', svg);
      this._box = [0, 1, 2, 3].map(() => { const p = el('path', gBox); p.setAttribute('fill', 'none'); return p; });
      this._boxText = el('text', gBox);
      this._boxText.setAttribute('font-size', '2.8');
      this._boxText.setAttribute('font-family', 'JetBrains Mono, monospace');
      this._lines = BONES.map(() => { const l = el('line', gB); l.setAttribute('stroke-linecap', 'round'); return l; });
      this._rings = TIPS.map(() => { const c = el('circle', gR); c.setAttribute('fill', 'none'); return c; });
      this._dots = OPEN.map(() => el('circle', gJ));
      this._labels = OPEN.map((_, i) => {
        const t = el('text', gL);
        t.textContent = i;
        t.setAttribute('font-size', '2.7');
        t.setAttribute('font-family', 'JetBrains Mono, monospace');
        return t;
      });
      this._gL = gL; this._gBox = gBox;
      gL.style.display = 'none';
      gBox.style.display = 'none';
      this.appendChild(svg);
      this._svg = svg;
    }
    _frame(now) {
      const mode = this.getAttribute('mode') || 'mark';
      const still = reduced() || bool(this.getAttribute('still'));
      const ink = this.getAttribute('ink') || 'currentColor';
      const sig = this.getAttribute('signal') || '#ff5a1f';
      const labels = bool(this.getAttribute('labels'));
      if (!this.hasAttribute('pose') && mode !== 'mark' && !still) {
        const iv = +this.getAttribute('interval') || 2600;
        if (now - this._auto > iv) { this._auto = now; this._autoI = (this._autoI + 1) % POSES.length; this._go(this._autoI); }
      }
      const dur = 850;
      const pts = [];
      for (let i = 0; i < 21; i++) {
        const k = still ? 1 : clamp((now - this._ms - DELAY(i)) / dur);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const f = this._from[i], t = this._to[i];
        const bx = f[0] + (t[0] - f[0]) * e, by = f[1] + (t[1] - f[1]) * e;
        this._cur[i][0] = bx; this._cur[i][1] = by;
        let x = bx, y = by;
        if (!still) {
          const a = mode === 'track' ? 0.5 : mode === 'hero' ? 0.25 : 0;
          x += Math.sin(now * 0.0021 + i * 1.7) * a + Math.sin(now * 0.0053 + i * 0.4) * a * 0.5;
          y += Math.cos(now * 0.0019 + i * 1.3) * a + Math.cos(now * 0.0047 + i * 0.9) * a * 0.5;
        }
        pts.push([x, y]);
      }
      let dx = 0, dy = 0, rot = 0, sc = 1;
      if (!still && mode === 'track') { dx = Math.sin(now / 1900) * 4; dy = Math.cos(now / 2600) * 3; rot = Math.sin(now / 3100) * 4; }
      if (!still && mode === 'hero') { sc = 1 + Math.sin(now / 1800) * 0.015; rot = Math.sin(now / 4200) * 2; }
      const cr = Math.cos((rot * Math.PI) / 180), sr = Math.sin((rot * Math.PI) / 180);
      for (const p of pts) {
        const ux = (p[0] - 50) * sc, uy = (p[1] - 55) * sc;
        p[0] = 50 + ux * cr - uy * sr + dx;
        p[1] = 55 + ux * sr + uy * cr + dy;
      }
      const ti = still ? 1e9 : now - this._intro;
      const sw = +this.getAttribute('weight') || (mode === 'mark' ? 3 : mode === 'hero' ? 1.1 : 1.3);
      const rs = mode === 'mark' ? 1 : mode === 'hero' ? 0.62 : 0.7;
      BONES.forEach(([a, b], j) => {
        const l = this._lines[j];
        const f = clamp((ti - 300 - j * 45) / 600);
        const e = 1 - Math.pow(1 - f, 3);
        const p = pts[a], q = pts[b];
        l.setAttribute('x1', p[0]); l.setAttribute('y1', p[1]);
        l.setAttribute('x2', p[0] + (q[0] - p[0]) * e); l.setAttribute('y2', p[1] + (q[1] - p[1]) * e);
        l.setAttribute('stroke', ink); l.setAttribute('stroke-width', sw);
        l.setAttribute('stroke-opacity', mode === 'mark' ? 0.42 : 0.5);
      });
      pts.forEach((p, i) => {
        const c = this._dots[i];
        const tip = TIPS.includes(i);
        const f = clamp((ti - i * 45) / 450);
        const s = f === 0 ? 0 : 1 + 2.70158 * Math.pow(f - 1, 3) + 1.70158 * Math.pow(f - 1, 2);
        let r = (tip ? 5.2 : i === 0 ? 4.6 : 3.4) * rs * s;
        if (tip && mode === 'mark' && !still && ti > 1600) r *= 1 + Math.max(0, Math.sin((now / 2800) * Math.PI * 2 - i * 0.27)) * 0.4;
        c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]);
        c.setAttribute('r', Math.max(0, r));
        c.setAttribute('fill', tip ? sig : ink);
      });
      const showR = mode !== 'mark' && !still;
      this._rings.forEach((c, k) => {
        if (!showR || ti < 1200) { c.setAttribute('r', 0); return; }
        const ph = ((now / 1000) * 0.5 + k * 0.2) % 1;
        const p = pts[TIPS[k]];
        c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]);
        c.setAttribute('r', 5.2 * rs + ph * 9);
        c.setAttribute('stroke', sig); c.setAttribute('stroke-width', 0.6);
        c.setAttribute('stroke-opacity', (1 - ph) * 0.9);
      });
      this._gL.style.display = labels ? '' : 'none';
      if (labels) pts.forEach((p, i) => {
        const t = this._labels[i];
        const tip = TIPS.includes(i);
        t.setAttribute('x', p[0] + 3.2); t.setAttribute('y', p[1] - 2.6);
        t.setAttribute('fill', tip ? sig : ink);
        t.setAttribute('fill-opacity', tip ? 1 : 0.55);
        t.style.opacity = ti > i * 45 + 200 ? 1 : 0;
      });
      const box = mode === 'track';
      this._gBox.style.display = box ? '' : 'none';
      if (box) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
        x0 -= 7; y0 -= 7; x1 += 7; y1 += 7;
        const L = 6;
        const d = [`M${x0} ${y0 + L}V${y0}H${x0 + L}`, `M${x1 - L} ${y0}H${x1}V${y0 + L}`, `M${x1} ${y1 - L}V${y1}H${x1 - L}`, `M${x0 + L} ${y1}H${x0}V${y1 - L}`];
        this._box.forEach((p, i) => { p.setAttribute('d', d[i]); p.setAttribute('stroke', sig); p.setAttribute('stroke-width', 0.8); });
        this._boxText.setAttribute('x', x0); this._boxText.setAttribute('y', y0 - 2.5);
        this._boxText.setAttribute('fill', sig);
        this._boxText.textContent = this.getAttribute('tag') || 'HAND · 21 PTS';
      }
    }
  }
  props(StHand, ['pose', 'mode', 'labels', 'ink', 'signal', 'still', 'weight', 'replay', 'tag', 'interval']);

  class Canvased extends HTMLElement {
    connectedCallback() {
      if (!this._c) {
        this._c = document.createElement('canvas');
        Object.assign(this._c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
        this.appendChild(this._c);
      }
      if (!this.style.position) this.style.position = 'relative';
      this.style.display = 'block';
      this.style.pointerEvents = 'none';
      if (!this.style.width) this.style.width = '100%';
      if (!this.style.height) this.style.height = '100%';
      this._ro = new ResizeObserver(() => this._size());
      this._ro.observe(this);
      this._size();
      this._vis = true;
      this._io = new IntersectionObserver((es) => { this._vis = es[0].isIntersecting; });
      this._io.observe(this);
      this._init && this._init();
      const tick = (t) => { this._raf = requestAnimationFrame(tick); if (this._vis && this._w) this._draw(t); };
      this._raf = requestAnimationFrame(tick);
    }
    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      this._ro && this._ro.disconnect();
      this._io && this._io.disconnect();
      this._done && this._done();
    }
    _size() {
      const r = this.getBoundingClientRect();
      const d = Math.min(2, devicePixelRatio || 1);
      this._w = r.width; this._h = r.height; this._d = d;
      this._c.width = Math.max(1, r.width * d); this._c.height = Math.max(1, r.height * d);
    }
    _ctx() { const ctx = this._c.getContext('2d'); ctx.setTransform(this._d, 0, 0, this._d, 0, 0); ctx.clearRect(0, 0, this._w, this._h); return ctx; }
  }

  // A field of tracking points; dots near the pointer grow and the closest light up in signal.
  class StDots extends Canvased {
    _init() { this._pm = (e) => { this._px = e.clientX; this._py = e.clientY; }; window.addEventListener('pointermove', this._pm, { passive: true }); }
    _done() { window.removeEventListener('pointermove', this._pm); }
    _draw(now) {
      const ctx = this._ctx();
      const g = +this.getAttribute('gap') || 22;
      const ink = this.getAttribute('ink') || '22,19,14';
      const base = +this.getAttribute('alpha') || 0.13;
      const r = this.getBoundingClientRect();
      const px = (this._px ?? -1e4) - r.left, py = (this._py ?? -1e4) - r.top;
      const still = reduced();
      for (let y = g / 2; y < this._h; y += g) for (let x = g / 2; x < this._w; x += g) {
        const b = Math.max(0, 1 - Math.hypot(x - px, y - py) / 160);
        const w = still ? 0.5 : (Math.sin((x * 0.7 + y) / 90 - now * 0.0011) + 1) / 2;
        ctx.fillStyle = b > 0.62 ? `rgba(255,90,31,${Math.min(1, 0.35 + b)})` : `rgba(${ink},${Math.min(1, base * (0.55 + 0.9 * w) + b * 0.6)})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.1 + b * 2 + w * 0.3, 0, 6.283);
        ctx.fill();
      }
    }
  }
  props(StDots, ['gap', 'ink', 'alpha']);

  // Hand-motion energy, scrolling. Bars over the threshold are a sign segment.
  class StWave extends Canvased {
    _init() { this._vals = []; this._last = 0; }
    _draw(now) {
      const ctx = this._ctx();
      const ink = this.getAttribute('ink') || '242,237,228';
      const bw = 4, gap = 2, n = Math.ceil(this._w / (bw + gap));
      if (now - this._last > 70 && !reduced()) {
        this._last = now;
        const ph = (now % 2600) / 2600;
        const burst = ph > 0.2 && ph < 0.62 ? Math.sin(((ph - 0.2) / 0.42) * Math.PI) : 0;
        this._vals.push(Math.min(1, 0.07 + Math.random() * 0.12 + burst * (0.6 + Math.random() * 0.3)));
        if (this._vals.length > n) this._vals.splice(0, this._vals.length - n);
      }
      const th = 0.42, H = this._h, len = this._vals.length;
      this._vals.forEach((v, i) => {
        const x = this._w - (len - i) * (bw + gap);
        ctx.fillStyle = v > th ? '#ff5a1f' : `rgba(${ink},.35)`;
        ctx.fillRect(x, H - v * H, bw, v * H);
      });
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = `rgba(${ink},.55)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H - th * H); ctx.lineTo(this._w, H - th * H); ctx.stroke();
    }
  }
  props(StWave, ['ink']);

  // Types its text out whenever it changes, with a signal caret.
  class StType extends HTMLElement {
    static get observedAttributes() { return ['text']; }
    connectedCallback() {
      if (!this._s) {
        this._s = document.createElement('span');
        this._k = document.createElement('i');
        Object.assign(this._k.style, { display: 'inline-block', width: '.42em', height: '.78em', marginLeft: '.08em', background: this.getAttribute('caret') || '#ff5a1f', verticalAlign: '-.02em' });
        this.append(this._s, this._k);
        this._k.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.51 }, { opacity: 0 }], { duration: 900, iterations: Infinity });
      }
      this.style.display = 'inline';
      this._type();
    }
    disconnectedCallback() { clearInterval(this._iv); }
    attributeChangedCallback() { if (this._s) this._type(); }
    _type() {
      clearInterval(this._iv);
      const txt = this.getAttribute('text') || '';
      if (reduced()) { this._s.textContent = txt; return; }
      let i = 0;
      this._s.textContent = '';
      this._iv = setInterval(() => { i++; this._s.textContent = txt.slice(0, i); if (i >= txt.length) clearInterval(this._iv); }, +this.getAttribute('speed') || 55);
    }
  }
  props(StType, ['text', 'caret', 'speed']);

  // Lucide icons, fetched once from lucide-static.
  const cache = {};
  const icon = (n) => cache[n] || (cache[n] = fetch(`https://unpkg.com/lucide-static@0.460.0/icons/${n}.svg`).then((r) => (r.ok ? r.text() : '')).catch(() => ''));
  class StIcon extends HTMLElement {
    static get observedAttributes() { return ['icon', 'size', 'stroke']; }
    connectedCallback() { this.style.display = 'inline-flex'; this.style.flexShrink = '0'; this._render(); }
    attributeChangedCallback() { if (this.isConnected) this._render(); }
    _render() {
      const n = this.getAttribute('icon');
      const s = this.getAttribute('size') || '20';
      this.style.width = s + 'px'; this.style.height = s + 'px';
      if (!n) return;
      const tok = (this._tok = {});
      icon(n).then((txt) => {
        if (this._tok !== tok) return;
        this.innerHTML = txt;
        const svg = this.querySelector('svg');
        if (svg) { svg.setAttribute('width', s); svg.setAttribute('height', s); svg.setAttribute('stroke-width', this.getAttribute('stroke') || '2'); svg.style.display = 'block'; }
      });
    }
  }
  props(StIcon, ['icon', 'size', 'stroke']);

  customElements.define('st-hand', StHand);
  customElements.define('st-dots', StDots);
  customElements.define('st-wave', StWave);
  customElements.define('st-type', StType);
  customElements.define('st-icon', StIcon);
})();
