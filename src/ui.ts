/**
 * 左カラムの UI 構築とイベント配線、および全体のオーケストレーションを担当する。
 *
 * 画面は 2 カラム構成:
 *   - 左: 表示範囲調整・色選択・ツール・ガイド画像・ファイル操作
 *   - 右: 編集用キャンバス（表示範囲）
 */

import {
  EditorState,
  rgbToHex,
  hexToRgb,
  type RGB,
  type Tool,
} from './editor-state';
import { CanvasRenderer } from './canvas-renderer';
import { Viewport, type Direction } from './viewport';
import { InputHandler } from './input-handler';
import { Minimap } from './minimap';
import { AnimationPreview } from './animation-preview';
import { exportPng, importPng, importPngFromUrl, loadGuideImage, loadGuideImageFromUrl } from './file-io';
import { siteConfig } from './site-config';

/** よく使う色のプリセット（黒は透過のため除外） */
const PRESET_COLORS = [
  '#ffffff', '#c0c0c0', '#808080', '#ff0000', '#ff8000', '#ffff00',
  '#00ff00', '#00ffff', '#0000ff', '#8000ff', '#ff00ff', '#804000',
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** エディタアプリ全体を root に構築する */
export function buildEditor(root: HTMLElement): void {
  const state = new EditorState();
  const viewport = new Viewport(state);

  // ---- レイアウト ----
  const layout = el('div', 'editor-layout');
  const leftPanel = el('aside', 'left-panel');
  const rightPanel = el('main', 'right-panel');
  const canvasWrap = el('div', 'canvas-wrap');
  const canvas = el('canvas', 'editor-canvas');
  canvasWrap.appendChild(canvas);
  rightPanel.appendChild(canvasWrap);
  const colorStripPanel = el('div', 'color-strip-panel');
  layout.appendChild(leftPanel);
  layout.appendChild(colorStripPanel);
  layout.appendChild(rightPanel);
  root.appendChild(layout);

  const renderer = new CanvasRenderer(canvas, state);

  // 全体マップ（現在の表示位置を示す）
  const minimap = new Minimap(rightPanel, state, (docX, docY) => {
    viewport.centerOn(docX, docY);
    render();
    updateInfo();
  });
  makeDraggable(minimap.panel, minimap.panel.querySelector('.minimap-title') as HTMLElement);

  // アニメーションプレビュー
  const animPreview = new AnimationPreview(rightPanel, state);
  // 全体マップと重ならない初期位置
  animPreview.panel.style.top = '16px';
  animPreview.panel.style.right = '260px';
  makeDraggable(animPreview.panel, animPreview.panel.querySelector('.minimap-title') as HTMLElement);

  const render = () => {
    renderer.render();
    minimap.update();
    updateUsedColors?.();
  };
  // 使用中の色パレットの更新関数（後で定義）
  let updateUsedColors: (() => void) | null = null;
  const refreshSize = () => {
    renderer.resize();
    render();
    animPreview.onViewportChange();
  };

  // ---- サイト名 ----
  const siteTitle = el('div', 'site-title', 'DotArt Editer');
  leftPanel.appendChild(siteTitle);

  // ---- ツール選択 ----
  const toolSection = section('ツール');
  const toolButtons: Record<Tool, HTMLButtonElement> = {
    pen: toolButton('ペン', 'pen'),
    eraser: toolButton('消しゴム', 'eraser'),
    picker: toolButton('スポイト', 'picker'),
    select: toolButton('選択', 'select'),
    darken: toolButton('▼ 暗く', 'darken'),
    brighten: toolButton('▲ 明るく', 'brighten'),
    smooth: toolButton('スムース', 'smooth'),
  };
  const toolRow = el('div', 'btn-row');
  (['pen', 'eraser', 'picker', 'select'] as Tool[]).forEach((t) =>
    toolRow.appendChild(toolButtons[t]),
  );
  toolSection.appendChild(toolRow);
  const brightnessToolRow = el('div', 'btn-row');
  brightnessToolRow.style.marginTop = '6px';
  (['darken', 'brighten', 'smooth'] as Tool[]).forEach((t) =>
    brightnessToolRow.appendChild(toolButtons[t]),
  );
  toolSection.appendChild(brightnessToolRow);
  // スムース採用率スライダー
  const smoothRatio = sliderField('スムース: 現在色の採用率', 80, 0, 100);
  smoothRatio.value.textContent = '80%';
  smoothRatio.input.addEventListener('input', () => {
    const v = parseInt(smoothRatio.input.value, 10);
    state.smoothCenterRatio = v / 100;
    smoothRatio.value.textContent = `${v}%`;
  });
  toolSection.appendChild(smoothRatio.wrap);
  const toolHint = el(
    'div',
    'info-text',
    '選択ツールで範囲をドラッグ → Ctrl+C でコピー / Ctrl+X で切り取り / Ctrl+M で移動 / Ctrl+H で左右反転 / Ctrl+V で貼り付け（クリックで配置、Esc で解除）',
  );
  toolSection.appendChild(toolHint);
  leftPanel.appendChild(toolSection);

  function toolButton(label: string, tool: Tool): HTMLButtonElement {
    const b = el('button', 'tool-btn', label);
    b.type = 'button';
    b.addEventListener('click', () => setTool(tool));
    return b;
  }
  function setTool(tool: Tool): void {
    state.currentTool = tool;
    state.pasting = false; // ツール切替で貼り付けモードを解除
    (Object.keys(toolButtons) as Tool[]).forEach((t) =>
      toolButtons[t].classList.toggle('active', t === tool),
    );
    render();
  }

  // ---- 色選択 ----
  const colorSection = section('色');
  const colorInput = el('input', 'color-input') as HTMLInputElement;
  colorInput.type = 'color';
  colorInput.value = rgbToHex(state.currentColor);
  const colorRow = el('div', 'color-row');
  const colorLabel = el('span', 'color-label', colorInput.value);
  colorRow.appendChild(colorInput);
  colorRow.appendChild(colorLabel);
  colorSection.appendChild(colorRow);

  const setColor = (c: RGB) => {
    state.currentColor = c;
    const hex = rgbToHex(c);
    colorInput.value = hex;
    colorLabel.textContent = hex;
  };
  colorInput.addEventListener('input', () => {
    setColor(hexToRgb(colorInput.value));
    setTool('pen');
  });

  // プリセットパレット
  const palette = el('div', 'palette');
  PRESET_COLORS.forEach((hex) => {
    const sw = el('button', 'swatch');
    sw.type = 'button';
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', () => {
      setColor(hexToRgb(hex));
      setTool('pen');
    });
    palette.appendChild(sw);
  });
  colorSection.appendChild(palette);
  leftPanel.appendChild(colorSection);

  updateUsedColors = () => {
    const { offsetX, offsetY, viewCols, viewRows, buffer, docWidth, docHeight } = state;
    // 5%程度の差を同じ色とみなすバケット幅（255×0.05≈ 13）
    const B = 13;
    const bch = (v: number) => Math.min(255, Math.round(v / B) * B);
    const bkey = (r: number, g: number, b: number) => `${bch(r)},${bch(g)},${bch(b)}`;
    // プリセット色も同じバケットで比較して除外
    const presetSet = new Set(PRESET_COLORS.map((h) => {
      const c = hexToRgb(h);
      return bkey(c.r, c.g, c.b);
    }));
    const seen = new Set<string>();
    const colors: RGB[] = [];
    outer: for (let row = 0; row < viewRows; row++) {
      const docY = offsetY + row;
      if (docY < 0 || docY >= docHeight) continue;
      for (let col = 0; col < viewCols; col++) {
        const docX = offsetX + col;
        if (docX < 0 || docX >= docWidth) continue;
        const si = (docY * docWidth + docX) * 4;
        const r = buffer[si], g = buffer[si + 1], b = buffer[si + 2];
        if (r === 0 && g === 0 && b === 0) continue;
        const k = bkey(r, g, b);
        if (!seen.has(k) && !presetSet.has(k)) {
          seen.add(k);
          // 代表色はバケット中心値を使用
          colors.push({ r: bch(r), g: bch(g), b: bch(b) });
          if (colors.length >= 120) break outer;
        }
      }
    }
    colorStripPanel.innerHTML = '';
    if (colors.length === 0) return;
    // 色相・彩度・輝度で系統ソート（無彩色は末尾に輝度順）
    const toHsl = (c: RGB): [number, number, number] => {
      const r = c.r / 255, g = c.g / 255, b = c.b / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const l = (max + min) / 2;
      if (max === min) return [0, 0, l];
      const d = max - min;
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      let h = 0;
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return [h / 6 * 360, s, l];
    };
    colors.sort((a, b) => {
      const [ah, as_, al] = toHsl(a);
      const [bh, bs, bl] = toHsl(b);
      const aGray = as_ < 0.1, bGray = bs < 0.1;
      if (aGray !== bGray) return aGray ? 1 : -1; // 無彩色を末尾へ
      if (aGray && bGray) return al - bl;          // 無彩色同士は輝度順
      if (Math.abs(ah - bh) > 1) return ah - bh;  // 有彩色は色相順
      if (Math.abs(as_ - bs) > 0.05) return bs - as_; // 彩度降順
      return al - bl;                               // 輝度昇順
    });
    colors.forEach((c) => {
      const sw = el('button', 'strip-swatch');
      sw.type = 'button';
      sw.style.background = rgbToHex(c);
      sw.title = rgbToHex(c);
      sw.addEventListener('click', () => { setColor(c); setTool('pen'); });
      colorStripPanel.appendChild(sw);
    });
  };

  // ---- 表示範囲 ----
  const viewSection = section('表示範囲');
  const rowsInput = numberField('縦（行）', state.viewRows, 1, state.docHeight);
  const colsInput = numberField('横（列）', state.viewCols, 1, state.docWidth);
  viewSection.appendChild(rowsInput.wrap);
  viewSection.appendChild(colsInput.wrap);
  const applyViewBtn = el('button', 'wide-btn', '表示範囲を適用');
  applyViewBtn.type = 'button';
  applyViewBtn.addEventListener('click', () => {
    viewport.setViewSize(
      parseInt(colsInput.input.value, 10) || state.viewCols,
      parseInt(rowsInput.input.value, 10) || state.viewRows,
    );
    refreshSize();
    updateInfo();
  });
  viewSection.appendChild(applyViewBtn);

  // ズーム
  const zoom = sliderField('ズーム（ドット表示px）', state.cellSize, 1, 40);
  zoom.input.addEventListener('input', () => {
    viewport.setCellSize(parseInt(zoom.input.value, 10));
    zoom.value.textContent = String(state.cellSize);
    refreshSize();
  });
  viewSection.appendChild(zoom.wrap);
  leftPanel.appendChild(viewSection);

  // ---- 移動（ページ送り） ----
  const moveSection = section('表示範囲の移動');
  const dpad = el('div', 'dpad');
  const mkMove = (label: string, dir: Direction, cls: string) => {
    const b = el('button', `dpad-btn ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', () => {
      viewport.move(dir);
      render();
      updateInfo();
    });
    return b;
  };
  dpad.appendChild(mkMove('↑', 'up', 'up'));
  dpad.appendChild(mkMove('←', 'left', 'left'));
  dpad.appendChild(mkMove('→', 'right', 'right'));
  dpad.appendChild(mkMove('↓', 'down', 'down'));
  moveSection.appendChild(dpad);
  const info = el('div', 'info-text');
  moveSection.appendChild(info);
  leftPanel.appendChild(moveSection);

  function updateInfo(): void {
    info.textContent =
      `位置 X:${state.offsetX} Y:${state.offsetY} / ` +
      `範囲 ${state.viewCols}×${state.viewRows}`;
  }

  // グリッド表示トグル
  const gridToggle = checkboxField('グリッド線を表示', state.showGrid);
  gridToggle.input.addEventListener('change', () => {
    state.showGrid = gridToggle.input.checked;
    render();
  });
  moveSection.appendChild(gridToggle.wrap);

  // ---- アニメーションプレビュー ----
  const previewSection = section('プレビュー');
  const previewBtn = el('button', 'wide-btn', 'アニメーションプレビュー');
  previewBtn.type = 'button';
  previewBtn.addEventListener('click', () => {
    const nowVisible = animPreview.toggle();
    previewBtn.classList.toggle('active', nowVisible);
  });
  previewSection.appendChild(previewBtn);
  leftPanel.appendChild(previewSection);

  // ---- ガイド画像 ----
  const guideSection = section('ガイド画像（テンプレート）');
  const guideFile = el('input') as HTMLInputElement;
  guideFile.type = 'file';
  guideFile.accept = 'image/*';
  guideFile.className = 'file-input';
  guideFile.addEventListener('change', async () => {
    const f = guideFile.files?.[0];
    if (!f) return;
    await loadGuideImage(state, f);
    state.showGuide = true;
    guideToggle.input.checked = true;
    render();
  });
  guideSection.appendChild(guideFile);

  const guideToggle = checkboxField('ガイドを表示', state.showGuide);
  guideToggle.input.addEventListener('change', () => {
    state.showGuide = guideToggle.input.checked;
    render();
  });
  guideSection.appendChild(guideToggle.wrap);

  const guideOpacity = sliderField('ガイド不透明度', state.guideOpacity * 100, 0, 100);
  guideOpacity.input.addEventListener('input', () => {
    state.guideOpacity = parseInt(guideOpacity.input.value, 10) / 100;
    guideOpacity.value.textContent = `${guideOpacity.input.value}%`;
    render();
  });
  guideOpacity.value.textContent = `${Math.round(state.guideOpacity * 100)}%`;
  guideSection.appendChild(guideOpacity.wrap);

  const clearGuideBtn = el('button', 'wide-btn', 'ガイドを消去');
  clearGuideBtn.type = 'button';
  clearGuideBtn.addEventListener('click', () => {
    state.guideImage = null;
    guideFile.value = '';
    render();
  });
  guideSection.appendChild(clearGuideBtn);
  leftPanel.appendChild(guideSection);

  // ---- ファイル操作 ----
  const fileSection = section('ファイル');
  const saveBtn = el('button', 'wide-btn primary', 'PNG で保存');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => exportPng(state));
  fileSection.appendChild(saveBtn);

  const openLabel = el('label', 'wide-btn file-label', 'PNG を読み込み');
  const openFile = el('input') as HTMLInputElement;
  openFile.type = 'file';
  openFile.accept = 'image/png';
  openFile.hidden = true;
  openFile.addEventListener('change', async () => {
    const f = openFile.files?.[0];
    if (!f) return;
    await importPng(state, f);
    openFile.value = '';
    render();
  });
  openLabel.appendChild(openFile);
  fileSection.appendChild(openLabel);

  // サンプル画像の読み込み（site-config.ts で URL を設定）
  if (siteConfig.sampleImageUrl) {
    const sampleLoadBtn = el('button', 'wide-btn', 'サンプルから読み込み（編集）');
    sampleLoadBtn.type = 'button';
    sampleLoadBtn.addEventListener('click', async () => {
      await importPngFromUrl(state, siteConfig.sampleImageUrl);
      render();
    });
    fileSection.appendChild(sampleLoadBtn);

    const sampleTemplateBtn = el('button', 'wide-btn', 'サンプルをテンプレートに');
    sampleTemplateBtn.type = 'button';
    sampleTemplateBtn.addEventListener('click', async () => {
      await loadGuideImageFromUrl(state, siteConfig.sampleImageUrl);
      state.showGuide = true;
      guideToggle.input.checked = true;
      render();
    });
    fileSection.appendChild(sampleTemplateBtn);
  }

  // images/ ディレクトリのイメージライブラリ（site-config.ts で切り替え可能）
  if (siteConfig.showImageLibrary) {
    const imageLibUrls = import.meta.glob('/images/*.png', {
      query: '?url',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const imageLibEntries = Object.entries(imageLibUrls);
    if (imageLibEntries.length > 0) {
      fileSection.appendChild(el('div', 'field-label', 'images/ ライブラリ'));
      const libSelect = el('select', 'image-lib-select') as HTMLSelectElement;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '-- ファイルを選択 --';
      libSelect.appendChild(placeholder);
      imageLibEntries.forEach(([path, url]) => {
        const opt = document.createElement('option');
        opt.value = url as string;
        opt.textContent = path.split('/').pop() ?? path;
        libSelect.appendChild(opt);
      });
      libSelect.addEventListener('change', async () => {
        const url = libSelect.value;
        if (!url) return;
        await importPngFromUrl(state, url);
        libSelect.value = '';
        render();
      });
      fileSection.appendChild(libSelect);
    }
  }

  const clearBtn = el('button', 'wide-btn danger', '全消去');
  clearBtn.type = 'button';
  clearBtn.addEventListener('click', () => {
    if (confirm('編集中の内容をすべて消去しますか？')) {
      state.clear();
      render();
    }
  });
  fileSection.appendChild(clearBtn);
  leftPanel.appendChild(fileSection);

  // ---- GitHub リンク / X 共有ボタン ----
  const linkRow = el('div', 'link-row');

  const githubLink = document.createElement('a');
  githubLink.className = 'github-link';
  githubLink.href = 'https://github.com/Octo8080X/dot_art_editer';
  githubLink.target = '_blank';
  githubLink.rel = 'noopener noreferrer';
  githubLink.textContent = 'GitHub: dot_art_editer';
  linkRow.appendChild(githubLink);

  const xShareLink = document.createElement('a');
  const xUrl = new URL('https://twitter.com/intent/tweet');
  xUrl.searchParams.set('url', 'https://octo8080x.github.io/dot_art_editer/');
  xUrl.searchParams.set('text', 'DotArt Editer - ブラウザで動作するドット絵エディタ');
  xShareLink.className = 'x-share-btn';
  xShareLink.href = xUrl.href;
  xShareLink.target = '_blank';
  xShareLink.rel = 'noopener noreferrer';
  xShareLink.textContent = '𝕏 シェア';
  linkRow.appendChild(xShareLink);

  leftPanel.appendChild(linkRow);

  // ---- 入力ハンドラ ----
  new InputHandler(canvas, state, {
    onChange: render,
    onColorPicked: setColor,
  });

  // ---- キーボードショートカット（コピー / 切り取り / ペースト / 解除） ----
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'c') {
      if (state.selection) {
        state.copySelection();
        e.preventDefault();
      }
    } else if ((e.ctrlKey || e.metaKey) && key === 'x') {
      if (state.selection) {
        state.cutSelection();
        render();
        e.preventDefault();
      }
    } else if ((e.ctrlKey || e.metaKey) && key === 'm') {
      if (state.selection) {
        state.beginMove();
        render();
        e.preventDefault();
      }
    } else if ((e.ctrlKey || e.metaKey) && key === 'h') {
      if (state.selection) {
        state.flipSelectionHorizontal();
        render();
        e.preventDefault();
      }
    } else if ((e.ctrlKey || e.metaKey) && key === 'v') {
      if (state.clipboard) {
        state.pasting = true;
        // 初期プレビュー位置は選択範囲の左上、無ければ表示範囲の左上
        state.pastePos = state.selection
          ? { x: state.selection.x, y: state.selection.y }
          : { x: state.offsetX, y: state.offsetY };
        render();
        e.preventDefault();
      }
    } else if (key === 'escape') {
      if (state.moving) {
        state.cancelMove();
      }
      state.pasting = false;
      state.selection = null;
      render();
    }
  });

  // ---- 初期化 ----
  setTool('pen');
  refreshSize();
  updateInfo();
}

// ---- UI ヘルパー ----

function section(title: string): HTMLElement {
  const s = el('section', 'panel-section');
  s.appendChild(el('h3', 'panel-title', title));
  return s;
}

function numberField(label: string, value: number, min: number, max: number) {
  const wrap = el('label', 'field');
  wrap.appendChild(el('span', 'field-label', label));
  const input = el('input', 'num-input') as HTMLInputElement;
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  wrap.appendChild(input);
  return { wrap, input };
}

function sliderField(label: string, value: number, min: number, max: number) {
  const wrap = el('label', 'field');
  const top = el('span', 'field-label', label);
  const valueEl = el('span', 'field-value', String(value));
  top.appendChild(valueEl);
  wrap.appendChild(top);
  const input = el('input', 'range-input') as HTMLInputElement;
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  wrap.appendChild(input);
  return { wrap, input, value: valueEl };
}

function checkboxField(label: string, checked: boolean) {
  const wrap = el('label', 'check-field');
  const input = el('input') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = checked;
  wrap.appendChild(input);
  wrap.appendChild(el('span', undefined, label));
  return { wrap, input };
}

/** パネルをハンドルでドラッグ移動できるようにする */
function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
  handle.style.cursor = 'grab';
  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    // 現在の left/top を山ベースで計算（right 指定を左上基準に変換）
    const startLeft = panel.offsetLeft;
    const startTop = panel.offsetTop;
    panel.style.left = `${startLeft}px`;
    panel.style.top = `${startTop}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    handle.style.cursor = 'grabbing';

    const onMove = (e: PointerEvent) => {
      panel.style.left = `${startLeft + e.clientX - startX}px`;
      panel.style.top = `${startTop + e.clientY - startY}px`;
    };
    const onUp = () => {
      handle.style.cursor = 'grab';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}
