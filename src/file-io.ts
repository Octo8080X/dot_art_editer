/**
 * ファイル入出力を担当するモジュール。
 *
 * - PNG 書き出し: 黒 (0,0,0) を透過 (alpha=0) に変換して保存する。
 * - PNG 読み込み: 透過ピクセルは黒 (0,0,0) としてバッファへ取り込む。
 * - ガイド画像読み込み: HTMLImageElement として状態へ保持する。
 */

import { EditorState } from './editor-state';

/** ドキュメントを PNG として書き出しダウンロードする（黒を透過） */
export function exportPng(state: EditorState, fileName = 'pixelart.png'): void {
  const canvas = document.createElement('canvas');
  canvas.width = state.docWidth;
  canvas.height = state.docHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('書き出し用 2D コンテキストを取得できませんでした');

  const out = ctx.createImageData(state.docWidth, state.docHeight);
  const src = state.buffer;
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    dst[i] = src[i];
    dst[i + 1] = src[i + 1];
    dst[i + 2] = src[i + 2];
    // 未塗りの箇所は RGB(0,0,0) で埋める（不透明で書き出す）
    dst[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/** PNG ファイルを読み込んでバッファへ取り込む（透過は黒に変換） */
export async function importPng(state: EditorState, file: File): Promise<void> {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  canvas.width = state.docWidth;
  canvas.height = state.docHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('読み込み用 2D コンテキストを取得できませんでした');

  // ドキュメントサイズに合わせて等倍配置（左上基準）
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const buf = state.buffer;
  for (let i = 0; i < buf.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) {
      // 透過は空き（黒）
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
    } else {
      buf[i] = data[i];
      buf[i + 1] = data[i + 1];
      buf[i + 2] = data[i + 2];
    }
    buf[i + 3] = 255;
  }
}

/** URL を指定して PNG を読み込みバッファへ取り込む（透過は黒に変換） */
export async function importPngFromUrl(state: EditorState, url: string): Promise<void> {
  const img = await loadImageFromUrl(url);
  const canvas = document.createElement('canvas');
  canvas.width = state.docWidth;
  canvas.height = state.docHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('読み込み用 2D コンテキストを取得できませんでした');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const buf = state.buffer;
  for (let i = 0; i < buf.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) {
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
    } else {
      buf[i] = data[i];
      buf[i + 1] = data[i + 1];
      buf[i + 2] = data[i + 2];
    }
    buf[i + 3] = 255;
  }
}

/** ガイド画像（テンプレート）を読み込む */
export async function loadGuideImage(
  state: EditorState,
  file: File,
): Promise<void> {
  state.guideImage = await loadImageFromFile(file);
}

/** URL を指定してガイド画像（テンプレート）を読み込む */
export async function loadGuideImageFromUrl(
  state: EditorState,
  url: string,
): Promise<void> {
  state.guideImage = await loadImageFromUrl(url);
}

/** File から HTMLImageElement を生成する */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像の読み込みに失敗しました'));
    };
    img.src = url;
  });
}

/** URL 文字列から HTMLImageElement を生成する */
function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`画像の読み込みに失敗しました: ${url}`));
    img.src = url;
  });
}
