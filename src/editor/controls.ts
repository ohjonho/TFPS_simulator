// The left control panel: brush palette, undo/redo/fill, reference-image
// alignment sliders, paste-to-load, live validation, and export. Owns all the
// DOM in the sidebar; `update()` re-reads the model and refreshes the dynamic
// bits (validation, export preview, brush highlight, undo/redo enablement).

import type { HexCoord, MapDefinition } from '../game/types.ts';
import { PALETTE, ERASER_CHAR } from './legend.ts';
import type { EditorModel } from './model.ts';
import type { EditorView } from './view.ts';
import { parsePastedGrid } from './parse.ts';
import { validate } from './validate.ts';
import { mapFileBody, rowsLiteral } from './exporter.ts';

type MapCharacter = MapDefinition['character'];

export type ControlsOptions = {
  model: EditorModel;
  view: EditorView;
  /** Called after any change that affects the grid (revalidate + redraw). */
  onChange: () => void;
};

// --- tiny DOM helpers ------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { class?: string; text?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  for (const c of children) node.append(c);
  return node;
}

function section(title: string, ...children: Node[]): HTMLElement {
  return el('section', { class: 'ed-section' }, [el('h2', { text: title }), ...children]);
}

export class EditorControls {
  private readonly model: EditorModel;
  private readonly view: EditorView;
  private readonly onChange: () => void;

  private readonly brushButtons = new Map<string, HTMLButtonElement>();
  private readonly hoverReadout = el('span', { class: 'ed-hover', text: 'hover: —' });
  private readonly undoBtn = el('button', { text: 'Undo' });
  private readonly redoBtn = el('button', { text: 'Redo' });
  private readonly validationBox = el('div', { class: 'ed-validation' });
  private readonly pasteStatus = el('div', { class: 'ed-note' });
  private readonly nameInput = el('input');
  private readonly characterSelect = el('select');
  private readonly exportStatus = el('span', { class: 'ed-note' });
  private readonly exportPreview = el('pre', { class: 'ed-preview' });

  constructor(host: HTMLElement, opts: ControlsOptions) {
    this.model = opts.model;
    this.view = opts.view;
    this.onChange = opts.onChange;

    host.append(
      this.buildHeader(),
      this.buildPalette(),
      this.buildTools(),
      this.buildImageControls(),
      this.buildLoad(),
      section('Validation', this.validationBox),
      this.buildExport(),
    );

    this.update();
  }

  /** Update the dynamic UI from current model state. */
  update(): void {
    this.refreshBrushHighlight();
    this.undoBtn.disabled = !this.model.canUndo();
    this.redoBtn.disabled = !this.model.canRedo();
    this.renderValidation();
    this.renderExportPreview();
  }

  /** Update the hover readout (called by the view). */
  setHover(hex: HexCoord | null): void {
    this.hoverReadout.textContent = hex ? `hover: { col: ${hex.col}, row: ${hex.row} }` : 'hover: —';
  }

  // --- sections ------------------------------------------------------------

  private buildHeader(): HTMLElement {
    return el('header', { class: 'ed-header' }, [
      el('h1', { text: 'Hex Map Editor' }),
      el('p', { class: 'ed-sub', text: '30 × 40 pointy-top grid · defenders north, attackers south' }),
      this.hoverReadout,
    ]);
  }

  private buildPalette(): HTMLElement {
    const grid = el('div', { class: 'ed-palette' });
    for (const entry of PALETTE) {
      const swatch = el('span', { class: 'ed-swatch', text: entry.char });
      swatch.style.background = entry.fill;
      swatch.style.borderColor = entry.stroke;
      const btn = el('button', { class: 'ed-brush' }, [swatch, el('span', { text: `${entry.char}  ${entry.label}` })]);
      btn.title = `Paint ${entry.label} (${entry.char})`;
      btn.addEventListener('click', () => this.setBrush(entry.char));
      this.brushButtons.set(entry.char, btn);
      grid.append(btn);
    }
    const eraser = el('button', { class: 'ed-eraser', text: `Eraser → open (${ERASER_CHAR})` });
    eraser.addEventListener('click', () => this.setBrush(ERASER_CHAR));
    return section('Brush', grid, eraser);
  }

