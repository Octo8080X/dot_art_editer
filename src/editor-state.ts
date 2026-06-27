/**
 * エディタ全体の状態を管理するモジュール。
 *
 * ドキュメント（編集対象の大きな画像）は固定サイズの RGBA バッファとして保持する。
 * 黒 (R=0,G=0,B=0) は「空き（描画なし）」を表し、表示・書き出し時に透過される。
 */

export type Tool = 'pen' | 'eraser' | 'picker' | 'select' | 'darken' | 'brighten' | 'smooth';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** ドキュメント座標系の矩形 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** コピーされたピクセル領域（RGBA） */
export interface Clipboard {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** 空きピクセル（透過扱い）を表す色 */
export const EMPTY_COLOR: RGB = { r: 0, g: 0, b: 0 };

export class EditorState {
  /** ドキュメント幅（px） */
  readonly docWidth: number;
  /** ドキュメント高さ（px） */
  readonly docHeight: number;

  /** RGBA バッファ（length = docWidth * docHeight * 4） */
  readonly buffer: Uint8ClampedArray;

  /** 表示範囲の横ユニット数（ドキュメントピクセル数） */
  viewCols: number;
  /** 表示範囲の縦ユニット数（ドキュメントピクセル数） */
  viewRows: number;

  /** 表示範囲の左上に対応するドキュメント座標 X */
  offsetX = 0;
  /** 表示範囲の左上に対応するドキュメント座標 Y */
  offsetY = 0;

  /** 1ドキュメントピクセルを画面上で何pxの正方形として描画するか（ズーム） */
  cellSize = 12;

  /** 現在の描画色 */
  currentColor: RGB = { r: 255, g: 255, b: 255 };

  /** 現在のツール */
  currentTool: Tool = 'pen';

  /** グリッド線を表示するか */
  showGrid = true;

  /** ガイド画像（テンプレート）。ドキュメント空間にマッピングして表示する */
  guideImage: HTMLImageElement | null = null;

  /** ガイド画像を表示するか */
  showGuide = true;

  /** ガイド画像の不透明度（0〜1） */
  guideOpacity = 0.5;

  /** 現在の選択範囲（select ツールで指定） */
  selection: Rect | null = null;

  /** コピーした領域 */
  clipboard: Clipboard | null = null;

  /** 貼り付け（スタンプ）モード中か */
  pasting = false;

  /** 貼り付けプレビューの左上ドキュメント座標 */
  pastePos: { x: number; y: number } = { x: 0, y: 0 };
  /** 移動モード中か */
  moving = false;

  /** 移動中のピクセルデータ（Esc での復元にも使用） */
  moveData: Clipboard | null = null;

  /** 移動元の左上坐標（Esc で元位置に戻す） */
  moveOrigin: { x: number; y: number } | null = null;

  /** 移動プレビューの現在の左上ドキュメント坐標 */
  movePos: { x: number; y: number } = { x: 0, y: 0 };

  /** スムースツールで指定ピクセルの色を何割採用するか（0–1、標準 0.8） */
  smoothCenterRatio = 0.8;
  constructor(
    docWidth = 1024,
    docHeight = 1024,
    viewCols = 128,
    viewRows = 48,
  ) {
    this.docWidth = docWidth;
    this.docHeight = docHeight;
    this.viewCols = viewCols;
    this.viewRows = viewRows;
    this.buffer = new Uint8ClampedArray(docWidth * docHeight * 4);
    this.clear();
  }

  /** バッファ全体を空き（黒・不透明）で初期化する */
  clear(): void {
    const buf = this.buffer;
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
      buf[i + 3] = 255;
    }
  }

