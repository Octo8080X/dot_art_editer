/**
 * 表示範囲のレンダリングを担当するモジュール。
 *
 * 表示用キャンバスに対して以下の順で描画する:
 *   1. 透過を示すチェッカーボード背景
 *   2. ガイド画像（テンプレート）— ドキュメント空間にマッピング
 *   3. ドットレイヤー（黒 = 透過のため描画しない）
 *   4. グリッド線
 */

import { EditorState } from './editor-state';

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly state: EditorState;

  /** 表示範囲をドキュメント解像度で一旦描く中間バッファ */
  private readonly layer: HTMLCanvasElement;
  private readonly layerCtx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, state: EditorState) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D コンテキストを取得できませんでした');
    this.ctx = ctx;
    this.state = state;

    this.layer = document.createElement('canvas');
    const layerCtx = this.layer.getContext('2d');
    if (!layerCtx) throw new Error('レイヤー用 2D コンテキストを取得できませんでした');
    this.layerCtx = layerCtx;

    this.resize();
  }

  /** 表示範囲・ズームに合わせて表示キャンバスのサイズを更新する */
  resize(): void {
    const { viewCols, viewRows, cellSize } = this.state;
    const canvas = this.ctx.canvas;
    canvas.width = viewCols * cellSize;
    canvas.height = viewRows * cellSize;
    this.layer.width = viewCols;
    this.layer.height = viewRows;
  }

  /** 表示範囲を再描画する */
  render(): void {
    const { ctx } = this;
    const { viewCols, viewRows, cellSize, offsetX, offsetY } = this.state;
    const w = viewCols * cellSize;
    const h = viewRows * cellSize;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    this.drawBackground(w, h);
    this.drawGuide(w, h);
    this.drawPixels(viewCols, viewRows, cellSize, offsetX, offsetY);
    if (this.state.showGrid) this.drawGrid(viewCols, viewRows, cellSize);
    this.drawSelection(cellSize, offsetX, offsetY);
    this.drawPastePreview(cellSize, offsetX, offsetY);
    this.drawMovePreview(cellSize, offsetX, offsetY);
  }

  /** 選択範囲のマーキー（破線矩形）を描く */
  private drawSelection(cellSize: number, offsetX: number, offsetY: number): void {
    const sel = this.state.selection;
    if (!sel) return;
    const { ctx } = this;
    const x = (sel.x - offsetX) * cellSize;
    const y = (sel.y - offsetY) * cellSize;
    const w = sel.w * cellSize;
    const h = sel.h * cellSize;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.strokeStyle = '#fff';
    ctx.lineDashOffset = 4;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  }

  /** 貼り付けプレビュー（クリップボードをマウス位置に半透明表示）を描く */
  private drawPastePreview(cellSize: number, offsetX: number, offsetY: number): void {
    const { state, ctx } = this;
    if (!state.pasting || !state.clipboard) return;
    const clip = state.clipboard;

    // クリップボード専用の一時バッファに描く（黒は透過）
    const tmp = document.createElement('canvas');
    tmp.width = clip.w;
    tmp.height = clip.h;
    const tmpCtx = tmp.getContext('2d');
    if (!tmpCtx) return;
    const imageData = tmpCtx.createImageData(clip.w, clip.h);
    const data = imageData.data;
    for (let i = 0; i < clip.data.length; i += 4) {
      const r = clip.data[i];
      const g = clip.data[i + 1];
      const b = clip.data[i + 2];
      if (r === 0 && g === 0 && b === 0) {
        data[i + 3] = 0;
      } else {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    tmpCtx.putImageData(imageData, 0, 0);

    const dx = (state.pastePos.x - offsetX) * cellSize;
    const dy = (state.pastePos.y - offsetY) * cellSize;
    const dw = clip.w * cellSize;
    const dh = clip.h * cellSize;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(tmp, dx, dy, dw, dh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(dx + 0.5, dy + 0.5, dw, dh);
    ctx.restore();
  }

  /** 移動プレビュー（moveData をマウス位置に半透明表示）を描く */
  private drawMovePreview(cellSize: number, offsetX: number, offsetY: number): void {
    const { state, ctx } = this;
    if (!state.moving || !state.moveData) return;
    const md = state.moveData;

    const tmp = document.createElement('canvas');
    tmp.width = md.w;
    tmp.height = md.h;
    const tmpCtx = tmp.getContext('2d');
    if (!tmpCtx) return;
    const imageData = tmpCtx.createImageData(md.w, md.h);
    const data = imageData.data;
    for (let i = 0; i < md.data.length; i += 4) {
      const r = md.data[i];
      const g = md.data[i + 1];
      const b = md.data[i + 2];
      if (r === 0 && g === 0 && b === 0) {
        data[i + 3] = 0;
      } else {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    tmpCtx.putImageData(imageData, 0, 0);

    const dx = (state.movePos.x - offsetX) * cellSize;
    const dy = (state.movePos.y - offsetY) * cellSize;
    const dw = md.w * cellSize;
    const dh = md.h * cellSize;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.8;
    ctx.drawImage(tmp, dx, dy, dw, dh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(dx + 0.5, dy + 0.5, dw, dh);
    ctx.restore();
  }

  /** 透過部分の背景（単色）を描く */
  private drawBackground(w: number, h: number): void {
    const { ctx } = this;
    ctx.fillStyle = '#101116';
    ctx.fillRect(0, 0, w, h);
  }

  /** ガイド画像を表示範囲に対応する部分だけ描く（ドキュメントピクセルに 1:1 で配置） */
  private drawGuide(_w: number, _h: number): void {
    const { state, ctx } = this;
    const img = state.guideImage;
    if (!img || !state.showGuide) return;

    const { offsetX, offsetY, viewCols, viewRows, cellSize } = state;

    // 表示範囲とガイド画像（左上原点・等倍）の交差領域を求める
    const sx0 = Math.max(0, offsetX);
    const sy0 = Math.max(0, offsetY);
    const sx1 = Math.min(img.width, offsetX + viewCols);
    const sy1 = Math.min(img.height, offsetY + viewRows);
    if (sx1 <= sx0 || sy1 <= sy0) return; // 表示範囲内にガイドが無い

    const sw = sx1 - sx0;
    const sh = sy1 - sy0;
    const dx = (sx0 - offsetX) * cellSize;
    const dy = (sy0 - offsetY) * cellSize;
    const dw = sw * cellSize;
    const dh = sh * cellSize;

    ctx.save();
    ctx.globalAlpha = state.guideOpacity;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, sx0, sy0, sw, sh, dx, dy, dw, dh);
    ctx.restore();
  }

  /** ドットレイヤーを描く（黒は透過扱いでスキップ） */
  private drawPixels(
    cols: number,
    rows: number,
    cellSize: number,
    offsetX: number,
    offsetY: number,
  ): void {
    const { state, layerCtx, ctx } = this;
    const imageData = layerCtx.createImageData(cols, rows);
    const data = imageData.data;
    const buf = state.buffer;

    for (let row = 0; row < rows; row++) {
      const docY = offsetY + row;
      for (let col = 0; col < cols; col++) {
        const docX = offsetX + col;
        const di = (row * cols + col) * 4;
        if (docX < 0 || docY < 0 || docX >= state.docWidth || docY >= state.docHeight) {
          data[di + 3] = 0;
          continue;
        }
        const si = (docY * state.docWidth + docX) * 4;
        const r = buf[si];
        const g = buf[si + 1];
        const b = buf[si + 2];
        if (r === 0 && g === 0 && b === 0) {
          // 黒は透過
          data[di + 3] = 0;
        } else {
          data[di] = r;
          data[di + 1] = g;
          data[di + 2] = b;
          data[di + 3] = 255;
        }
      }
    }

    layerCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.layer, 0, 0, cols * cellSize, rows * cellSize);
  }

  /** グリッド線を描く */
  private drawGrid(cols: number, rows: number, cellSize: number): void {
    const { ctx } = this;
    const w = cols * cellSize;
    const h = rows * cellSize;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      const x = c * cellSize + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let r = 0; r <= rows; r++) {
      const y = r * cellSize + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
