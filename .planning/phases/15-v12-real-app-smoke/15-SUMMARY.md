---
phase: 15
name: v1.2 Real-app Smoke Verification
milestone: v1.3
status: complete
completed_at: "2026-05-12"
requirements: [VER-01, VER-02, VER-03]
plans_completed: [15a]
commits:
  - (no code changes — verification-only phase)
---

# Phase 15: v1.2 Real-app Smoke Verification — Summary

## Mode

**Verification-only phase**. 不交付新代码，只重跑全套自动化 gates 并交付完整的
real-app walkthrough 清单——供 milestone audit 时由人眼在装有 Locale Emulator +
真实 galgame 库的 Windows 环境跑一遍。

## Automation Re-run

| Gate | Result |
|------|--------|
| `cargo build --lib` | ✅ 0 errors, 5 pre-existing warnings |
| `cargo test --lib` | ✅ 68/68 |
| `pnpm tsc --noEmit` | ✅ 0 errors |
| `pnpm build` | ✅ 1957 modules / 730 KB JS / 2.82s |

无回归——Phase 13/14 上线后所有自动化层依然稳定。

---

## Real-App Walkthrough Checklist (for milestone audit)

每条步骤含「入口 / 期望 / 失败模式」。任一项失败 → 不要 close milestone，
开 quick task 或新 phase 修复后重 smoke。

### V1.2 carry-over (VER-01/02/03)

#### V-01 — Detail summary / staff / 外链 (VER-01 / UI-01)

1. **入口** Library 选一款 metadata_source = "bangumi" 的游戏 → 点 cover
2. **期望** Detail 总览 tab 显示 summary 段落（多行 serif 14px）；制作团队
   分组显示 4 role；hero 行 pill「在 Bangumi 看 ↗」可点击 → 默认浏览器打开
   bgm.tv/subject/{id}；同理「在 VNDB 看 ↗」打开 vndb.org/v{id}
3. **失败模式** 段落空白 / staff 只显示一行 / pill 点击无反应 / 弹出错误
   toast「无法打开浏览器」

#### V-02 — Detail staff chip → /persons/:id + 官方/用户 tag 双区 (VER-02 / UI-02)

1. **入口** 同一款游戏 Detail 页 → 点击「制作团队」section 任一 PersonChip
2. **期望** 路由切换到 `/persons/:id`；Persons 页 PageHeader 显示该人物
   identity + 「BANGUMI · 共参与 N 部作品」（或「BANGUMI + VNDB」如已 dedup）
3. **失败模式** chip 不可点击 / 跳到 `/persons/undefined` / 404 错误
4. **入口 (额外)** 回到 Detail 页 → 总览 tab 「官方标签」section（如有）
5. **期望** 官方 tag 与底栏「用户标签」(TagPicker) 视觉区分明显（不同
   font weight / 不同 chip 样式 / 不同 section header）
6. **失败模式** 二者风格相同无法区分

#### V-03 — FilterPanel 多维 facet (VER-03 / UI-03)

1. **入口** Library 顶栏 FilterPanel
2. **期望** 5 个 facet 类目：品牌 / 编剧 / 画师 / 声优 / 官方标签；每类显示
   前 60 chips；超过 60 时显示「更多 ↓」expander 展开剩余
3. **多 facet 跨维 AND** — 勾选 1 个 brand + 1 个 scenario → grid 收窄到
   "属于该 brand 的且该 scenario 参与的"游戏
4. **同维 OR** — 勾选 2 个 voice → grid 显示"任一声优参与的"游戏
5. **失败模式** 勾选后 grid 不变 / 60-chip expander 不工作 / facet 计数错

### Phase 13 carry-over

#### V-04 — PER-01 cross-source dedup (Phase 13)

1. **入口** 库里找一款 bound 到 Bangumi 且也能在 VNDB 命中的游戏，触发
   `backfill_metadata_enrichment` 或 refresh_metadata 让两边 persons 都进库
2. **期望** Detail 「制作团队」section 同人不显示两行；进 `/persons/:id`
   PageHeader sub 行显示「BANGUMI + VNDB · 共参与 N 部作品」
3. **失败模式** 仍显示两条独立的 chip（不同 source）/ Persons 页 sub 行
   只显示一个 source

#### V-05 — PER-02 PersonTimeline (Phase 13)

1. **入口** 任意 `/persons/:id`
2. **期望** PageHeader 与 4 role section 之间出现「时光轴」区：横向年份
   bubbles；每作品气泡 diameter = sqrt(playtime_hours+1) 映射 8..28 px；
   hover 显示 Tooltip 含游戏名 + 游玩时长 + 通关状态
