---
title: 人物详情页加强 — 作品时光轴 + 同台伙伴推荐
trigger_condition: Phase 11 (Metadata Enrichment & Multi-dim Filtering) 收尾后；persons / game_staff 表已有真实数据
planted_date: 2026-05-09
context: /gsd-explore 2026-05-09 — 元数据补全主 phase 的进阶延展
---

# Seed: 人物详情页加强

## 触发条件
Phase 11 完成后，库中已有：
- `persons` 表至少累积 100+ 条独立人物记录
- `game_staff` 表关系数据完备
- Library 已经能跑「点击作者跳人物聚合页」基础体验

## 设想（不要在 Phase 11 内做，免得 scope 失控）

### 1. 作品时光轴（chronograph）
人物聚合页不只是"该人物的所有游戏 grid"，而是按 release_year 纵向排列的时间线：
- 横轴 = 年份；每个气泡 = 一作；尺寸 = 该作品玩家自己 playtime
- 早期作品 vs 近期作品的视觉差，方便观察"老粉发现自己玩遍了 X 早期所有作品"

### 2. 同台伙伴推荐
对同一个 person（如某声优）：
- 算法：找 game_staff 里跟该 person 共同出现频次 >= N 的其他 person（"经常和 A 同台的 B"）
- 详情页底部加「常与 X 共同出现」横滑条 → 链入对方人物页
- 以 voice ↔ scenario / artist 共现为最有趣（暗示「某编剧 + 某画师 + 某声优铁三角」）

### 3. 完成度 chip
人物聚合页顶部 chip：「该作家在你库中：5 部 / 已通关 3 / 总游玩 47h」

## 为什么是 seed 而非 Phase 11 内
- Phase 11 已经包含 schema/抓取/筛选/基础人物页四件大事，scope 已不小
- 这些是"有了数据后才能验证体验是否值得做"的二阶功能
- 等 Phase 11 ship 用一段时间，再判断有没有人会真的点人物页（用户行为数据驱动）
