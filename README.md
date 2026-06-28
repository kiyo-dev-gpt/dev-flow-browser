# Dev Flow Browser v0.1

開発開始までの摩擦を減らすための、Windows/Tauri/WebView2 向け軽量ブラウザ MVP です。

## ダウンロード

Windows の方は、GitHub Releases に置かれた実行ファイルを使うのが一番簡単です。

- Releases: https://github.com/kiyo-dev-gpt/dev-flow-browser/releases

`dev-flow-browser.exe` をダウンロードして実行してください。通常利用だけなら Node.js や Rust は不要です。

macOS / Linux 向けの配布ファイルは現時点では未提供です。Windows 以外の方や開発者の方は、下の「ソースから起動」を参照してください。

## 入っている機能

- ホーム画面を開発ランチャーとして表示
- `gh` / `lc` / `cg` / `ap` / `docs` コマンド
- URL 直接入力、localhost 補完、通常検索
- 最大 5 タブ
- `Ctrl+L`, `Ctrl+T`, `Ctrl+W`, `Alt+1..5`
- `Ctrl+F` と `/` の検索 UI
- DevTools ボタン
- 画像 ON/OFF トグル
- 入力履歴やフォーム履歴をアプリ側で保存しない実装
- コンテンツ領域を iframe ではなく Tauri の子 WebView2 として管理
- 起動ごとの一時 WebView2 データディレクトリを使用し、ログイン状態を次回起動へ持ち越さない構成

## ソースから起動

開発者、または Windows 以外の OS で試す方は、ソースから起動してください。

必要なもの:

- Node.js
- Rust
- Tauri の各 OS 向け prerequisites

Windows:

```powershell
git clone https://github.com/kiyo-dev-gpt/dev-flow-browser.git
cd dev-flow-browser
npm install
npm run dev
```

macOS / Linux:

```bash
git clone https://github.com/kiyo-dev-gpt/dev-flow-browser.git
cd dev-flow-browser
npm install
npm run dev
```

## ビルド

Windows:

```powershell
npm run build
```

実行ファイルは `src-tauri/target/release/dev-flow-browser.exe` に生成されます。

インストーラまで作る場合:

```powershell
npm run bundle
```

macOS / Linux:

```bash
npm run build
```

生成されるファイル形式は OS によって異なります。Tauri アプリは基本的に、配布したい OS 上でその OS 向けにビルドします。

## 注意

この v0.1 は Windows での利用を主対象にした「操作体験を確認する Tauri MVP」です。macOS / Linux でも Tauri の仕組み上ビルドできる可能性はありますが、現時点では動作確認と配布ファイルの提供は Windows を優先しています。

コンテンツ領域は `iframe` ではなく Tauri の子 WebView2 へ移行済みです。GitHub や ChatGPT のように埋め込みを拒否するサイトも、通常の WebView として開ける構成です。

タブごとに子 WebView2 を作成し、表示/非表示を切り替えています。画像 ON/OFF とページ内検索は WebView に JavaScript を評価して制御しています。より厳密な画像ブロックや履歴制御が必要になった場合は、WebView2 のリクエスト制御 API へ寄せるのが次の改善点です。

子 WebView API を使うため、Tauri の `unstable` feature を有効化しています。