3. **失败模式** 时光轴不出现 / 气泡大小都一样 / Tooltip 不显示

#### V-06 — PER-03 CoStaffStrip (Phase 13)

1. **入口** 选一个高产剧本家或画师的 `/persons/:id`
2. **期望** 4 role section 之后出现「常与 · 共同出现」横滑条；点击任一
   PersonCard 跳到对方 `/persons/:id`，时光轴 / co-staff 全部刷新
3. **失败模式** strip 不出现 (即使该人物显然有多个 co-staff) / 点击不跳

#### V-07 — PER-04 Portrait cache (Phase 13)

1. **入口** 首次访问一个 Bangumi-source 人物的 `/persons/:id`
2. **期望** PageHeader 右侧 56px 圆形头像位先显示首字 monogram，~1s 后
   被真实头像替换；下次访问 `/persons/:id` 立即出图；`data/portraits/`
   目录里有 `bangumi-{id}.{ext}` 文件
3. **失败模式** 永远显示 monogram / 抓取报错 toast / data/portraits 目录
   未创建

#### V-08 — POL-03 BackfillProgressBar + cancel (Phase 13)

1. **入口** Settings 触发 `backfill_metadata_enrichment`（或开发者菜单/
   控制台手动 invoke）
2. **期望** Library PageHeader 下沿出现 2px 渐变条 + 当前游戏名 + 计数
   ；点「取消」→ 确认 dialog → 「取消补齐」→ 当前游戏抓完后下一条 break
   ；终态 5s 后进度条自动隐藏
3. **失败模式** 进度条不出现 / 不能取消 / 取消立即中断（应该等当前抓完）/
   终态不自动隐藏

### Phase 14 carry-over

#### V-09 — FS-01 / FS-02 opener + GameCard 「打开目录」 (Phase 14)

1. **入口** Library 右键任意 GameCard → ContextMenu
2. **期望** 看到「打开目录」（在「重新匹配元数据」上）；点击 → 系统资源
   管理器打开该游戏的目录
3. **失败模式** 菜单项不出现 / 点击 toast 报错 / 资源管理器没打开

#### V-10 — FS-03 Screenshots 「打开截图目录」 (Phase 14)

1. **入口** Screenshots 路由任一 game 组 header
2. **期望** 看到 FolderOpen 图标 + 「打开目录」按钮；点击 → 资源管理器
   打开 `data/screenshots/{game_id}/`；如果 dataDir 未就绪按钮 disabled
3. **失败模式** 按钮缺失 / 点击无反应 / 报错

#### V-11 — POL-01 Detail `?tab=` deeplink (Phase 14)

1. **入口** 浏览器手动输入 `/games/123?tab=saves`
2. **期望** Detail 页直接落到「存档」tab；点击其它 tab 时 URL 实时更新
   到 `?tab=notes` / `?tab=screenshots` 等；refresh 仍保持当前 tab
3. **失败模式** 永远停在「总览」/ tab 切换 URL 不更新 / refresh 跳回总览

#### V-12 — POL-02 Stats real session count (Phase 14)

1. **入口** Stats 页（先确保库里有 ≥ 1 个游戏跑完一次 session）
2. **期望** PageHeader sub 行显示「N 次会话」其中 N = `SELECT COUNT(*)
   FROM sessions WHERE ended_at IS NOT NULL`（开发者可在 SQLite 客户端
   核对）
3. **失败模式** N 等于 games 数（说明 fallback 没退出）/ N = 0（IPC error）

### POL-04 — LIB-02 decision recorded (Phase 14, no UI)

1. **入口** `.planning/PROJECT.md` Key Decisions 表
2. **期望** LIB-02 行 outcome 列写明「✗ 废止」+ 完整原因 + 最终方案
3. **失败模式** 行还停在「⚠ Revisit」（这种情况不该出现——已 commit 在 61e9290）

---

## Out of scope (per CONTEXT)

- 任何代码改动（一旦真机走查发现 broken，作为 quick task / 新 phase 处理）
- 跨 Win10/Win11 / 不同显卡的兼容性 matrix
- 大库 (>500 games) 性能压测

## What happens next

milestone audit (`/gsd-audit-milestone v1.3`) 期间由人眼跑完上述 12 条
walkthrough。如果全过 → v1.3 close (`/gsd-complete-milestone`) → `/gsd-cleanup`
归档 phase 目录。如有 broken → 列入 audit report 的 carry-over 部分，进 v1.4。
