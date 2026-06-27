# Dev Flow Browser v0.1

開発開始までの摩擦を減らすための、Windows/Tauri/WebView2 向け軽量ブラウザ MVP です。

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

## 起動

```powershell
cd outputs/dev-flow-browser
npm install
npm run dev
```

## ビルド

```powershell
npm run build
```

実行ファイルは `src-tauri/target/release/dev-flow-browser.exe` に生成されます。

インストーラまで作る場合:

```powershell
npm run bundle
```

## 注意

この v0.1 は「操作体験を確認する Tauri MVP」ですが、コンテンツ領域は `iframe` ではなく Tauri の子 WebView2 へ移行済みです。GitHub や ChatGPT のように埋め込みを拒否するサイトも、通常の WebView として開ける構成です。

タブごとに子 WebView2 を作成し、表示/非表示を切り替えています。画像 ON/OFF とページ内検索は WebView に JavaScript を評価して制御しています。より厳密な画像ブロックや履歴制御が必要になった場合は、WebView2 のリクエスト制御 API へ寄せるのが次の改善点です。

子 WebView API を使うため、Tauri の `unstable` feature を有効化しています。