  private buildTools(): HTMLElement {
    this.undoBtn.addEventListener('click', () => {
      this.model.undo();
      this.onChange();
    });
    this.redoBtn.addEventListener('click', () => {
      this.model.redo();
      this.onChange();
    });
    const fillBrush = el('button', { text: 'Fill all with brush' });
    fillBrush.addEventListener('click', () => {
      this.model.fillAll(this.model.brush);
      this.onChange();
    });
    const reset = el('button', { text: 'Reset to all wall (#)' });
    reset.addEventListener('click', () => {
      this.model.fillAll('#');
      this.onChange();
    });

    // Show-codes toggle: overlays each cell's legend char (sub-zones share
    // CellType colors, so the char is the only way to read them apart).
    const labelToggle = el('label', { class: 'ed-check' });
    const labelCheck = el('input');
    labelCheck.type = 'checkbox';
    labelCheck.checked = this.model.showLabels;
    labelCheck.addEventListener('change', () => {
      this.model.showLabels = labelCheck.checked;
      this.view.requestRender();
    });
    labelToggle.append(labelCheck, el('span', { text: 'Show cell codes' }));

    return section(
      'Tools',
      el('div', { class: 'ed-row' }, [this.undoBtn, this.redoBtn]),
      el('div', { class: 'ed-row' }, [fillBrush, reset]),
      labelToggle,
      el('p', { class: 'ed-note', text: 'Click + drag to paint. Ctrl+Z / Ctrl+Y to undo / redo.' }),
    );
  }

  private buildImageControls(): HTMLElement {
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.addEventListener('change', () => this.onImageFile(file));

    const opacity = this.range('Image opacity', 0, 1, 0.01, this.model.image.opacity, (v) => {
      this.model.image.opacity = v;
      this.view.requestRender();
    });
    const scale = this.range('Image scale', 0.05, 4, 0.01, this.model.image.scale, (v) => {
      this.model.image.scale = v;
      this.view.requestRender();
    });
    const offX = this.range('Image offset X', -this.view.cssWidth, this.view.cssWidth, 1, 0, (v) => {
      this.model.image.offsetX = v;
      this.view.requestRender();
    });
    const offY = this.range('Image offset Y', -this.view.cssHeight, this.view.cssHeight, 1, 0, (v) => {
      this.model.image.offsetY = v;
      this.view.requestRender();
    });
    const gridOpacity = this.range('Grid fill opacity', 0, 1, 0.05, this.model.gridOpacity, (v) => {
      this.model.gridOpacity = v;
      this.view.requestRender();
    });

    // Keep handles so loading an image can resync the sliders to the fitted values.
    this.imageSliders = { scale: scale.input, offX: offX.input, offY: offY.input };

    const clear = el('button', { text: 'Clear image' });
    clear.addEventListener('click', () => {
      file.value = '';
      this.view.setImage(null);
    });

    return section(
      'Reference image',
      file,
      opacity.wrap,
      scale.wrap,
      offX.wrap,
      offY.wrap,
      gridOpacity.wrap,
      clear,
      el('p', { class: 'ed-note', text: 'Load a PNG, fade the grid, and align the hexes over your drawing to trace.' }),
    );
  }

  private buildLoad(): HTMLElement {
    const textarea = el('textarea', { class: 'ed-paste' });
    textarea.placeholder = "Paste a string[] (e.g. Canyon's rows / SEGMENTS) or 40 raw lines, then Load.";
    textarea.rows = 6;
    const load = el('button', { text: 'Load grid' });
    load.addEventListener('click', () => this.onLoad(textarea.value));
    return section('Load existing grid', textarea, load, this.pasteStatus);
  }

  private buildExport(): HTMLElement {
    this.nameInput.type = 'text';
    this.nameInput.value = 'NewMap';
    this.nameInput.addEventListener('input', () => this.renderExportPreview());

    for (const c of ['open_sightlines', 'tight_corridors_asymmetric'] as MapCharacter[]) {
      this.characterSelect.append(el('option', { text: c }));
    }
    this.characterSelect.addEventListener('change', () => this.renderExportPreview());

    const copyRows = el('button', { text: 'Copy rows (string[])' });
    copyRows.addEventListener('click', () => this.copy(rowsLiteral(this.model.toRows())));
    const copyFile = el('button', { text: 'Copy src/maps/<name>.ts' });
    copyFile.addEventListener('click', () => this.copy(this.fileBody()));

    return section(
      'Export',
      el('label', { class: 'ed-field' }, [el('span', { text: 'name' }), this.nameInput]),
      el('label', { class: 'ed-field' }, [el('span', { text: 'character' }), this.characterSelect]),
      el('div', { class: 'ed-row' }, [copyRows, copyFile, this.exportStatus]),
      this.exportPreview,
    );
  }

