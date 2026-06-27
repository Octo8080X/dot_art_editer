/**
 * 全体画像のどこを表示中かを示すミニマップ（オーバービュー）。
 *
 * ドキュメント全体を縮小表示し、現在の表示範囲を矩形で示す。
 * クリックすると、その位置を中心に表示範囲を移動できる。
 */

import { EditorState } from './editor-state';

export class Minimap {
  private readonly state: EditorState;
  readonly panel: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly onNavigate: (docX: number, docY: number) => void;

  /** 縮小済みドット層を描くための中間バッファ */
  private readonly layer: HTMLCanvasElement;
  private readonly layerCtx: CanvasRenderingContext2D;

  /** ドキュメント→ミニマップの縮小率 */
  private scale: number;
  private mmW: number;
  private mmH: number;

  constructor(
    container: HTMLElement,
    state: EditorState,
    onNavigate: (docX: number, docY: number) => void,
    maxSize = 220,
  ) {
    this.state = state;
    this.onNavigate = onNavigate;

    this.scale = Math.min(maxSize / state.docWidth, maxSize / state.docHeight);
    this.mmW = Math.max(1, Math.round(state.docWidth * this.scale));
    this.mmH = Math.max(1, Math.round(state.docHeight * this.scale));

    this.panel = document.createElement('div');
    this.panel.className = 'minimap-panel';
    const title = document.createElement('h3');
    title.className = 'minimap-title';
    title.textContent = '全体マップ';
    this.panel.appendChild(title);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    this.canvas.width = this.mmW;
    this.canvas.height = this.mmH;
    this.panel.appendChild(this.canvas);

    const hint = document.createElement('div');
    hint.className = 'minimap-hint';
    hint.textContent = 'クリックで表示位置を移動';
    this.panel.appendChild(hint);

    container.appendChild(this.panel);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('ミニマップ用 2D コンテキストを取得できませんでした');
    this.ctx = ctx;

    this.layer = document.createElement('canvas');
    this.layer.width = this.mmW;
    this.layer.height = this.mmH;
    const layerCtx = this.layer.getContext('2d');
    if (!layerCtx) throw new Error('ミニマップ層の 2D コンテキストを取得できませんでした');
    this.layerCtx = layerCtx;

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
  }

  /** ミニマップを再描画する */
  update(): void {
    const { ctx, state } = this;
    const w = this.mmW;
    const h = this.mmH;

    // 背景（透過を示す暗色）
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#101116';
    ctx.fillRect(0, 0, w, h);

    // 縮小したドット層を作成（黒は透過）
    const imageData = this.layerCtx.createImageData(w, h);
    const data = imageData.data;
    const buf = state.buffer;
    const invScale = 1 / this.scale;
    for (let my = 0; my < h; my++) {
      const docY = Math.min(state.docHeight - 1, Math.floor(my * invScale));
      for (let mx = 0; mx < w; mx++) {
        const docX = Math.min(state.docWidth - 1, Math.floor(mx * invScale));
        const si = (docY * state.docWidth + docX) * 4;
        const r = buf[si];
        const g = buf[si + 1];
        const b = buf[si + 2];
        const di = (my * w + mx) * 4;
        if (r === 0 && g === 0 && b === 0) {
          data[di + 3] = 0;
        } else {
          data[di] = r;
          data[di + 1] = g;
          data[di + 2] = b;
          data[di + 3] = 255;
        }
      }
    }
    this.layerCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(this.layer, 0, 0);

    // 表示範囲の矩形
    const rx = state.offsetX * this.scale;
    const ry = state.offsetY * this.scale;
    const rw = Math.max(2, state.viewCols * this.scale);
    const rh = Math.max(2, state.viewRows * this.scale);

    ctx.save();
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    ctx.fillStyle = 'rgba(192, 132, 252, 0.2)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.restore();
  }

  private onPointerDown = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const docX = Math.floor(mx / this.scale);
    const docY = Math.floor(my / this.scale);
    this.onNavigate(docX, docY);
  };
}
