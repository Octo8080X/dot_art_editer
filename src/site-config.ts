/**
 * サイト設定ファイル
 *
 * Web 公開前にこのファイルを編集してビルドしてください。
 * ローカル開発時はデフォルト値のままで動作します。
 */
export const siteConfig = {
  /**
   * /images ディレクトリからの PNG 読み込み機能を表示するか。
   *   true  : 表示（ローカル開発・同梱画像ありのビルド向け）
   *   false : 非表示（Web 公開向け — /images が存在しない環境用）
   */
  showImageLibrary: false,

  /**
   * 「Samples」ボタンで読み込むサンプル画像の URL。
   * public/ 以下に配置したファイルは '/ファイル名' で指定できます。
   * '' (空文字) にするとボタンを非表示にします。
   */
  sampleImageUrl: '/sample.png',
};
