/* =========================================================
   PDF Bench — application logic
   Depends on: pdf-lib (global PDFLib), pdf.js (global pdfjsLib)
   ========================================================= */

/* ---------- 1. Configure PDF.js worker ---------- */
// Points to a real worker file placed next to index.html:
//   vendor/pdf.worker.min.js
// If missing, pdf.js falls back to a main-thread "fake worker".
(function setupPdfWorker() {
  if (typeof pdfjsLib === 'undefined') {
    console.error('pdf.js failed to load');
    return;
  }
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  } catch (e) {
    console.warn('Could not set PDF worker, falling back to main thread', e);
  }
})();

/* ---------- 2. Helpers ---------- */

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(c));
  }
  return n;
}

async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

async function loadPdfLib(bytes) {
  return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
}

function downloadBytes(bytes, name, mime = 'application/pdf') {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function showStatus(container, msg, kind = '') {
  container.innerHTML = '';
  container.className = 'status ' + kind;
  container.textContent = msg;
}

/* ---------- 3. Tool registry ---------- */

const TOOLS = [];

function registerTool(spec) {
  TOOLS.push(spec);
}

/* ---------- 4. Drop zone ---------- */

function makeDropZone({ accept = 'application/pdf', multiple = false, onFiles }) {
  const input = el('input', {
    type: 'file',
    accept,
    multiple: multiple ? '' : false,
  });

  const label = el('div', { class: 'drop-label' },
    el('b', {}, multiple ? 'Choose files' : 'Choose a file'),
    ' or drag & drop here'
  );

  const root = el('div', { class: 'drop' }, label, input);
  const list = el('ul', { class: 'filelist' });

  const state = { files: [] };

  function render() {
    list.innerHTML = '';
    state.files.forEach((f, i) => {
      const moveUp = multiple && i > 0
        ? el('button', {
            class: 'fmove',
            title: 'Move up',
            onclick: () => { [state.files[i - 1], state.files[i]] = [state.files[i], state.files[i - 1]]; render(); }
          }, '↑')
        : null;

      const remove = el('button', {
        class: 'fremove',
        title: 'Remove',
        onclick: () => { state.files.splice(i, 1); render(); }
      }, '×');

      list.append(el('li', {},
        el('span', { class: 'fname', title: f.name }, f.name),
        el('span', { class: 'fsize' }, fmtSize(f.size)),
        moveUp,
        remove
      ));
    });
    if (onFiles) onFiles(state.files.slice());
  }

  function handleFiles(fileList) {
    const incoming = Array.from(fileList);
    if (multiple) {
      state.files.push(...incoming);
    } else {
      state.files = incoming.slice(0, 1);
    }
    render();
  }

  input.addEventListener('change', () => handleFiles(input.files));
  root.addEventListener('click', () => input.click());
  root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('drag'); });
  root.addEventListener('dragleave', () => root.classList.remove('drag'));
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    root.classList.remove('drag');
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });

  return {
    root,
    get files() { return state.files; },
    render,
    clear() { state.files = []; render(); },
    listEl: list,
  };
}

/* ---------- 5. Tools ---------- */

/* --- 5a. Merge PDFs --- */
registerTool({
  id: 'merge',
  title: 'Merge PDFs',
  desc: 'Combine several PDFs into one. Order them with the arrows.',
  build() {
    const panel = el('section', { class: 'panel' });
    panel.append(
      el('h1', {}, 'Merge PDFs'),
      el('p', { class: 'desc' }, 'Combine several PDFs into one document. Reorder files with the arrows before merging.')
    );

    const drop = makeDropZone({ multiple: true, accept: 'application/pdf' });
    panel.append(drop.root, drop.listEl);

    const status = el('div', { class: 'status' });
    const output = el('div', { class: 'output' });
    const btn = el('button', { class: 'btn', disabled: true }, 'Merge');

    btn.addEventListener('click', async () => {
      if (drop.files.length < 2) return;
      btn.disabled = true;
      showStatus(status, 'Merging…');
      output.innerHTML = '';
      try {
        const merged = await PDFLib.PDFDocument.create();
        for (const file of drop.files) {
          const src = await loadPdfLib(await readFileBytes(file));
          const pages = await merged.copyPages(src, src.getPageIndices());
          pages.forEach(p => merged.addPage(p));
        }
        const bytes = await merged.save();
        const name = 'merged.pdf';
        downloadBytes(bytes, name);
        showStatus(status, `Done — ${fmtSize(bytes.length)}`, 'ok');
        output.append(el('div', { class: 'output-item' },
          el('a', { href: '#', onclick: (ev) => { ev.preventDefault(); downloadBytes(bytes, name); } }, name),
          el('span', { class: 'osize' }, fmtSize(bytes.length))
        ));
      } catch (err) {
        console.error(err);
        showStatus(status, 'Error: ' + err.message, 'err');
      } finally {
        btn.disabled = drop.files.length < 2;
      }
    });

    new MutationObserver(() => {
      btn.disabled = drop.files.length < 2;
    }).observe(drop.listEl, { childList: true });

    panel.append(btn, status, output);
    return panel;
  }
});

