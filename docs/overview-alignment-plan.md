# Project Overview Alignment Plan

## Goal

`Project Overview.md` を基準に、現行実装との差分を管理しながら段階的に乖離を縮小する。

## Current Gap Summary

### A. Core Scope (Overview準拠)

- 日次サイクル、移動フロー、個人特性、家族・遺伝、宗教、都市指標は概ね準拠。

### B. Expanded Scope (Overviewより先行)

- 地政学（戦争/危機/同盟/領土変動）
- メタ秩序（文明圏・制度圏・覇権ネットワーク）
- 通貨・金融・拡張マクロ（疫病/気候/文化ドリフト）
- 都市 Policy Genome

これらは Overview の「Future Extensions」相当を先行実装した領域。

## Alignment Strategy

1. 既定実装は維持（後方互換）。
2. `SPHERE_PROFILE=overview` で Overview 準拠モードに切替。
3. 比較運用で、乖離を必要に応じて本体へ反映。

## Runtime Profiles

- `default`: 現行の拡張実装を有効
- `overview`: Overview 乖離を抑える構成

`overview` プロファイルで無効化される主な機能:

- `geopolitics.enabled = false`
- `metaOrder.enabled = false`
- `policyGenome.enabled = false`
- `currency.enabled = false`
- `banking.enabled = false`
- `institutions.enabled = false`
- `extensions.{epidemic,climate,culture}.enabled = false`

## How To Run

```bash
npm run start:overview
```

```bash
npm run start:mcp:overview
```

```bash
npm run dev:all:overview
```

## Governance Rule

`Project Overview.md` に対する適合性に影響する変更は、同一 PR で本ファイルも更新する。
