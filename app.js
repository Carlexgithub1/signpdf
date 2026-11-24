/* ============================================================
   SignPDF — offline PDF signing (pdf.js + pdf-lib)
   ============================================================ */
(() => {
  'use strict';

  /* Local vendor copies are preferred so the app works with no network.
     If they are missing, fall back to a pinned CDN build. */
  const CDN = {
    pdfLib: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  };

  const INKS = [
    { hex: '#0b1220', name: 'Black' },
    { hex: '#1d4ed8', name: 'Blue' },
    { hex: '#c02626', name: 'Red' },
  ];

  const TYPE_FONTS = [
    { id: 'script', name: 'Script', style: 'normal', weight: 400, css: '"Segoe Script", "Bradley Hand", "Brush Script MT", "Snell Roundhand", cursive' },
    { id: 'elegant', name: 'Elegant', style: 'italic', weight: 400, css: '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, "Times New Roman", serif' },
    { id: 'hand', name: 'Hand', style: 'normal', weight: 400, css: '"Segoe Print", "Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive' },
    { id: 'clean', name: 'Clean', style: 'normal', weight: 600, css: '"Segoe UI", Inter, system-ui, Arial, sans-serif' },
  ];

  const ZOOM = { min: 0.5, max: 3, step: 1.25 };
  const MIN_WIDTH_RATIO = 0.03; // never smaller than 3% of the page width
  const MIN_POINTER_PX = 32; // keep signatures grabbable with a mouse
  const MIN_TOUCH_PX = 44; // ... and comfortable on touch screens

  const ICONS = {
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/></svg>',
  };

  const $ = (id) => document.getElementById(id);

  const dom = {
    stage: $('stage'),
    pages: $('pages'),
    viewer: $('viewer'),
    emptyState: $('emptyState'),
    dropZone: $('dropZone'),
    fileInput: $('fileInput'),
    opening: $('opening'),
    openingText: $('openingText'),
    fileMeta: $('fileMeta'),
    pageChip: $('pageChip'),
    hint: $('hint'),
    toast: $('toast'),
    btnOpen: $('btnOpen'),
    btnBrowse: $('btnBrowse'),
    btnSign: $('btnSign'),
    btnExport: $('btnExport'),
    zoomGroup: $('zoomGroup'),
    zoomIn: $('zoomIn'),
    zoomOut: $('zoomOut'),
    zoomReset: $('zoomReset'),
    sigModal: $('sigModal'),
    tabDraw: $('tabDraw'),
    tabType: $('tabType'),
    panelDraw: $('panelDraw'),
    panelType: $('panelType'),
    padWrap: $('padWrap'),
    sigPad: $('sigPad'),
    penWidth: $('penWidth'),
    btnUndoStroke: $('btnUndoStroke'),
    btnClearPad: $('btnClearPad'),
    typeInput: $('typeInput'),
    typePad: $('typePad'),
    fontChoices: $('fontChoices'),
    inkSwatches: $('inkSwatches'),
    btnApplySig: $('btnApplySig'),
  };

  const state = {
    fileName: '',
    bytes: null,
    pdf: null,
    pages: [],
    placements: [],
    selectedId: null,
    zoom: 1,
    fitScale: 1,
    currentIndex: 0,
    busy: false,
    tab: 'draw',
    ink: INKS[0].hex,
    font: TYPE_FONTS[0].id,
    libsPromise: null,
    scrollRaf: 0,
  };

  /* ------------------------------ helpers ----------------------------- */
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const isPdfFile = (file) => !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));

  function formatBytes(bytes) {
    if (!bytes) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, i);
    return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        reject(new Error(`Could not load ${src}`));
      };
      document.head.appendChild(script);
    });
  }

  async function ensureLibraries() {
    if (state.libsPromise) return state.libsPromise;

    state.libsPromise = (async () => {
      if (!window.PDFLib) {
        try {
          await loadScript('vendor/pdf-lib.min.js');
        } catch {
          await loadScript(CDN.pdfLib);
        }
      }

      if (!window.pdfjsLib) {
        let localWorker = true;
        try {
          await loadScript('vendor/pdf.min.js');
        } catch {
          localWorker = false;
          await loadScript(CDN.pdfjs);
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = localWorker
          ? 'vendor/pdf.worker.min.js'
          : CDN.pdfjsWorker;
      }

      if (!window.PDFLib || !window.pdfjsLib) {
        throw new Error('Signing libraries could not be loaded.');
      }
    })().catch((error) => {
      state.libsPromise = null;
      throw error;
    });

    return state.libsPromise;
  }

  let toastTimer = 0;
  function toast(message, kind = 'info') {
    dom.toast.textContent = message;
    dom.toast.classList.toggle('error', kind === 'error');
    dom.toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => dom.toast.classList.remove('show'), 3400);
  }

  function setOpening(show, text) {
    dom.opening.hidden = !show;
    if (text) dom.openingText.textContent = text;
  }


  /* --------------------------- signature pad --------------------------- */
  const strokes = [];
  let activeStroke = null;
  let activePointer = null;
  let lastFocus = null;

  const qualityScale = () => Math.max(2, Math.min(3, window.devicePixelRatio || 1));

  function drawStroke(ctx, stroke, rect) {
    const points = stroke.points;
    if (!points.length) return;

    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x * rect.width, points[0].y * rect.height, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const px = (i) => points[i].x * rect.width;
    const py = (i) => points[i].y * rect.height;

    ctx.beginPath();
    ctx.moveTo(px(0), py(0));
    for (let i = 1; i < points.length - 1; i += 1) {
      const midX = (px(i) + px(i + 1)) / 2;
      const midY = (py(i) + py(i + 1)) / 2;
      ctx.quadraticCurveTo(px(i), py(i), midX, midY);
    }
    ctx.lineTo(px(points.length - 1), py(points.length - 1));
    ctx.stroke();
  }

  function redrawPad() {
    const canvas = dom.sigPad;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const q = qualityScale();
    const width = Math.round(rect.width * q);
    const height = Math.round(rect.height * q);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(q, 0, 0, q, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    strokes.forEach((stroke) => drawStroke(ctx, stroke, rect));

    dom.padWrap.classList.toggle('has-ink', strokes.length > 0);
    dom.btnUndoStroke.disabled = strokes.length === 0;
    dom.btnClearPad.disabled = strokes.length === 0;
    refreshApplyState();
  }

  function padPoint(event) {
    const rect = dom.sigPad.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
    };
  }

  function endStroke(event) {
    if (activePointer !== null && event && event.pointerId !== activePointer) return;
    if (dom.sigPad.hasPointerCapture?.(activePointer)) {
      try { dom.sigPad.releasePointerCapture(activePointer); } catch { /* ignore */ }
    }
    activeStroke = null;
    activePointer = null;
    redrawPad();
  }

  dom.sigPad.addEventListener('pointerdown', (event) => {
    if (activeStroke || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    activePointer = event.pointerId;
    activeStroke = {
      color: state.ink,
      width: Math.max(1, Number(dom.penWidth.value) || 2.5),
      points: [padPoint(event)],
    };
    strokes.push(activeStroke);
    try { dom.sigPad.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    redrawPad();
  });

  dom.sigPad.addEventListener('pointermove', (event) => {
    if (!activeStroke || event.pointerId !== activePointer) return;
    event.preventDefault();
    const point = padPoint(event);
    const last = activeStroke.points[activeStroke.points.length - 1];
    const rect = dom.sigPad.getBoundingClientRect();
    const moved = Math.hypot((point.x - last.x) * rect.width, (point.y - last.y) * rect.height);
    if (moved < 0.75) return;
    activeStroke.points.push(point);
    redrawPad();
  });

  dom.sigPad.addEventListener('pointerup', endStroke);
  dom.sigPad.addEventListener('pointercancel', endStroke);
  window.addEventListener('blur', () => { if (activeStroke) endStroke(); });

  dom.btnUndoStroke.addEventListener('click', () => {
    strokes.pop();
    redrawPad();
  });
  dom.btnClearPad.addEventListener('click', () => {
    strokes.length = 0;
    redrawPad();
  });

  /* --------------------------- typed signature ------------------------- */
  function currentFont() {
    return TYPE_FONTS.find((font) => font.id === state.font) || TYPE_FONTS[0];
  }

  function renderTypePreview() {
    const canvas = dom.typePad;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const q = qualityScale();
    const width = Math.round(rect.width * q);
    const height = Math.round(rect.height * q);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(q, 0, 0, q, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const text = dom.typeInput.value.trim();
    if (!text) return;

    const font = currentFont();
    const build = (size) => `${font.style} ${font.weight} ${size}px ${font.css}`;
    let size = Math.round(rect.height * 0.56);
    ctx.font = build(size);
    const measured = ctx.measureText(text).width;
    const maxWidth = rect.width * 0.9;
    if (measured > maxWidth) {
      size = Math.max(10, Math.floor(size * (maxWidth / measured)));
      ctx.font = build(size);
    }

    ctx.fillStyle = state.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, rect.width / 2, rect.height * 0.54);
  }

  function refreshApplyState() {
    const ready = state.tab === 'draw'
      ? strokes.length > 0
      : dom.typeInput.value.trim().length > 0;
    dom.btnApplySig.disabled = !ready;
  }

  dom.typeInput.addEventListener('input', () => {
    renderTypePreview();
    refreshApplyState();
  });
  dom.typeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !dom.btnApplySig.disabled) {
      event.preventDefault();
      dom.btnApplySig.click();
    }
  });

  function buildInkSwatches() {
    dom.inkSwatches.innerHTML = '';
    INKS.forEach((ink) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.style.background = ink.hex;
      button.dataset.ink = ink.hex;
      button.title = ink.name;
      button.setAttribute('aria-label', `${ink.name} ink`);
      button.setAttribute('aria-pressed', String(ink.hex === state.ink));
      button.addEventListener('click', () => selectInk(ink.hex));
      dom.inkSwatches.appendChild(button);
    });
  }

  function selectInk(hex) {
    state.ink = hex;
    Array.from(dom.inkSwatches.children).forEach((swatch) => {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.ink === hex));
    });
    if (state.tab === 'type') renderTypePreview();
  }

  function buildFontChoices() {
    dom.fontChoices.innerHTML = '';
    TYPE_FONTS.forEach((font) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'font-chip';
      chip.dataset.font = font.id;
      chip.setAttribute('aria-pressed', String(font.id === state.font));
      chip.title = font.name;

      const sample = document.createElement('span');
      sample.className = 'font-sample';
      sample.textContent = 'Aa';
      sample.style.fontFamily = font.css;
      sample.style.fontStyle = font.style;
      sample.style.fontWeight = String(font.weight);

      const name = document.createElement('span');
      name.className = 'font-name';
      name.textContent = font.name;

      chip.append(sample, name);
      chip.addEventListener('click', () => selectFont(font.id));
      dom.fontChoices.appendChild(chip);
    });
  }

  function selectFont(id) {
    state.font = id;
    Array.from(dom.fontChoices.children).forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.font === id));
    });
    renderTypePreview();
  }

  function setTab(tab) {
    state.tab = tab === 'type' ? 'type' : 'draw';
    const isDraw = state.tab === 'draw';
    dom.tabDraw.setAttribute('aria-selected', String(isDraw));
    dom.tabType.setAttribute('aria-selected', String(!isDraw));
    dom.panelDraw.hidden = !isDraw;
    dom.panelType.hidden = isDraw;
    refreshApplyState();

    window.requestAnimationFrame(() => {
      if (isDraw) redrawPad();
      else {
        renderTypePreview();
        dom.typeInput.focus();
      }
    });
  }

  dom.tabDraw.addEventListener('click', () => setTab('draw'));
  dom.tabType.addEventListener('click', () => setTab('type'));

  function openSignatureModal() {
    if (!state.pdf) return;
    window.clearTimeout(toastTimer);
    dom.toast.classList.remove('show');
    lastFocus = document.activeElement;
    dom.sigModal.hidden = false;
    document.body.classList.add('modal-open');
    setTab(state.tab);
    window.requestAnimationFrame(() => {
      if (state.tab === 'draw') dom.tabDraw.focus();
      else dom.typeInput.focus();
    });
  }

  function closeSignatureModal() {
    if (dom.sigModal.hidden) return;
    dom.sigModal.hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  dom.sigModal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) closeSignatureModal();
  });

  dom.sigModal.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusables = Array.from(dom.sigModal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  /* ------------------------- signature output -------------------------- */
  function trimCanvas(source) {
    const { width, height } = source;
    if (!width || !height) return null;

    let pixels;
    try {
      pixels = source.getContext('2d').getImageData(0, 0, width, height).data;
    } catch {
      return null;
    }

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      const row = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        if (pixels[row + x * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) return null;

    const inkWidth = maxX - minX + 1;
    const inkHeight = maxY - minY + 1;
    const padding = Math.max(2, Math.round(inkHeight * 0.08));

    const out = document.createElement('canvas');
    out.width = inkWidth + padding * 2;
    out.height = inkHeight + padding * 2;
    out.getContext('2d').drawImage(source, minX, minY, inkWidth, inkHeight, padding, padding, inkWidth, inkHeight);

    return { dataUrl: out.toDataURL('image/png'), aspect: out.width / out.height };
  }

  function getSignatureOutput() {
    if (state.tab === 'type') {
      if (!dom.typeInput.value.trim()) return null;
      renderTypePreview();
      return trimCanvas(dom.typePad);
    }
    if (!strokes.length) return null;
    redrawPad();
    return trimCanvas(dom.sigPad);
  }

  dom.btnApplySig.addEventListener('click', () => {
    const signature = getSignatureOutput();
    if (!signature) {
      toast('Add your signature first', 'error');
      return;
    }
    addPlacement(signature);
    closeSignatureModal();
  });

  function updateActionState() {
    dom.btnSign.disabled = !state.pdf;
    dom.btnExport.disabled = state.busy || state.placements.length === 0;
    dom.zoomGroup.hidden = !state.pdf;
    dom.pageChip.hidden = !state.pdf;
    dom.hint.hidden = !state.pdf || state.placements.length === 0;
  }

  const uid = () => `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;


  /* ---------------------------- open document -------------------------- */
  async function requestOpen(file) {
    if (!file) return;
    if (!isPdfFile(file)) {
      toast('Please choose a PDF file', 'error');
      return;
    }
    if (file.size > 120 * 1024 * 1024) {
      toast('That PDF is too large (120 MB max)', 'error');
      return;
    }
    if (state.placements.length && !window.confirm('Open a new PDF? Signatures already placed will be removed.')) {
      return;
    }
    await openPdf(file);
  }

  async function openPdf(file) {
    if (state.busy) return;
    state.busy = true;
    updateActionState();
    setOpening(true, 'Loading signing tools…');
    try {
      await ensureLibraries();
      setOpening(true, `Opening ${file.name}…`);

      const buffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({
        data: new Uint8Array(buffer.slice(0)),
        isEvalSupported: false,
        useSystemFonts: true,
      }).promise;

      clearDocument();

      const pages = [];
      for (let index = 0; index < pdf.numPages; index += 1) {
        const pdfPage = await pdf.getPage(index + 1);
        const viewport = pdfPage.getViewport({ scale: 1 });
        pages.push({
          index,
          pdfPage,
          view: Array.from(pdfPage.view),
          rotate: ((viewport.rotation % 360) + 360) % 360,
          dispW: viewport.width,
          dispH: viewport.height,
          el: null,
          canvas: null,
          layer: null,
          visible: false,
          renderedScale: 0,
          renderTask: null,
          renderToken: 0,
          rendering: false,
          needsRender: false,
        });
      }

      state.pdf = pdf;
      state.bytes = buffer;
      state.fileName = file.name;
      state.pages = pages;
      state.currentIndex = 0;
      state.zoom = 1;

      buildPageElements();
      dom.emptyState.hidden = true;
      dom.viewer.hidden = false;
      dom.fileMeta.textContent = `${file.name} · ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} · ${formatBytes(file.size)}`;
      updateActionState();

      state.fitScale = computeFitScale();
      layoutPages(true);
      observePages();
      updateZoomLabel();
      dom.stage.scrollTop = 0;
      updateCurrentPage();
    } catch (error) {
      console.error(error);
      toast(friendlyError(error), 'error');
      if (!state.pdf) {
        dom.emptyState.hidden = false;
        dom.viewer.hidden = true;
        dom.fileMeta.textContent = 'No PDF loaded';
      }
      updateActionState();
    } finally {
      state.busy = false;
      updateActionState();
      setOpening(false);
    }
  }

  function clearDocument() {
    if (observer) observer.disconnect();
    observer = null;

    state.pages.forEach((page) => {
      if (page.renderTask) {
        try { page.renderTask.cancel(); } catch { /* ignore */ }
      }
      page.el?.remove();
    });

    if (state.pdf) {
      try { state.pdf.destroy(); } catch { /* ignore */ }
    }

    state.pdf = null;
    state.pages = [];
    state.placements = [];
    state.selectedId = null;
    state.fileName = '';
    state.bytes = null;
    dom.pages.innerHTML = '';
  }

  function friendlyError(error) {
    const name = error?.name || '';
    const message = String(error?.message || error || '');
    if (name === 'PasswordException' || /password/i.test(message)) {
      return 'This PDF is password-protected. Remove the password and try again.';
    }
    if (/encrypt/i.test(message)) {
      return 'This PDF is encrypted, so its pages cannot be edited.';
    }
    if (/worker/i.test(message)) {
      return 'The PDF engine could not start. Keep the vendor folder next to index.html.';
    }
    if (/invalid|corrupt|format|structure/i.test(message)) {
      return 'That file does not look like a valid PDF.';
    }
    if (/failed to fetch|load/i.test(message)) {
      return 'The PDF engine could not load. Check the vendor folder or your connection.';
    }
    return 'Could not open that PDF. Please try another file.';
  }

  /* ---------------------------- page rendering ------------------------- */
  let observer = null;

  function buildPageElements() {
    dom.pages.innerHTML = '';
    state.pages.forEach((page) => {
      const el = document.createElement('div');
      el.className = 'page is-loading';
      el.dataset.index = String(page.index);

      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', `Page ${page.index + 1}`);

      const layer = document.createElement('div');
      layer.className = 'sig-layer';

      el.append(canvas, layer);
      dom.pages.appendChild(el);

      page.el = el;
      page.canvas = canvas;
      page.layer = layer;
    });
  }

  function observePages() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const page = state.pages[Number(entry.target.dataset.index)];
        if (!page) return;
        page.visible = entry.isIntersecting;
        if (entry.isIntersecting) renderPage(page);
      });
    }, { root: dom.stage, rootMargin: '800px 0px' });

    state.pages.forEach((page) => observer.observe(page.el));
  }

  function computeFitScale() {
    if (!state.pages.length) return 1;
    const style = window.getComputedStyle(dom.pages);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const available = Math.max(160, dom.pages.clientWidth - padding);
    const widest = state.pages.reduce((max, page) => Math.max(max, page.dispW), 0);
    return clamp(available / widest, 0.1, 1.6);
  }

  const currentScale = () => state.fitScale * state.zoom;

  function layoutPages(initial = false) {
    if (!state.pages.length) return;
    const anchor = initial ? null : captureScrollAnchor();
    state.fitScale = computeFitScale();
    const scale = currentScale();

    state.pages.forEach((page) => {
      page.el.style.width = `${Math.max(1, Math.round(page.dispW * scale))}px`;
      page.el.style.height = `${Math.max(1, Math.round(page.dispH * scale))}px`;
      if (page.visible && page.renderedScale !== scale) renderPage(page);
    });

    if (anchor) restoreScrollAnchor(anchor);
    updateZoomLabel();
    updateCurrentPage();
  }

  function captureScrollAnchor() {
    const stageTop = dom.stage.getBoundingClientRect().top;
    const probe = stageTop + 100;
    for (const page of state.pages) {
      const rect = page.el.getBoundingClientRect();
      if (rect.top <= probe && rect.bottom > probe) {
        return { index: page.index, offset: (probe - rect.top) / Math.max(1, rect.height) };
      }
    }
    return null;
  }

  function restoreScrollAnchor(anchor) {
    const page = state.pages[anchor.index];
    if (!page) return;
    const stageTop = dom.stage.getBoundingClientRect().top;
    const rect = page.el.getBoundingClientRect();
    dom.stage.scrollTop += (rect.top - stageTop) + anchor.offset * rect.height - 100;
  }


  async function renderPage(page) {
    if (!page || !state.pdf) return;
    if (page.rendering) {
      page.needsRender = true;
      return;
    }

    page.rendering = true;
    try {
      for (;;) {
        page.needsRender = false;
        const scale = currentScale();
        if (page.renderedScale === scale) break;

        if (page.renderTask) {
          try { page.renderTask.cancel(); } catch { /* ignore */ }
          try { await page.renderTask.promise; } catch { /* ignore */ }
          page.renderTask = null;
        }

        const token = ++page.renderToken;
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        const maxSide = 4096;
        const pixelScale = Math.min(scale * dpr, maxSide / Math.max(page.dispW, page.dispH));
        const viewport = page.pdfPage.getViewport({ scale: pixelScale });
        const canvas = page.canvas;

        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));

        const context = canvas.getContext('2d');
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        const task = page.pdfPage.render({ canvasContext: context, viewport });
        page.renderTask = task;

        try {
          await task.promise;
          if (token === page.renderToken) {
            page.renderedScale = scale;
            page.el.classList.remove('is-loading');
          }
        } catch (error) {
          if (error?.name !== 'RenderingCancelledException') console.error(error);
          break;
        } finally {
          if (page.renderTask === task) page.renderTask = null;
        }

        if (!page.needsRender) break;
      }
    } finally {
      page.rendering = false;
    }
  }

  function updateZoomLabel() {
    dom.zoomReset.textContent = `${Math.round(currentScale() * 100)}%`;
  }

  function setZoom(value) {
    if (!state.pdf) return;
    const next = clamp(value, ZOOM.min, ZOOM.max);
    if (Math.abs(next - state.zoom) < 0.001) return;
    state.zoom = next;
    layoutPages();
  }

  function mostVisiblePageIndex() {
    if (!state.pages.length) return 0;
    const stage = dom.stage.getBoundingClientRect();
    let bestIndex = state.currentIndex;
    let bestVisible = -1;

    state.pages.forEach((page) => {
      const rect = page.el.getBoundingClientRect();
      const visible = Math.max(0, Math.min(rect.bottom, stage.bottom) - Math.max(rect.top, stage.top));
      if (visible > bestVisible) {
        bestVisible = visible;
        bestIndex = page.index;
      }
    });
    return bestIndex;
  }

  function updateCurrentPage() {
    if (!state.pages.length) {
      dom.pageChip.hidden = true;
      return;
    }
    state.currentIndex = mostVisiblePageIndex();
    dom.pageChip.hidden = false;
    dom.pageChip.textContent = `Page ${state.currentIndex + 1} / ${state.pages.length}`;
  }

  dom.stage.addEventListener('scroll', () => {
    if (state.scrollRaf) return;
    state.scrollRaf = window.requestAnimationFrame(() => {
      state.scrollRaf = 0;
      updateCurrentPage();
    });
  }, { passive: true });

  dom.zoomIn.addEventListener('click', () => setZoom(state.zoom * ZOOM.step));
  dom.zoomOut.addEventListener('click', () => setZoom(state.zoom / ZOOM.step));
  dom.zoomReset.addEventListener('click', () => setZoom(1));

  /* ---------------------------- placements ----------------------------- */
  function applyBox(el, placement) {
    el.style.left = `${placement.fx * 100}%`;
    el.style.top = `${placement.fy * 100}%`;
    el.style.width = `${placement.fw * 100}%`;
    el.style.height = `${placement.fh * 100}%`;

    const pageEl = el.parentElement;
    if (pageEl) {
      const widthPx = placement.fw * pageEl.clientWidth;
      const heightPx = placement.fh * pageEl.clientHeight;
      el.classList.toggle('is-compact', widthPx < 120 || heightPx < 44);
    }
  }

  function placementEl(id) {
    return id ? dom.pages.querySelector(`.sig[data-id="${id}"]`) : null;
  }

  function selectPlacement(id) {
    state.selectedId = id;
    dom.pages.querySelectorAll('.sig').forEach((el) => {
      el.classList.toggle('selected', el.dataset.id === id);
    });
    const el = placementEl(id);
    if (el) el.focus({ preventScroll: true });
  }

  function addPlacement(signature) {
    const pageIndex = mostVisiblePageIndex();
    const page = state.pages[pageIndex];
    if (!page) return;

    let width = 0.3;
    let height = width * (page.dispW / page.dispH) / signature.aspect;
    if (height > 0.22) {
      const shrink = 0.22 / height;
      width *= shrink;
      height *= shrink;
    }

    const placement = {
      id: uid(),
      pageIndex,
      fx: clamp(0.64 - width / 2, 0.03, 0.97 - width),
      fy: clamp(0.74, 0.03, 0.95 - height),
      fw: width,
      fh: height,
      aspect: signature.aspect,
      dataUrl: signature.dataUrl,
    };

    state.placements.push(placement);
    mountPlacement(placement);
    updateActionState();
    selectPlacement(placement.id);
    page.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    toast('Signature added — drag it into place');
  }

  function mountPlacement(placement) {
    const page = state.pages[placement.pageIndex];
    if (!page) return;

    const el = document.createElement('div');
    el.className = 'sig';
    el.dataset.id = placement.id;
    el.tabIndex = 0;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', `Signature on page ${placement.pageIndex + 1}`);
    el.innerHTML = `
      <img src="${placement.dataUrl}" alt="Signature" draggable="false">
      <div class="sig-tools">
        <button type="button" class="sig-tool" data-act="dup" title="Duplicate" aria-label="Duplicate signature">${ICONS.copy}</button>
        <button type="button" class="sig-tool" data-act="del" title="Remove" aria-label="Remove signature">${ICONS.trash}</button>
      </div>
      <span class="sig-handle" data-corner="nw"></span>
      <span class="sig-handle" data-corner="ne"></span>
      <span class="sig-handle" data-corner="sw"></span>
      <span class="sig-handle" data-corner="se"></span>`;

    applyBox(el, placement);
    page.layer.appendChild(el);
    bindPlacement(placement, el);
  }

  function removePlacement(id) {
    const placement = state.placements.find((item) => item.id === id);
    if (!placement) return;

    state.placements = state.placements.filter((item) => item.id !== id);
    placementEl(id)?.remove();
    if (state.selectedId === id) state.selectedId = null;
    updateActionState();
    toast('Signature removed');
  }

  function duplicatePlacement(id) {
    const source = state.placements.find((item) => item.id === id);
    if (!source) return;

    const copy = {
      ...source,
      id: uid(),
      fx: clamp(source.fx + 0.02, 0, 1 - source.fw),
      fy: clamp(source.fy + 0.03, 0, 1 - source.fh),
    };
    state.placements.push(copy);
    mountPlacement(copy);
    selectPlacement(copy.id);
    updateActionState();
  }

  function bindPlacement(placement, el) {
    el.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.closest('.sig-tool')) return;
      event.preventDefault();
      selectPlacement(placement.id);

      const corner = event.target.closest('.sig-handle')?.dataset.corner;
      if (corner) startResize(placement, el, corner, event);
      else startDrag(placement, el, event);
    });

    el.addEventListener('click', (event) => {
      const button = event.target.closest('.sig-tool');
      if (!button) return;
      event.preventDefault();
      if (button.dataset.act === 'del') removePlacement(placement.id);
      else if (button.dataset.act === 'dup') duplicatePlacement(placement.id);
    });

    el.addEventListener('keydown', (event) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removePlacement(placement.id);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicatePlacement(placement.id);
        return;
      }
      if (event.key === 'Escape') {
        selectPlacement(null);
        el.blur();
        return;
      }

      const step = event.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;
      if (event.key === 'ArrowLeft') dx = -step;
      else if (event.key === 'ArrowRight') dx = step;
      else if (event.key === 'ArrowUp') dy = -step;
      else if (event.key === 'ArrowDown') dy = step;
      if (!dx && !dy) return;

      event.preventDefault();
      const pageEl = state.pages[placement.pageIndex].el;
      placement.fx = clamp(placement.fx + dx / Math.max(1, pageEl.clientWidth), 0, 1 - placement.fw);
      placement.fy = clamp(placement.fy + dy / Math.max(1, pageEl.clientHeight), 0, 1 - placement.fh);
      applyBox(el, placement);
    });
  }


  function startDrag(placement, el, event) {
    const pageEl = state.pages[placement.pageIndex].el;
    const rect = pageEl.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startFx = placement.fx;
    const startFy = placement.fy;
    const pointerId = event.pointerId;

    try { el.setPointerCapture(pointerId); } catch { /* ignore */ }

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      placement.fx = clamp(startFx + (moveEvent.clientX - startX) / Math.max(1, rect.width), 0, 1 - placement.fw);
      placement.fy = clamp(startFy + (moveEvent.clientY - startY) / Math.max(1, rect.height), 0, 1 - placement.fh);
      applyBox(el, placement);
    };

    const onEnd = (endEvent) => {
      if (endEvent && endEvent.pointerId !== pointerId) return;
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      try { el.releasePointerCapture(pointerId); } catch { /* ignore */ }
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
  }

  function startResize(placement, el, corner, event) {
    const pageEl = state.pages[placement.pageIndex].el;
    const rect = pageEl.getBoundingClientRect();
    const startWidth = placement.fw;
    const startHeight = placement.fh;
    const anchorX = corner.includes('w') ? placement.fx + placement.fw : placement.fx;
    const anchorY = corner.includes('n') ? placement.fy + placement.fh : placement.fy;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;

    try { el.setPointerCapture(pointerId); } catch { /* ignore */ }

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();

      const widthToPointer = Math.abs(moveEvent.clientX - (rect.left + anchorX * rect.width)) / Math.max(1, rect.width);
      const heightToPointer = Math.abs(moveEvent.clientY - (rect.top + anchorY * rect.height)) / Math.max(1, rect.height);
      const drivenByWidth = Math.abs(moveEvent.clientX - startX) >= Math.abs(moveEvent.clientY - startY);

      let scale = drivenByWidth ? widthToPointer / startWidth : heightToPointer / startHeight;
      if (!Number.isFinite(scale) || scale <= 0) scale = 1;

      const roomW = (corner.includes('w') ? anchorX : 1 - anchorX) / startWidth;
      const roomH = (corner.includes('n') ? anchorY : 1 - anchorY) / startHeight;
      const maxScale = Math.min(roomW, roomH);
      const startPx = Math.max(1, startWidth * rect.width);
      const minPx = window.matchMedia?.('(pointer: coarse)')?.matches ? MIN_TOUCH_PX : MIN_POINTER_PX;
      const minScale = Math.max(MIN_WIDTH_RATIO / startWidth, minPx / startPx);

      scale = clamp(scale, Math.min(minScale, maxScale), Math.max(minScale, maxScale));

      placement.fw = startWidth * scale;
      placement.fh = startHeight * scale;
      placement.fx = corner.includes('w') ? anchorX - placement.fw : anchorX;
      placement.fy = corner.includes('n') ? anchorY - placement.fh : anchorY;
      applyBox(el, placement);
    };

    const onEnd = (endEvent) => {
      if (endEvent && endEvent.pointerId !== pointerId) return;
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      try { el.releasePointerCapture(pointerId); } catch { /* ignore */ }
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
  }

  dom.stage.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.sig')) selectPlacement(null);
  });


  /* ------------------------------ export ------------------------------ */
  function geometryFor(placement, page) {
    const [x0, y0, x1, y1] = page.view;
    const pageW = x1 - x0;
    const pageH = y1 - y0;
    const sideways = page.rotate === 90 || page.rotate === 270;
    const displayW = sideways ? pageH : pageW;
    const displayH = sideways ? pageW : pageH;

    const left = placement.fx * displayW;
    const top = placement.fy * displayH;
    const width = placement.fw * displayW;
    const height = placement.fh * displayH;

    let x;
    let y;
    switch (page.rotate) {
      case 90:
        x = x0 + top + height;
        y = y0 + left;
        break;
      case 180:
        x = x0 + pageW - left;
        y = y0 + top + height;
        break;
      case 270:
        x = x0 + pageW - top - height;
        y = y0 + pageH - left;
        break;
      default:
        x = x0 + left;
        y = y0 + pageH - top - height;
    }
    return { x, y, width, height, rotate: page.rotate };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const signedFileName = (name) => `${name.replace(/\.pdf$/i, '')}-signed.pdf`;

  function setExportLabel(text) {
    dom.btnExport.querySelectorAll('.btn-label').forEach((label) => {
      if (text) label.textContent = text;
      else label.textContent = label.classList.contains('label-short') ? 'Download' : 'Download signed PDF';
    });
  }

  async function exportPdf() {
    if (!state.pdf || !state.bytes || !state.placements.length || state.busy) return;

    state.busy = true;
    dom.btnExport.classList.add('is-busy');
    setExportLabel('Exporting…');
    updateActionState();

    try {
      await ensureLibraries();
      const { PDFDocument, degrees } = window.PDFLib;
      const pdfDoc = await PDFDocument.load(state.bytes.slice(0));
      const pages = pdfDoc.getPages();
      const embedded = new Map();

      for (const placement of state.placements) {
        const page = pages[placement.pageIndex];
        const info = state.pages[placement.pageIndex];
        if (!page || !info) continue;

        let image = embedded.get(placement.dataUrl);
        if (!image) {
          image = await pdfDoc.embedPng(placement.dataUrl);
          embedded.set(placement.dataUrl, image);
        }

        const box = geometryFor(placement, info);
        page.drawImage(image, {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          rotate: degrees(box.rotate),
        });
      }

      const bytes = await pdfDoc.save();
      const filename = signedFileName(state.fileName);
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), filename);
      toast(`Saved ${filename}`);
    } catch (error) {
      console.error(error);
      const encrypted = /encrypt/i.test(String(error?.message || ''));
      toast(encrypted ? 'This PDF is encrypted and cannot be signed.' : 'Could not export the signed PDF.', 'error');
    } finally {
      state.busy = false;
      dom.btnExport.classList.remove('is-busy');
      setExportLabel(null);
      updateActionState();
    }
  }


  /* ------------------------------ wiring ------------------------------- */
  function hasFiles(event) {
    const types = event.dataTransfer && event.dataTransfer.types;
    return !!types && Array.from(types).indexOf('Files') !== -1;
  }

  let resizeTimer = 0;

  function bindGlobalUi() {
    dom.btnOpen.addEventListener('click', () => dom.fileInput.click());
    dom.btnBrowse.addEventListener('click', () => dom.fileInput.click());

    dom.fileInput.addEventListener('change', () => {
      const files = dom.fileInput.files ? Array.from(dom.fileInput.files) : [];
      dom.fileInput.value = '';
      if (files[0]) requestOpen(files[0]);
    });

    dom.btnSign.addEventListener('click', openSignatureModal);
    dom.btnExport.addEventListener('click', exportPdf);

    let dragDepth = 0;
    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      document.body.classList.add('is-dragging');
      if (!state.pdf) dom.dropZone.classList.add('dragover');
    });

    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('dragleave', (event) => {
      if (event.relatedTarget === null) {
        dragDepth = 0;
        document.body.classList.remove('is-dragging');
        dom.dropZone.classList.remove('dragover');
        return;
      }
      if (!hasFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        document.body.classList.remove('is-dragging');
        dom.dropZone.classList.remove('dragover');
      }
    });

    window.addEventListener('dragend', () => {
      dragDepth = 0;
      document.body.classList.remove('is-dragging');
      dom.dropZone.classList.remove('dragover');
    });

    window.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      document.body.classList.remove('is-dragging');
      dom.dropZone.classList.remove('dragover');
      const file = Array.from(event.dataTransfer?.files || []).find(isPdfFile);
      if (file) requestOpen(file);
      else toast('Please drop a PDF file', 'error');
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing = target && (
        target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.isContentEditable
      );

      if (event.key === 'Escape') {
        if (!dom.sigModal.hidden) {
          closeSignatureModal();
          return;
        }
        if (state.selectedId) {
          selectPlacement(null);
          return;
        }
      }

      if (typing) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        dom.fileInput.click();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        exportPdf();
      }
    });

    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (state.pdf) layoutPages();
        if (!dom.sigModal.hidden) {
          if (state.tab === 'draw') redrawPad();
          else renderTypePreview();
        }
      }, 140);
    });
  }

  function init() {
    buildInkSwatches();
    buildFontChoices();
    bindGlobalUi();
    updateActionState();
  }

  init();
})();