/* --- 5b. Split a PDF --- */
registerTool({
  id: 'split',
  title: 'Split PDF',
  desc: 'Extract every page into its own file, or a single page range.',
  build() {
    const panel = el('section', { class: 'panel' });
    panel.append(
      el('h1', {}, 'Split PDF'),
      el('p', { class: 'desc' }, 'Choose a PDF, then extract pages. Leave the range empty to split every page.')
    );

    const drop = makeDropZone({ multiple: false, accept: 'application/pdf' });
    panel.append(drop.root, drop.listEl);

    const rangeField = el('div', { class: 'field' },
      el('label', {}, 'Page range (e.g. 1-3,5)'),
      el('input', { type: 'text', placeholder: 'leave empty = all pages' })
    );

    const status = el('div', { class: 'status' });
    const output = el('div', { class: 'output' });
    const btn = el('button', { class: 'btn', disabled: true }, 'Split');

    new MutationObserver(() => { btn.disabled = drop.files.length === 0; })
      .observe(drop.listEl, { childList: true });

    btn.addEventListener('click', async () => {
      const file = drop.files[0];
      if (!file) return;
      btn.disabled = true;
      showStatus(status, 'Splitting…');
      output.innerHTML = '';
      try {
        const src = await loadPdfLib(await readFileBytes(file));
        const total = src.getPageCount();
        const range = rangeField.querySelector('input').value.trim();
        const pages = parsePageRange(range, total);
        if (!pages.length) throw new Error('No valid pages selected');
        const baseName = file.name.replace(/\.pdf$/i, '');

        if (range === '') {
          for (let i = 0; i < total; i++) {
            const out = await PDFLib.PDFDocument.create();
            const [p] = await out.copyPages(src, [i]);
            out.addPage(p);
            const bytes = await out.save();
            const name = `${baseName}_page_${i + 1}.pdf`;
            downloadBytes(bytes, name);
            output.append(el('div', { class: 'output-item' },
              el('a', { href: '#', onclick: (ev) => { ev.preventDefault(); downloadBytes(bytes, name); } }, name),
              el('span', { class: 'osize' }, fmtSize(bytes.length))
            ));
          }
          showStatus(status, `Done — ${total} files`, 'ok');
        } else {
          const out = await PDFLib.PDFDocument.create();
          const copied = await out.copyPages(src, pages);
          copied.forEach(p => out.addPage(p));
          const bytes = await out.save();
          const name = `${baseName}_pages_${pages[0] + 1}-${pages[pages.length - 1] + 1}.pdf`;
          downloadBytes(bytes, name);
          output.append(el('div', { class: 'output-item' },
            el('a', { href: '#', onclick: (ev) => { ev.preventDefault(); downloadBytes(bytes, name); } }, name),
            el('span', { class: 'osize' }, fmtSize(bytes.length))
          ));
          showStatus(status, `Done — ${pages.length} page(s)`, 'ok');
        }
      } catch (err) {
        console.error(err);
        showStatus(status, 'Error: ' + err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    });

    panel.append(el('div', { class: 'row' }, rangeField), btn, status, output);
    return panel;
  }
});

function parsePageRange(str, total) {
  if (!str) return [];
  const set = new Set();
  for (const part of str.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    for (let i = Math.max(1, a); i <= Math.min(total, b); i++) set.add(i - 1);
  }
  return [...set].sort((x, y) => x - y);
}

/* --- 5c. Rotate PDF --- */
registerTool({
  id: 'rotate',
  title: 'Rotate PDF',
  desc: 'Rotate every page by 90°, 180° or 270°.',
  build() {
    const panel = el('section', { class: 'panel' });
    panel.append(
      el('h1', {}, 'Rotate PDF'),
      el('p', { class: 'desc' }, 'Rotate all pages of a PDF by 90°, 180° or 270° clockwise.')
    );

    const drop = makeDropZone({ multiple: false, accept: 'application/pdf' });
    panel.append(drop.root, drop.listEl);

    const select = el('select', {},
      el('option', { value: '90' }, '90° clockwise'),
      el('option', { value: '180' }, '180°'),
      el('option', { value: '270' }, '270° clockwise')
    );
    const angleField = el('div', { class: 'field' }, el('label', {}, 'Rotation'), select);

    const status = el('div', { class: 'status' });
    const output = el('div', { class: 'output' });
    const btn = el('button', { class: 'btn', disabled: true }, 'Rotate');

    new MutationObserver(() => { btn.disabled = drop.files.length === 0; })
      .observe(drop.listEl, { childList: true });

    btn.addEventListener('click', async () => {
      const file = drop.files[0];
      if (!file) return;
      btn.disabled = true;
      showStatus(status, 'Rotating…');
      output.innerHTML = '';
      try {
        const doc = await loadPdfLib(await readFileBytes(file));
        const add = parseInt(select.value, 10);
        doc.getPages().forEach(p => {
          const cur = p.getRotation().angle || 0;
          p.setRotation(PDFLib.degrees((cur + add) % 360));
        });
        const bytes = await doc.save();
        const name = file.name.replace(/\.pdf$/i, '') + '_rotated.pdf';
        downloadBytes(bytes, name);
        showStatus(status, `Done — ${fmtSize(bytes.length)}`, 'ok');
        output.append(el('div', { class: 'output-item' },
          el('a', { href: '#', onclick: (ev) => { ev.preventDefault(); downloadBytes(bytes, name); } }, name),
          el('span', { class: 'osize' }, fmtSize(bytes.length))
        ));
      } catch (err) {
        console.error(err);
        showStatus(status, 'Error: ' + err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    });

    panel.append(el('div', { class: 'row' }, angleField), btn, status, output);
    return panel;
  }
});

/* --- 5d. PDF → Images --- */
registerTool({
  id: 'thumbs',
  title: 'PDF → Images',
  desc: 'Preview and download each page as a PNG thumbnail.',
  build() {
    const panel = el('section', { class: 'panel' });
    panel.append(
      el('h1', {}, 'PDF → Images'),
      el('p', { class: 'desc' }, 'Renders each page as a PNG. Everything happens in your browser.')
    );

    const drop = makeDropZone({ multiple: false, accept: 'application/pdf' });
    panel.append(drop.root, drop.listEl);

    const scaleField = el('div', { class: 'field' },
      el('label', {}, 'Scale'),
      el('input', { type: 'number', value: '1.5', min: '0.5', max: '4', step: '0.1' })
    );

    const status = el('div', { class: 'status' });
    const grid = el('div', { class: 'thumb-grid' });
    const btn = el('button', { class: 'btn', disabled: true }, 'Render pages');

    new MutationObserver(() => { btn.disabled = drop.files.length === 0; })
      .observe(drop.listEl, { childList: true });

    btn.addEventListener('click', async () => {
      const file = drop.files[0];
      if (!file) return;
      btn.disabled = true;
      grid.innerHTML = '';
      showStatus(status, 'Rendering…');
      try {
        const bytes = await readFileBytes(file);
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        const scale = parseFloat(scaleField.querySelector('input').value) || 1.5;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
          const url = URL.createObjectURL(blob);
          const name = `${file.name.replace(/\.pdf$/i, '')}_page_${i}.png`;
          const img = el('img', { src: url, alt: 'Page ' + i });
          grid.append(el('div', { class: 'th' },
            img,
            el('span', {}, 'Page ' + i),
            el('a', {
              href: url, download: name,
              style: 'font-size:11px;color:var(--brass-dim);display:block;margin-top:4px;',
            }, 'Download')
          ));
        }
        showStatus(status, `Done — ${pdf.numPages} page(s)`, 'ok');
      } catch (err) {
        console.error(err);
        showStatus(status, 'Error: ' + err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    });

    panel.append(el('div', { class: 'row' }, scaleField), btn, status, grid);
    return panel;
  }
});

/* --- 5e. Delete pages --- */
registerTool({
  id: 'delete',
  title: 'Delete pages',
  desc: 'Remove pages by number or range.',
  build() {
    const panel = el('section', { class: 'panel' });
    panel.append(
      el('h1', {}, 'Delete pages'),
      el('p', { class: 'desc' }, 'Enter a page range to remove (e.g. 2-4,7). Everything else is kept.')
    );

    const drop = makeDropZone({ multiple: false, accept: 'application/pdf' });
    panel.append(drop.root, drop.listEl);

    const rangeField = el('div', { class: 'field' },
      el('label', {}, 'Pages to delete'),
      el('input', { type: 'text', placeholder: '2-4,7' })
    );

    const status = el('div', { class: 'status' });
    const output = el('div', { class: 'output' });
    const btn = el('button', { class: 'btn', disabled: true }, 'Delete pages');

    new MutationObserver(() => { btn.disabled = drop.files.length === 0; })
      .observe(drop.listEl, { childList: true });

    btn.addEventListener('click', async () => {
      const file = drop.files[0];
      if (!file) return;
      btn.disabled = true;
      showStatus(status, 'Working…');
      output.innerHTML = '';
      try {
        const src = await loadPdfLib(await readFileBytes(file));
        const total = src.getPageCount();
        const toDelete = new Set(parsePageRange(rangeField.querySelector('input').value, total));
        if (!toDelete.size) throw new Error('No valid pages to delete');
        const keep = [];
        for (let i = 0; i < total; i++) if (!toDelete.has(i)) keep.push(i);
        if (!keep.length) throw new Error('Would delete every page — aborting');
        const out = await PDFLib.PDFDocument.create();
        const copied = await out.copyPages(src, keep);
        copied.forEach(p => out.addPage(p));
        const bytes = await out.save();
        const name = file.name.replace(/\.pdf$/i, '') + '_trimmed.pdf';
        downloadBytes(bytes, name);
        showStatus(status, `Done — kept ${keep.length} of ${total} page(s)`, 'ok');
        output.append(el('div', { class: 'output-item' },
          el('a', { href: '#', onclick: (ev) => { ev.preventDefault(); downloadBytes(bytes, name); } }, name),
          el('span', { class: 'osize' }, fmtSize(bytes.length))
        ));
      } catch (err) {
        console.error(err);
        showStatus(status, 'Error: ' + err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    });

    panel.append(el('div', { class: 'row' }, rangeField), btn, status, output);
    return panel;
  }
});

/* --- 5f. Text → PDF --- */
registerTool({
  id: 'text',
  title: 'Text → PDF',
  desc: 'Type or paste text and download it as a paginated PDF.',
  build() {
    const panel = el('section', { class: 'panel' });
    panel.append(
      el('h1', {}, 'Text → PDF'),
      el('p', { class: 'desc' },
        'Paste text below. Pick the page size, font, size, margins, and whether to paginate automatically.'
      )
    );

    const textarea = el('textarea', {
      placeholder: 'Type or paste your text here…',
      spellcheck: 'false',
    });
    textarea.classList.add('text-input');
    panel.append(textarea);

    const titleInput = el('input', {
      type: 'text',
      placeholder: 'Untitled document',
      style: 'width:220px',
    });

    const pageSelect = el('select', {},
      el('option', { value: 'A4' }, 'A4 (595 × 842)'),
      el('option', { value: 'Letter' }, 'Letter (612 × 792)'),
      el('option', { value: 'Legal' }, 'Legal (612 × 1008)'),
      el('option', { value: 'A5' }, 'A5 (420 × 595)'),
      el('option', { value: 'A3' }, 'A3 (842 × 1191)'),
    );

    const fontSelect = el('select', {},
      el('option', { value: 'Helvetica' }, 'Helvetica'),
      el('option', { value: 'Helvetica-Bold' }, 'Helvetica Bold'),
      el('option', { value: 'Helvetica-Oblique' }, 'Helvetica Italic'),
      el('option', { value: 'Times-Roman' }, 'Times Roman'),
      el('option', { value: 'Times-Bold' }, 'Times Bold'),
      el('option', { value: 'Times-Italic' }, 'Times Italic'),
      el('option', { value: 'Courier' }, 'Courier'),
      el('option', { value: 'Courier-Bold' }, 'Courier Bold'),
    );

    const sizeInput = el('input', { type: 'number', value: '12', min: '6', max: '48', step: '1', style: 'width:80px' });
    const marginInput = el('input', { type: 'number', value: '56', min: '0', max: '200', step: '4', style: 'width:80px' });
    const lineHeightInput = el('input', { type: 'number', value: '1.4', min: '1', max: '3', step: '0.1', style: 'width:80px' });

    const paginateCheck = el('input', { type: 'checkbox' });
    paginateCheck.checked = true;

    panel.append(el('div', { class: 'row' },
      el('div', { class: 'field' }, el('label', {}, 'Title (optional)'), titleInput),
      el('div', { class: 'field' }, el('label', {}, 'Page size'), pageSelect),
      el('div', { class: 'field' }, el('label', {}, 'Font'), fontSelect),
      el('div', { class: 'field' }, el('label', {}, 'Font size'), sizeInput),
      el('div', { class: 'field' }, el('label', {}, 'Line height'), lineHeightInput),
      el('div', { class: 'field' }, el('label', {}, 'Margin (pt)'), marginInput),
    ));

    panel.append(el('label', { class: 'checkbox-row' },
      paginateCheck,
      el('span', {}, 'Paginate (add new pages when text overflows)')
    ));

    const status = el('div', { class: 'status' });
    const output = el('div', { class: 'output' });
    const btn = el('button', { class: 'btn' }, 'Create PDF');

    const PAGE_SIZES = {
      A4: [595.28, 841.89],
      Letter: [612, 792],
      Legal: [612, 1008],
      A5: [419.53, 595.28],
      A3: [841.89, 1190.55],
    };

    // Map UI value -> PDFLib.StandardFonts key
    const FONT_KEYS = {
      'Helvetica': 'Helvetica',
      'Helvetica-Bold': 'HelveticaBold',
      'Helvetica-Oblique': 'HelveticaOblique',
      'Times-Roman': 'TimesRoman',
      'Times-Bold': 'TimesRomanBold',
      'Times-Italic': 'TimesRomanItalic',
      'Courier': 'Courier',
      'Courier-Bold': 'CourierBold',
    };

    btn.addEventListener('click', async () => {
      const raw = textarea.value;
      if (!raw.trim()) {
        showStatus(status, 'Please enter some text first.', 'err');
        return;
      }
      btn.disabled = true;
      showStatus(status, 'Building PDF…');
      output.innerHTML = '';

      try {
        const doc = await PDFLib.PDFDocument.create();
        const font = await doc.embedFont(PDFLib.StandardFonts[FONT_KEYS[fontSelect.value]]);

        const [w, h] = PAGE_SIZES[pageSelect.value] || PAGE_SIZES.A4;
        const size = parseFloat(sizeInput.value) || 12;
        const margin = parseFloat(marginInput.value) || 56;
        const lineHeight = size * (parseFloat(lineHeightInput.value) || 1.4);
        const maxWidth = w - margin * 2;
        const paginate = paginateCheck.checked;

        const title = titleInput.value.trim();
        let page = doc.addPage([w, h]);
        let cursorY = h - margin;

        if (title) {
          const titleSize = Math.min(22, size * 1.6);
          page.drawText(title, {
            x: margin,
            y: cursorY - titleSize,
            size: titleSize,
            font,
            color: PDFLib.rgb(0.1, 0.13, 0.18),
          });
          cursorY -= titleSize + size * 0.8;
        }

        // Wrap text into lines that fit maxWidth
        const paragraphs = raw.replace(/\r\n?/g, '\n').split('\n');
        const wrapped = [];
        for (const para of paragraphs) {
          if (!para.trim()) { wrapped.push(''); continue; }
          const words = para.split(/\s+/);
          let line = '';
          for (const word of words) {
            const candidate = line ? line + ' ' + word : word;
            if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
              line = candidate;
            } else {
              if (line) wrapped.push(line);
              if (font.widthOfTextAtSize(word, size) > maxWidth) {
                let chunk = '';
                for (const ch of word) {
                  if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) {
                    chunk += ch;
                  } else {
                    wrapped.push(chunk);
                    chunk = ch;
                  }
                }
                line = chunk;
              } else {
                line = word;
              }
            }
          }
          if (line) wrapped.push(line);
        }

        let pageNum = 1;
        for (const line of wrapped) {
          const baseline = cursorY - size;
          if (baseline < margin) {
            if (!paginate) break;
            page = doc.addPage([w, h]);
            cursorY = h - margin;
            pageNum++;
          }
          if (line) {
            page.drawText(line, {
              x: margin,
              y: cursorY - size,
              size,
              font,
              color: PDFLib.rgb(0.1, 0.13, 0.18),
            });
          }
          cursorY -= lineHeight;
        }

        // Page-number footer for multi-page
        if (pageNum > 1) {
          const pages = doc.getPages();
          const footerSize = Math.max(8, size * 0.75);
          pages.forEach((p, idx) => {
            const text = `${idx + 1} / ${pages.length}`;
            const tw = font.widthOfTextAtSize(text, footerSize);
            p.drawText(text, {
              x: (w - tw) / 2,
              y: margin / 2,
              size: footerSize,
              font,
              color: PDFLib.rgb(0.4, 0.4, 0.4),
            });
          });
        }

        const bytes = await doc.save();
        const safeTitle = (title || 'text').replace(/[^\w\-]+/g, '_').slice(0, 60);
        const name = `${safeTitle}.pdf`;
        downloadBytes(bytes, name);

        const pageCount = doc.getPageCount();
        showStatus(status, `Done — ${pageCount} page(s), ${fmtSize(bytes.length)}`, 'ok');
        output.append(el('div', { class: 'output-item' },
          el('a', {
            href: '#',
            onclick: (ev) => { ev.preventDefault(); downloadBytes(bytes, name); },
          }, name),
          el('span', { class: 'osize' }, fmtSize(bytes.length))
        ));
      } catch (err) {
        console.error(err);
        showStatus(status, 'Error: ' + err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    });

    panel.append(btn, status, output);
    return panel;
  }
});

/* ---------- 6. Bootstrap the UI ---------- */

function buildRail() {
  const rail = document.getElementById('rail');
  const foot = rail.querySelector('.rail-foot');

  TOOLS.forEach((tool) => {
    const btn = el('button', { class: 'tool-btn', 'data-tool': tool.id },
      el('span', {}, tool.title)
    );
    btn.addEventListener('click', () => selectTool(tool.id));
    rail.insertBefore(btn, foot);
  });
}

function buildPanels() {
  const main = document.getElementById('main');
  TOOLS.forEach((tool) => {
    const panel = tool.build();
    panel.id = 'panel-' + tool.id;
    main.append(panel);
  });
}

function selectTool(id) {
  document.querySelectorAll('.tool-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === id);
  });
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.toggle('active', p.id === 'panel-' + id);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  if (typeof PDFLib === 'undefined') {
    document.getElementById('main').innerHTML =
      '<p class="status err">pdf-lib failed to load. Check vendor/pdf-lib.min.js.</p>';
    return;
  }
  if (typeof pdfjsLib === 'undefined') {
    console.warn('pdf.js failed to load — PDF→Images tool will not work.');
  }
  buildRail();
  buildPanels();
  if (TOOLS.length) selectTool(TOOLS[0].id);
});