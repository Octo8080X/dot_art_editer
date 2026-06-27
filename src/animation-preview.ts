/**
 * アニメーションプレビューモジュール。
 *
 * 現在の表示範囲（viewCols × viewRows）をアニメーションフレームに分割し、
 * ループ再生してキャラクターチップのプレビューを表示する。
 *
 * フレーム分割方式: 表示範囲を水平方向に frameCount 等分し、
 * 左から順に 1 フレームとして扱う。
 */

import { EditorState } from './editor-state';

export class AnimationPreview {
  private readonly state: EditorState;
  readonly panel: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private frameCount = 4;
  private fps = 8;
  private zoom = 4;
  private visible = false;

  private currentFrame = 0;
  private lastTime = 0;
  private rafId: number | null = null;

  constructor(container: HTMLElement, state: EditorState) {
    this.state = state;

    this.panel = document.createElement('div');
    this.panel.className = 'anim-preview-panel';
    this.panel.style.display = 'none';

    const title = document.createElement('h3');
    title.className = 'minimap-title';
    title.textContent = 'アニメーションプレビュー';
    this.panel.appendChild(title);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'anim-preview-canvas';
    this.panel.appendChild(this.canvas);

    this.panel.appendChild(
      this.buildControl('フレーム数', 1, 16, this.frameCount, (v) => {
        this.frameCount = v;
        this.currentFrame = 0;
        this.updateCanvasSize();
      }),
    );
    this.panel.appendChild(
      this.buildControl('FPS', 1, 60, this.fps, (v) => {
        this.fps = v;
      }),
    );
    this.panel.appendChild(
      this.buildControl('ズーム倍率', 1, 8, this.zoom, (v) => {
        this.zoom = v;
        this.updateCanvasSize();
      }),
    );

    container.appendChild(this.panel);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('アニメーションプレビュー用 2D コンテキストを取得できませんでした');
    this.ctx = ctx;

    this.updateCanvasSize();
  }

  private buildControl(
    label: string,
    min: number,
    max: number,
    defaultVal: number,
    onChange: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'anim-ctrl-row';

    const lbl = document.createElement('span');
    lbl.className = 'anim-ctrl-label';
    lbl.textContent = label;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.value = String(defaultVal);
    input.className = 'anim-ctrl-input';
    input.addEventListener('input', () => {
      const raw = parseInt(input.value, 10);
      const v = isNaN(raw) ? defaultVal : Math.max(min, Math.min(max, raw));
      onChange(v);
    });

    row.appendChild(lbl);
    row.appendChild(input);
    return row;
  }

  private updateCanvasSize(): void {
    const { viewCols, viewRows } = this.state;
    const frameW = Math.max(1, Math.floor(viewCols / this.frameCount));
    const frameH = viewRows;
    this.canvas.width = frameW * this.zoom;
    this.canvas.height = frameH * this.zoom;
  }

  show(): void {
    this.visible = true;
    this.panel.style.display = 'block';
    this.currentFrame = 0;
    this.lastTime = 0;
    this.updateCanvasSize();
    this.startLoop();
  }

  hide(): void {
    this.visible = false;
    this.panel.style.display = 'none';
    this.stopLoop();
  }

  toggle(): boolean {
    if (this.visible) {
      this.hide();
      return false;
    } else {
      this.show();
      return true;
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** 表示範囲サイズが変わったときに呼ぶ */
  onViewportChange(): void {
    this.updateCanvasSize();
    this.currentFrame = 0;
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    const tick = (time: number) => {
      if (!this.visible) {
        this.rafId = null;
        return;
      }
      const interval = 1000 / this.fps;
      if (time - this.lastTime >= interval) {
        this.drawCurrentFrame();
        this.currentFrame = (this.currentFrame + 1) % this.frameCount;
        this.lastTime = time;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private drawCurrentFrame(): void {
    const { ctx, state } = this;
    const { viewCols, viewRows, offsetX, offsetY, buffer, docWidth, docHeight } = state;
    const frameW = Math.max(1, Math.floor(viewCols / this.frameCount));
    const frameH = viewRows;
    const zoom = this.zoom;
    const dw = frameW * zoom;
    const dh = frameH * zoom;

    // キャンバスサイズが変わっている場合に追従
    if (this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas.width = dw;
      this.canvas.height = dh;
    }

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, dw, dh);

    // 透過を示すチェッカーボード背景
    const cs = 8;
    for (let cy = 0; cy < dh; cy += cs) {
      for (let cx = 0; cx < dw; cx += cs) {
        const even = ((Math.floor(cx / cs) + Math.floor(cy / cs)) % 2) === 0;
        ctx.fillStyle = even ? '#1c1c2e' : '#12121e';
        ctx.fillRect(cx, cy, Math.min(cs, dw - cx), Math.min(cs, dh - cy));
      }
    }

    // 現在フレームのピクセルを一時キャンバスに書き込む
    const tmp = document.createElement('canvas');
    tmp.width = frameW;
    tmp.height = frameH;
    const tmpCtx = tmp.getContext('2d');
    if (!tmpCtx) return;
    const imageData = tmpCtx.createImageData(frameW, frameH);
    const data = imageData.data;
    const srcX0 = offsetX + this.currentFrame * frameW;

    for (let row = 0; row < frameH; row++) {
      const docY = offsetY + row;
      for (let col = 0; col < frameW; col++) {
        const docX = srcX0 + col;
        const di = (row * frameW + col) * 4;
        if (docX < 0 || docY < 0 || docX >= docWidth || docY >= docHeight) {
          data[di + 3] = 0;
          continue;
        }
        const si = (docY * docWidth + docX) * 4;
        const r = buffer[si];
        const g = buffer[si + 1];
        const b = buffer[si + 2];
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

    tmpCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(tmp, 0, 0, dw, dh);

    // フレーム番号インジケーター
    const indicatorH = 14;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, dh - indicatorH, dw, indicatorH);
    ctx.fillStyle = '#c084fc';
    ctx.font = `${indicatorH - 3}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`${this.currentFrame + 1} / ${this.frameCount}`, 4, dh - indicatorH / 2);
  }
}
