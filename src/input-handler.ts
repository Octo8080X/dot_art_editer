/**
 * 表示キャンバス上のマウス操作を処理するモジュール。
 *
 * スクリーン座標 → ドキュメント座標を計算し、選択中のツールに応じて
 * ペン（描画）・消しゴム（黒=透過に戻す）・カラーピッカー（色取得）・
 * 範囲選択（select）を実行する。貼り付けモード中はクリックでスタンプ配置する。
 */

import { EditorState, EMPTY_COLOR, type RGB } from './editor-state';

export interface InputCallbacks {
  /** バッファが変化したときに呼ばれる（再描画用） */
  onChange: () => void;
  /** カラーピッカーで色を取得したときに呼ばれる */
  onColorPicked: (color: RGB) => void;
}

export class InputHandler {
  private readonly canvas: HTMLCanvasElement;
  private readonly state: EditorState;
  private readonly callbacks: InputCallbacks;
  private drawing = false;
  /** 連続描画時の重複適用を避けるための直前座標 */
  private lastX = -1;
  private lastY = -1;
  /** 範囲選択ドラッグ中か */
  private selecting = false;
  /** 範囲選択の始点（ドキュメント座標） */
  private selStartX = 0;
  private selStartY = 0;

  constructor(
    canvas: HTMLCanvasElement,
    state: EditorState,
    callbacks: InputCallbacks,
  ) {
    this.canvas = canvas;
    this.state = state;
    this.callbacks = callbacks;
    this.attach();
  }

