# Project Overview 仕様更新（実装反映）

更新日: 2026-03-01

この文書は、[Project Overview.md](/home/hacker/Project/sphere/Project%20Overview.md) の
`Specification Update (Reflected From Current Implementation)` を日本語で要約したものです。

## 1. 乖離の要約（当初仕様 -> 現在実装）

1. ガバナンスは将来拡張想定だったが、現在は実装済み。
2. 地政学は当初スコープ外に近かったが、現在は国家間ダイナミクスとして実装済み。
3. 経済は都市/個人中心から、通貨・金融・資源市場まで拡張済み。
4. 社会システムは家族/宗教中心から、公的機関・行政サービスまで拡張済み。
5. 分析運用は手動中心から、MCP/State API/レポートで再現可能な運用へ拡張済み。

## 2. 実装済み拡張（現行仕様）

### 地政学レイヤ

- 外交状態: `peace / alliance / crisis / war`
- 事象: 制裁・停戦・領土移管
- 国家ライフサイクル: 建国・領土変動・消滅
- 非国家アクター: 軍事企業・秘密結社

### メタ秩序レイヤ（5層）

- `world_system`
- `civilization_blocs`
- `institutional_zones`
- `nation_city_governance`
- `hegemonic_networks`

### 政策/学習レイヤ

- RL を複数ドメインで利用（企業・外交・資源・投資・制度）
- 都市 Policy Genome（継承/変異/適応度フィードバック）

### マクロ/資源レイヤ

- 資源市場と価格・希少性フィードバック
- 通貨制度（為替・インフレ・政策金利）
- 銀行（預金/貸出/ネット）
- 疫病・気候・文化ドリフト

### 制度/社会レイヤ

- 都市別の公的サービス充足・協調指数
- 教育制度（段階別成果と政策レバー）

### 観測/運用

- MCP ツール群
- State API（bootstrap/summary/tick/reset/snapshot）
- シナリオ/レポートによる比較検証

## 3. Non-Goal 境界の再定義

- 戦術的な戦闘シミュレーションは目的外のまま。
- ただし、文明ダイナミクスとしての限定的なマクロ競合
  （外交状態遷移・領土変動）は仕様内。

## 4. 実行プロファイル

- `default`: 拡張機能を有効にした現行挙動
- `overview`: 当初 Project Overview に近い構成
