---
title: Metadata 增强 — 现状调查与 Phase 11 设计决策
date: 2026-05-09
context: /gsd-explore — 用户报"游戏简介、标签、品牌、作者、声优全是空的"
---

# Metadata Enrichment — 三层缺口现状 + 设计决策

## 现状（v1.1 ship 后）

用户视角：详情页大部分元数据字段是空的。
根因不是"抓取失败"，而是**三层都没接通**：

| 字段 | 后端 API 客户端 | DB schema 列 | 前端 UI |
|---|---|---|---|
| `summary` 简介 | ✅ Bangumi.fetch_detail / VNDB 都拉了 | ❌ **games 表无此列** | UI buildSummary 已就位，等数据 |
| `brand` 品牌 | ❌ MetadataDetail 结构无此字段 | ✅ schema v4 存在 | Detail 已可点击 setFilter({brand}) |
| 编剧/画师 | ❌ 未实现 | ❌ 无 staff 表 | 无 |
| 声优 | ❌ 未实现 | ❌ 无 voice 表 | 无 |
| 音乐 | ❌ 未实现 | ❌ 无 music 表 | 无 |
| 官方 tags | ❌ 未实现 | ❌（仅有用户自建 tags / game_tags） | 仅展示用户 tags |
| `release_date` 完整日期 | ✅ 拉了 | ⚠️ 只存 `release_year` (INTEGER) | Detail 显示年份 |

**关键观察：** 摘要(summary) 已经在 fetch_detail 里抓回来了但被 ingest 流程丢弃 — 仅靠 schema 加列 + ingest 改 UPDATE 语句即可"激活"。这是一个最低成本立竿见影的改动。

## 设计决策（与用户对齐）

### 1. 范围
**完整一起上**作为一个 phase（v1.2 Phase 11）。一次性把 schema 迁完，避免反复 ALTER。

### 2. 数据模型 — 独立 persons 表 + N:M 关系表

```
persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_cn TEXT,
  source TEXT,           -- 'bangumi' | 'vndb'
  source_id TEXT,        -- bangumi person_id 或 vndb staff/character id
  UNIQUE(source, source_id)
);

game_staff (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('scenario','artist','voice','music')),
  -- voice 角色专用：CV 配的角色名
  character_name TEXT,
  PRIMARY KEY (game_id, person_id, role, character_name)
);
```

**理由：** 用户明确选了「独立 persons 表」而非反范式 JSON，因为：
- 需要"点击作者/声优看其作品"（人物聚合页）— 反范式做不到
- 需要"作家 X + 声优 Y 的交集"筛选
- 重复人名归一化（Bangumi 与 VNDB 同一作者被合并到一行）

### 3. Roles enum（4 类）
- `scenario` — 脚本/编剧 (writer/scenario)
- `artist` — 原画/画师 (artist/illustrator/CG)
- `voice` — 声优 (voice actor / CV)
- `music` — 音乐 (composer / OP/ED)

### 4. 跳转链接 — 三类全要

- **外部链接** — Detail 页加 "在 Bangumi 看 ↗" / "在 VNDB 看 ↗"（用 tauri shell open / opener plugin 打开默认浏览器）
- **应用内品牌跳转** — Library facet + Detail 品牌名点击 → `setFilter({ brand })`（已部分支持，待 brand 自动抓取后激活）
- **应用内人物聚合页** — 新增路由 `/persons/:id` 或 `/library?staff_id=...&role=...`，列出该人物参与的所有游戏

## 官方 Tags 与用户 Tags 共存策略（待 Phase 11 内细化）

- `game_official_tags(game_id, tag_name, source, weight)` 独立表，不与现有 `tags / game_tags` 合并
- Detail 页两个 tag 区：「官方标签」（不可编辑、灰色 chip）+「我的标签」（保留现有用户编辑）
- Library facet 筛选时合并搜索（"轻百合" 同时命中两边）

## 后续待研究 / 待定

见 `research/questions.md` 同步追加项；以及 Phase 11 的 PLAN.md 内细化：
- backfill 脚本对已有游戏批量补 metadata 的并发与限速
- VNDB GraphQL kana API 与 Bangumi v0 字段命名差异统一
- 人物 portrait 图片是否本地缓存（cover_cache 现有架构可复用）