  private attach(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    // 右クリックメニューを抑止（消しゴム等の操作を妨げないため）
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** スクリーン座標をドキュメントピクセル座標に変換する */
  private toDocCoords(e: PointerEvent): { x: number; y: number } | null {
    const { x, y } = this.toDocCoordsRaw(e);
    if (!this.state.inBounds(x, y)) return null;
    return { x, y };
  }

  /** スクリーン座標をドキュメントピクセル座標に変換する（範囲外も返す） */
  private toDocCoordsRaw(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    // 表示上の拡大率（CSS によるスケール）を補正
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const col = Math.floor(px / this.state.cellSize);
    const row = Math.floor(py / this.state.cellSize);
    return {
      x: this.state.offsetX + col,
      y: this.state.offsetY + row,
    };
  }

  /** 値をドキュメント範囲内へ収める */
  private clampDoc(x: number, y: number): { x: number; y: number } {
    return {
      x: Math.max(0, Math.min(this.state.docWidth - 1, x)),
      y: Math.max(0, Math.min(this.state.docHeight - 1, y)),
    };
  }

  /** 始点と現在位置から選択範囲を更新する */
  private updateSelection(curX: number, curY: number): void {
    const a = this.clampDoc(this.selStartX, this.selStartY);
    const b = this.clampDoc(curX, curY);
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    this.state.selection = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  private applyAt(x: number, y: number): void {
    const s = this.state;
    switch (s.currentTool) {
      case 'pen':
        s.setPixel(x, y, s.currentColor);
        this.callbacks.onChange();
        break;
      case 'eraser':
        s.setPixel(x, y, EMPTY_COLOR);
        this.callbacks.onChange();
        break;
      case 'picker': {
        const c = s.getPixel(x, y);
        s.currentColor = c;
        this.callbacks.onColorPicked(c);
        break;
      }
      case 'darken':
      case 'brighten': {
        const c = s.getPixel(x, y);
        if (EditorState.isEmpty(c)) break; // 空きピクセルは変更しない
        const factor = s.currentTool === 'darken' ? 0.9 : 1.1;
        const r = Math.min(255, Math.max(0, Math.round(c.r * factor)));
        const g = Math.min(255, Math.max(0, Math.round(c.g * factor)));
        const b = Math.min(255, Math.max(0, Math.round(c.b * factor)));
        if (r === 0 && g === 0 && b === 0) break; // RGB(0,0,0)にはしない
        s.setPixel(x, y, { r, g, b });
        this.callbacks.onChange();
        break;
      }
      case 'smooth': {
        const center = s.getPixel(x, y);
        if (EditorState.isEmpty(center)) break; // 空きピクセル上は操作しない
        // 周囲8マスの合計（センターは除く）
        let sr = 0, sg = 0, sb = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue; // センターを除外
            const nx = x + dx;
            const ny = y + dy;
            if (!s.inBounds(nx, ny)) continue; // 範囲外は除外
            const nc = s.getPixel(nx, ny);
            // 透過（空き）ピクセルは RGB(1,1,1) としてブレンドに含める
            const isEmpty = nc.r === 0 && nc.g === 0 && nc.b === 0;
            sr += isEmpty ? 1 : nc.r;
            sg += isEmpty ? 1 : nc.g;
            sb += isEmpty ? 1 : nc.b;
            count++;
          }
        }
        if (count === 0) break;
        // 指定ピクセルの採用率と周囲8マスの平均値をブレンド
        const ratio = Math.max(0, Math.min(1, s.smoothCenterRatio));
        const avgR = sr / count, avgG = sg / count, avgB = sb / count;
        s.setPixel(x, y, {
          r: Math.round(avgR * (1 - ratio) + center.r * ratio),
          g: Math.round(avgG * (1 - ratio) + center.g * ratio),
          b: Math.round(avgB * (1 - ratio) + center.b * ratio),
        });
        this.callbacks.onChange();
        break;
      }
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    // 移動モード: クリック位置で確定
    if (this.state.moving) {
      const raw = this.toDocCoordsRaw(e);
      this.state.movePos = this.clampDoc(raw.x, raw.y);
      this.state.commitMove();
      this.callbacks.onChange();
      return;
    }

    // 貼り付けモード: クリック位置にスタンプ
    if (this.state.pasting && this.state.clipboard) {
      const raw = this.toDocCoordsRaw(e);
      const p = this.clampDoc(raw.x, raw.y);
      this.state.pasteAt(p.x, p.y);
      this.callbacks.onChange();
      return;
    }

    // 範囲選択ツール
    if (this.state.currentTool === 'select') {
      const raw = this.toDocCoordsRaw(e);
      this.selecting = true;
      this.selStartX = raw.x;
      this.selStartY = raw.y;
      this.updateSelection(raw.x, raw.y);
      this.callbacks.onChange();
      return;
    }

    const p = this.toDocCoords(e);
    if (!p) return;
    this.drawing = true;
    this.lastX = p.x;
    this.lastY = p.y;
    this.applyAt(p.x, p.y);
  };

  private onPointerMove = (e: PointerEvent): void => {
    // 移動プレビューをマウスに追従
    if (this.state.moving) {
      const raw = this.toDocCoordsRaw(e);
      this.state.movePos = this.clampDoc(raw.x, raw.y);
      this.callbacks.onChange();
      return;
    }

    // 貼り付けプレビューをマウスに追従
    if (this.state.pasting && this.state.clipboard) {
      const raw = this.toDocCoordsRaw(e);
      this.state.pastePos = this.clampDoc(raw.x, raw.y);
      this.callbacks.onChange();
      return;
    }

    // 範囲選択ドラッグ
    if (this.selecting) {
      const raw = this.toDocCoordsRaw(e);
      this.updateSelection(raw.x, raw.y);
      this.callbacks.onChange();
      return;
    }

    if (!this.drawing) return;
    if (this.state.currentTool === 'picker') return;
    const p = this.toDocCoords(e);
    if (!p) return;
    if (p.x === this.lastX && p.y === this.lastY) return;
    // 始点と終点の間を線形補間して塗り残しを防ぐ
    this.drawLine(this.lastX, this.lastY, p.x, p.y);
    this.lastX = p.x;
    this.lastY = p.y;
  };

  private onPointerUp = (): void => {
    this.drawing = false;
    this.selecting = false;
  };

  /** ブレゼンハム法で2点間を補間して描画する */
  private drawLine(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.applyAt(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }
}
