# Sphere Data Contract

このドキュメントは、Sphere の「正規データ参照先」を定義する契約です。
実装・Agent Skill・レポートは本契約に従います。

## 1. 目的

- 参照先の揺れ（例: `world.geopolitics` と `world.systemState.geopolitics` の混在）を防ぐ。
- 仕様変更時に、コードと運用ドキュメントの不整合を防ぐ。

## 2. 優先参照順序

ランタイム読取時は、次の順で参照すること。

1. `state API` レスポンス（`/summary`, `/bootstrap`, tool results）
2. スナップショット `web/mcp_snapshot.json`
3. 取得不能時は「不明」と明記（推測しない）

## 3. 正規フィールド契約

### 3.1 Geopolitics / Meta-Order

- 永続状態（authoritative persistence）
  - `world.systemState.geopolitics`
- 現在フレーム表示（tick view）
  - `frame.geopolitics`
- 非正規（参照禁止）
  - `world.geopolitics`

### 3.2 Macro System

- 永続状態
  - `world.systemState`
- 現在フレーム表示
  - `frame.system`

### 3.3 Policy Genome

- 永続状態
  - `world.systemState.policyGenome`
  - `world.cities[*].policyGenome`
- 現在フレームでの反映確認
  - `frame.system.policyGenome`

### 3.4 Nations / Cities

- 構造定義
  - `world.nations`, `world.cities`, `world.layers`, `world.edges`
- 地政学集計の表示値は `frame.geopolitics.nations` を優先し、永続参照が必要な場合のみ `world.systemState.geopolitics` を使う。

## 4. Agent Skill 運用契約

- Skill は本契約の「正規フィールド契約」に従うこと。
- Skill 内で `world.geopolitics` を正規ソースとして扱ってはいけない。
- state API が不安定な場合は、`web/mcp_snapshot.json` を使うことを明記する。

## 5. 変更管理契約（重要）

以下を変更する PR は、本ファイルを同一 PR で必ず更新すること。

- `src/sim/geopolitics.js`
- `src/sim/engine.js`
- `src/sim/snapshot.js`
- `scripts/mcpServer.js`
- `src/world/model.js`
- 上記に準ずるデータ構造変更

更新が必要か迷う場合は「要更新」として扱う。

## 6. 受け入れ基準（レビュー用）

- 新規/変更コードが正規参照先を使っている。
- Skill 記述が本契約と矛盾していない。
- ドキュメント更新なしでデータ構造だけ変える PR はマージしない。

## 7. 既知の注意点

- `world` は永続状態を含むが、表示系の一部は `frame` 側にしか存在しない。
- snapshot は時点データであり、API の live state と時間差が出ることがある。