  /** 指定座標がドキュメント範囲内か */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.docWidth && y < this.docHeight;
  }

  /** ピクセルの色を取得する */
  getPixel(x: number, y: number): RGB {
    const idx = (y * this.docWidth + x) * 4;
    return {
      r: this.buffer[idx],
      g: this.buffer[idx + 1],
      b: this.buffer[idx + 2],
    };
  }

  /** ピクセルに色を書き込む（アルファは常に不透明、透過は黒で表現） */
  setPixel(x: number, y: number, color: RGB): void {
    if (!this.inBounds(x, y)) return;
    const idx = (y * this.docWidth + x) * 4;
    this.buffer[idx] = color.r;
    this.buffer[idx + 1] = color.g;
    this.buffer[idx + 2] = color.b;
    this.buffer[idx + 3] = 255;
  }

  /** 指定色が空き（透過扱いの黒）か */
  static isEmpty(color: RGB): boolean {
    return color.r === 0 && color.g === 0 && color.b === 0;
  }

  /** 現在の選択範囲をクリップボードへコピーする */
  copySelection(): void {
    const sel = this.selection;
    if (!sel) return;
    const data = new Uint8ClampedArray(sel.w * sel.h * 4);
    for (let row = 0; row < sel.h; row++) {
      for (let col = 0; col < sel.w; col++) {
        const di = (row * sel.w + col) * 4;
        const sx = sel.x + col;
        const sy = sel.y + row;
        if (this.inBounds(sx, sy)) {
          const si = (sy * this.docWidth + sx) * 4;
          data[di] = this.buffer[si];
          data[di + 1] = this.buffer[si + 1];
          data[di + 2] = this.buffer[si + 2];
        }
        data[di + 3] = 255;
      }
    }
    this.clipboard = { w: sel.w, h: sel.h, data };
  }

  /** 現在の選択範囲をクリップボードへコピーしたうえで選択領域を消去する */
  cutSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    this.copySelection();
    for (let row = 0; row < sel.h; row++) {
      for (let col = 0; col < sel.w; col++) {
        this.setPixel(sel.x + col, sel.y + row, EMPTY_COLOR);
      }
    }
  }

  /** 選択範囲内のピクセルを左右反転する */
  flipSelectionHorizontal(): void {
    const sel = this.selection;
    if (!sel) return;
    const half = Math.floor(sel.w / 2);
    for (let row = 0; row < sel.h; row++) {
      for (let col = 0; col < half; col++) {
        const lx = sel.x + col;
        const rx = sel.x + (sel.w - 1 - col);
        const y = sel.y + row;
        const lc = this.getPixel(lx, y);
        const rc = this.getPixel(rx, y);
        this.setPixel(lx, y, rc);
        this.setPixel(rx, y, lc);
      }
    }
  }

  /** 選択範囲を持ち上げて移動モードを開始する（元の位置は消去、Esc で復元可能） */
  beginMove(): void {
    const sel = this.selection;
    if (!sel) return;
    const data = new Uint8ClampedArray(sel.w * sel.h * 4);
    for (let row = 0; row < sel.h; row++) {
      for (let col = 0; col < sel.w; col++) {
        const di = (row * sel.w + col) * 4;
        const sx = sel.x + col;
        const sy = sel.y + row;
        if (this.inBounds(sx, sy)) {
          const si = (sy * this.docWidth + sx) * 4;
          data[di] = this.buffer[si];
          data[di + 1] = this.buffer[si + 1];
          data[di + 2] = this.buffer[si + 2];
        }
        data[di + 3] = 255;
      }
    }
    this.moveData = { w: sel.w, h: sel.h, data };
    this.moveOrigin = { x: sel.x, y: sel.y };
    this.movePos = { x: sel.x, y: sel.y };
    for (let row = 0; row < sel.h; row++) {
      for (let col = 0; col < sel.w; col++) {
        this.setPixel(sel.x + col, sel.y + row, EMPTY_COLOR);
      }
    }
    this.moving = true;
    this.selection = null;
  }

  /** 移動プレビューの位置にピクセルを確定して移動モードを終了する */
  commitMove(): void {
    const md = this.moveData;
    if (!md) return;
    for (let row = 0; row < md.h; row++) {
      for (let col = 0; col < md.w; col++) {
        const si = (row * md.w + col) * 4;
        const r = md.data[si];
        const g = md.data[si + 1];
        const b = md.data[si + 2];
        if (r === 0 && g === 0 && b === 0) continue;
        this.setPixel(this.movePos.x + col, this.movePos.y + row, { r, g, b });
      }
    }
    this.moveData = null;
    this.moveOrigin = null;
    this.moving = false;
  }

  /** 移動をキャンセルしてピクセルを元の位置に復元する */
  cancelMove(): void {
    const md = this.moveData;
    const origin = this.moveOrigin;
    if (!md || !origin) return;
    for (let row = 0; row < md.h; row++) {
      for (let col = 0; col < md.w; col++) {
        const si = (row * md.w + col) * 4;
        const r = md.data[si];
        const g = md.data[si + 1];
        const b = md.data[si + 2];
        if (r === 0 && g === 0 && b === 0) continue;
        this.setPixel(origin.x + col, origin.y + row, { r, g, b });
      }
    }
    this.moveData = null;
    this.moveOrigin = null;
    this.moving = false;
  }

  /** クリップボードを指定座標（左上基準）へ貼り付ける（空き＝黒は上書きしない） */
  pasteAt(x: number, y: number): void {
    const clip = this.clipboard;
    if (!clip) return;
    for (let row = 0; row < clip.h; row++) {
      for (let col = 0; col < clip.w; col++) {
        const si = (row * clip.w + col) * 4;
        const r = clip.data[si];
        const g = clip.data[si + 1];
        const b = clip.data[si + 2];
        if (r === 0 && g === 0 && b === 0) continue; // 透過部分は上書きしない
        this.setPixel(x + col, y + row, { r, g, b });
      }
    }
  }
}

/** RGB を CSS の #rrggbb 文字列へ変換する */
export function rgbToHex(c: RGB): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** #rrggbb 文字列を RGB に変換する */
export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}
