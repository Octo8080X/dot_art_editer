import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  /**
   * サブディレクトリへデプロイする場合はここを変更してください。
   * 例: '/charatip-editor/' → https://example.com/charatip-editor/ 以下に配置
   * ルート直下へのデプロイなら './' または '/' のままで OK。
   */
  base: './',

  build: {
    // 出力先（デフォルトは dist/）
    outDir: 'dist',
    // ソースマップは公開環境では不要な場合は false に
    sourcemap: false,
  },
});