  // --- behavior ------------------------------------------------------------

  private imageSliders: { scale: HTMLInputElement; offX: HTMLInputElement; offY: HTMLInputElement } | null = null;

  private setBrush(char: string): void {
    this.model.brush = char;
    this.refreshBrushHighlight();
  }

  private refreshBrushHighlight(): void {
    for (const [char, btn] of this.brushButtons) {
      btn.classList.toggle('active', char === this.model.brush);
    }
  }

  private onImageFile(input: HTMLInputElement): void {
    const f = input.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      // Default alignment: fit the drawing's width to the grid, no offset.
      const fitScale = img.naturalWidth > 0 ? this.view.cssWidth / img.naturalWidth : 1;
      this.model.image = { opacity: this.model.image.opacity, scale: fitScale, offsetX: 0, offsetY: 0 };
      if (this.imageSliders) {
        this.imageSliders.scale.value = String(fitScale);
        this.imageSliders.offX.value = '0';
        this.imageSliders.offY.value = '0';
      }
      this.view.setImage(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  private onLoad(text: string): void {
    const rows = parsePastedGrid(text);
    const result = validate(rows);
    if (!result.parsed) {
      this.pasteStatus.textContent = `Could not load: ${result.error}`;
      this.pasteStatus.classList.add('bad');
      return;
    }
    this.model.loadRows(rows);
    this.pasteStatus.textContent = `Loaded ${rows.length} rows.`;
    this.pasteStatus.classList.remove('bad');
    this.onChange();
  }

  private renderValidation(): void {
    const result = validate(this.model.toRows());
    this.validationBox.replaceChildren();

    const status = el('div', {
      class: `ed-status ${result.ok ? 'ok' : 'bad'}`,
      text: result.ok ? '✓ Valid, usable map' : result.parsed ? '⚠ Parses, but not yet usable' : '✗ Invalid grid',
    });
    this.validationBox.append(status);

    const checks = el('ul', { class: 'ed-checks' });
    for (const c of result.checks) {
      const li = el('li', { class: c.ok ? 'ok' : 'bad' });
      li.append(el('span', { text: c.ok ? '✓ ' : '✗ ' }), el('span', { text: c.label }));
      if (c.detail) li.append(el('span', { class: 'ed-detail', text: ` — ${c.detail}` }));
      checks.append(li);
    }
    this.validationBox.append(checks);

    const counts = el('div', { class: 'ed-counts' }, [el('strong', { text: 'Region cells: ' })]);
    counts.append(result.regionCounts.map((r) => `${r.name}=${r.count}`).join('  ·  '));
    this.validationBox.append(counts);

    if (result.sites) {
      const a = result.sites.A;
      const b = result.sites.B;
      this.validationBox.append(
        el('div', {
          class: 'ed-counts',
          text: `Site centers: A {col:${a.col}, row:${a.row}}  ·  B {col:${b.col}, row:${b.row}}`,
        }),
      );
    }
  }

  private renderExportPreview(): void {
    this.exportPreview.textContent = this.fileBody();
  }

  private fileBody(): string {
    return mapFileBody(this.nameInput.value, this.characterSelect.value as MapCharacter, this.model.toRows());
  }

  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.exportStatus.textContent = 'Copied ✓';
    } catch {
      this.exportStatus.textContent = 'Copy failed — select the preview and copy manually';
    }
    setTimeout(() => {
      this.exportStatus.textContent = '';
    }, 2500);
  }

  private range(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onInput: (v: number) => void,
  ): { wrap: HTMLElement; input: HTMLInputElement } {
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const valueLabel = el('span', { class: 'ed-rangeval', text: value.toFixed(2) });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      valueLabel.textContent = v.toFixed(2);
      onInput(v);
    });
    const wrap = el('label', { class: 'ed-range' }, [
      el('span', { class: 'ed-rangelabel', text: label }),
      input,
      valueLabel,
    ]);
    return { wrap, input };
  }
}
