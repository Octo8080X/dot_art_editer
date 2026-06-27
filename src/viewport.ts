/**
 * 表示範囲（ビューポート）の移動・サイズ変更を担当するモジュール。
 *
 * 移動は「表示範囲の縦横ユニット数」を単位として行う（ページ送り方式）。
 * オフセットはドキュメント範囲内にクランプする。
 */

import { EditorState } from './editor-state';

export type Direction = 'up' | 'down' | 'left' | 'right';

export class Viewport {
  private readonly state: EditorState;

  constructor(state: EditorState) {
    this.state = state;
  }

  /** 指定方向へ表示範囲ぶん移動する */
  move(dir: Direction): void {
    const s = this.state;
    switch (dir) {
      case 'left':
        s.offsetX -= s.viewCols;
        break;
      case 'right':
        s.offsetX += s.viewCols;
        break;
      case 'up':
        s.offsetY -= s.viewRows;
        break;
      case 'down':
        s.offsetY += s.viewRows;
        break;
    }
    this.clamp();
  }

  /** 表示範囲のユニット数を変更する */
  setViewSize(cols: number, rows: number): void {
    const s = this.state;
    s.viewCols = Math.max(1, Math.min(s.docWidth, Math.floor(cols)));
    s.viewRows = Math.max(1, Math.min(s.docHeight, Math.floor(rows)));
    this.clamp();
  }

  /** ズーム（1ドットあたりの画面pxサイズ）を変更する */
  setCellSize(size: number): void {
    this.state.cellSize = Math.max(1, Math.min(64, Math.floor(size)));
  }

  /** 指定ドキュメント座標を中心に表示範囲を移動する */
  centerOn(docX: number, docY: number): void {
    const s = this.state;
    s.offsetX = Math.round(docX - s.viewCols / 2);
    s.offsetY = Math.round(docY - s.viewRows / 2);
    this.clamp();
  }

  /** オフセットをドキュメント範囲内に収める */
  clamp(): void {
    const s = this.state;
    const maxX = Math.max(0, s.docWidth - s.viewCols);
    const maxY = Math.max(0, s.docHeight - s.viewRows);
    s.offsetX = Math.max(0, Math.min(maxX, s.offsetX));
    s.offsetY = Math.max(0, Math.min(maxY, s.offsetY));
  }
}
