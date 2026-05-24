# 箱庭 · Hakoniwa (gal-lib)

> **ローカルに散らばった galgame フォルダを、検索でき、起動でき、記録できる「図書館」に。**

Windows 向け galgame コレクション＆ランチャー管理ツール。

[**最新版をダウンロード →**](https://github.com/hamasakin/gal-lib/releases/latest) ・ [简体中文](./README.md) ・ [English](./README.en.md)

---

## これは何

**箱庭 (Hakoniwa)** は Windows 向けの galgame コレクション＆ランチャー管理ツールです。ローカルのゲームフォルダをスキャンし、**Bangumi / VNDB** から自動でカバー・あらすじ・制作スタッフ・タグなどのメタデータを取得、**Locale Emulator** でワンクリック転区起動、プロセス監視でプレイ時間を自動集計します。

アプリ全体は約 10MB の単一 exe にパッケージングされ、すべてのデータは exe と同じディレクトリの `data/` に保存されます——**解凍するだけで使え、USB に入れて持ち運べて、レジストリ汚染なし**。

## なぜ作ったか

中華圏の galgame プレイヤーは通常 3 つの悩みを抱えています：

1. **ローカルに数十〜数百本のゲームが複数のフォルダに散らばっていて、見つからない・覚えられない。**
2. **日本語 galgame は転区ツールが必須**——LE は便利だが、ゲームごとに設定するのは面倒。
3. **クリア後に自分が何時間遊んだか、最近何をプレイしたか、ある原画家の作品を全部見たい**——ローカルには「図書館ビュー」がなく、ただのフォルダの山しかない。

既存の LaunchBox / Playnite / Heroic は PC 商業ゲーム寄りで、galgame の主要メタデータソース（Bangumi）、転区の必須性、人物集約への対応が不十分。箱庭はこの「図書館」というメタファーを徹底的に作り込んでいます：**蔵書印・カードグリッド・人物集約ページ・タイムライン**——壁紙の山ではなく、図書館に見えるように。

## 主な機能

### 📚 コレクションとスキャン
- **複数ルートディレクトリ対応**、ルートごとに深度を個別設定
- ヒューリスティックな exe スコアリングで自動識別。信頼度が低いものは **`/scan` レビューキュー** に入り、Bangumi/VNDB 候補を並べて比較・採用
- 増分/フルスキャン + リアルタイム進捗
- カスタムタグ、お気に入り、1-10 評価、クリア状態、メモ（800ms オートセーブ）

### 🌐 メタデータ自動取得
- **Bangumi 優先 + VNDB フォールバック**のデュアルソース（トークンバケットでレート制限）
- 自動取得項目：カバー、あらすじ、ブランド、発売年、公式タグ、**制作スタッフ**（シナリオ / 原画 / 声優 / 音楽の 4 職能）
- マッチング信頼度が低い場合、Bangumi/VNDB ID の手動バインドをサポート
- **クロスソース人物統合**：同一人物が Bangumi と VNDB で別々に出てきても自動で統合表示

### 🎮 ワンクリック転区起動
- **Locale Emulator** パス自動検出を内蔵
- ゲームごとに LE プロファイル / 作業ディレクトリを個別設定可能
- スクリーンショット自動収集（per-game スコープ + 間隔調整可）
- セーブデータディレクトリのワンクリックバックアップ / 復元

### ⏱ プレイ時間統計
- プロセス監視ベースの計時、セッション単位 + 累計
- システムトレイでバックグラウンド計時——メインウィンドウを閉じても継続
- Stats ダッシュボード：KPI、6 ヶ月ヒートマップ、30 日棒グラフ、ゲーム別 ringstack、Top 8、ブランド / 年代分布

### 👤 人物集約（v1.2+）
- `/persons/:id` ページ：4 職能グループのグリッド + その人物の全関与作品
- **タイムライン**：横向き年代バブル、プレイ時間をバブル高さにマッピング
- **「よく X と共演する」** 横スクロールバー：協業者を自動レコメンド
- 人物ポートレートのローカルキャッシュ（`data/portraits/`）、オフラインでも閲覧可能

### 🎨 5 軸デザイントークン
`<html data-*>` でリアルタイム切替、**全 CSS 変数駆動、JS 再レンダリングなし**：
- 3 テーマ（ライト / ダーク / システム）× 4 アクセントカラー × 2 角丸 × 3 サイドバー幅 × 3 カバー密度
- フローティング Tweaks パネルからいつでも調整
- localStorage で永続化

### 📦 エンジニアリング
- **ポータブル**：データはすべて `data/`、USB 持ち運び / 友人間配布が容易
- **単一 exe**：Tauri ビルド約 10MB（NSIS インストーラー）、目標 < 30MB
- **自動更新**：GitHub Releases + minisign 署名（`tauri-plugin-updater`）

## 技術スタック

| レイヤー | 技術 |
|---|---|
| シェル | Tauri 2 (Rust) |
| フロントエンド | React 19 + TypeScript + Vite + Tailwind v3 + shadcn/ui + Zustand |
| DB | SQLite via `tauri-plugin-sql` + `sqlx` (schema v12) |
| HTTP | reqwest + governor（トークンバケットレート制限） |
| プロセス監視 | sysinfo + Windows API (OpenProcess / WaitForSingleObject) |
| プラットフォーム | Windows 10/11 のみ |

## インストール

[Releases](https://github.com/hamasakin/gal-lib/releases/latest) から `.exe` インストーラー（NSIS）をダウンロードし、ダブルクリックでインストール。初回起動時に exe と同じディレクトリに `data/` が作成されます。
事前に [Locale Emulator](https://github.com/xupefei/Locale-Emulator) のインストールが必要です（パスは自動検出されます）。

## 開発

```bash
# 前提：Node.js 20+、pnpm、Rust ツールチェーン（stable）、Windows 10/11
pnpm install

# 開発モード（vite + tauri dev）
pnpm tauri dev

# 型チェック
pnpm typecheck

# プロダクションビルド → NSIS インストーラーが src-tauri/target/release/bundle/ に出力
pnpm tauri build

# リリース（自動で bump + commit + tag + push、GitHub Actions release.yml をトリガー）
pnpm release
```

Cargo テスト：`cd src-tauri && cargo test`。

### プロジェクト構成

```
src/                 React 19 + TS フロントエンド（routes/、components/、store/、hooks/）
src-tauri/src/       Rust バックエンド
  ├── scan/          複数ルート walker、exe スコアリング、removed-marker
  ├── metadata/      bangumi.rs、vndb.rs、レート制限、マッチスコアリング
  ├── launch/        LE 検出、orchestrator、プロセス追跡、セッション計時
  ├── ingest.rs      スキャン結果 + staff + tags を SQLite に書き込み
  ├── tray.rs        システムトレイ + バックグラウンド計時
  └── commands.rs    Tauri IPC サーフェス
src-tauri/migrations/  SQLite schema v1 → v12
```
