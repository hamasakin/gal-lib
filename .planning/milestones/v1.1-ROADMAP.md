# Roadmap: gal-lib

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-05-08) — see [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 UI Redesign** — Phases 6-10 (shipped 2026-05-08)

## Overview

把 Claude Design 交付的 gal-lib 桌面应用原型完整落地。先铺设计令牌系统和 Tweaks 面板（Phase 6），然后按视觉层次依次重塑 Library 主页（Phase 7）、Detail 沉浸式详情页（Phase 8）、Scan + Stats 数据可视化页（Phase 9）、Settings + Screenshots 配置与媒体页（Phase 10）。功能层不动，仅替换样式与交互细节，不改 Rust 后端。

## Phases

**Phase Numbering:**
- Integer phases (6, 7, 8): Planned milestone work
- Decimal phases (7.1, 7.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 6: Design Tokens & Tweaks** - CSS 变量层（3 主题 × 4 强调色 × 2 圆角 × 侧栏 × 密度）+ 字体加载 + Tweaks 调样面板 + localStorage 持久化
- [x] **Phase 7: Library Page Redesign** - 卡片重设计（角戳/收藏标）+ 杂志式不对称网格（hero band）+ Sidebar 重塑（status dot variants）+ page-hd + toolbar + 现在游玩浮条
- [x] **Phase 8: Detail Page Redesign** - hero 封面背景模糊 + 大封面悬浮 + 招牌启动按钮（44px → 240px hover）+ LE Profile popover + 沉浸式 tabs + meta pills
- [x] **Phase 9: Scan & Stats Pages** (Stats only; Scan deferred — see SUMMARY) - Scan 双栏布局（KPI + feed + review queue）+ Stats 12 列仪表盘（KPI + heatmap + bars + ringstack + toplist + breakdown）
- [x] **Phase 10: Settings & Screenshots** - Settings 200px 左导航 + 七分区 + path-row + 自定义 toggle + Screenshots masonry + lightbox

## Phase Details

### Phase 6: Design Tokens & Tweaks
**Goal**: 完成全局设计令牌基础设施——`<html data-theme/data-accent/data-radius/data-sidebar/data-density>` 任意组合切换无刷新生效，所有偏好持久化到 localStorage；屏幕右下浮动 Tweaks 调样面板可即时调整全部 5 组开关。
**Depends on**: Nothing (foundation phase)
**Requirements**: TOK-01, TOK-02, TOK-03, TOK-04, TOK-05, TWK-01, TWK-02, TWK-03, TWK-04
**Success Criteria** (what must be TRUE):
  1. 用户从 Tweaks 面板切换主题/强调色/圆角后，全应用即时变色变形，无需刷新；偏好写入 localStorage
  2. 应用重启后，偏好从 localStorage 恢复，避免「每次启动都是默认 midnight + violet」
  3. Noto Serif SC + Noto Sans SC + JetBrains Mono 三套字体加载完毕；离线时优雅 fallback 到系统 serif/sans/mono
  4. Tweaks 面板包含 6 个页面跳转快捷入口（图书馆/详情/扫描/统计/设置/截图）便于评审
**Plans**: TBD
**UI hint**: yes

### Phase 7: Library Page Redesign
**Goal**: 主页从默认 shadcn 网格变成「图书馆」美学——卡片左上角 mono 大写藏书章状态戳、3:4 封面 hover 浮起、首行 hero band（1.6fr+1+1+1）、Sidebar status 列含彩色 dot variant、page-hd serif 大标题 + mono breadcrumb、现在游玩浮条带脉冲。
**Depends on**: Phase 6
**Requirements**: LIB-01, LIB-02, LIB-03, LIB-04, LIB-05, LIB-06, LIB-07, LIB-08
**Success Criteria** (what must be TRUE):
  1. 用户进入主页能看到 hero band（首行 1 大 + 3 小卡）+ 等密度网格交错的杂志式版面
  2. 卡片左上角是衬线/mono 风格的藏书章状态戳（5 状态色）；hover 时封面浮起、底部蒙层 + 圆形播放图标
  3. Sidebar 状态分类带彩色 dot prefix，活动会话时主区顶部出现「现在游玩」浮条带脉冲动画
  4. 切换主题/强调色后，stamp 颜色、grain 纹理、card 阴影同步换装
**Plans**: TBD
**UI hint**: yes

### Phase 8: Detail Page Redesign
**Goal**: 详情页从默认平铺变成「沉浸式封面 hero」——380px hero 背景为当前封面 blur(36px)brightness(.5)，220×293 大封面向下溢出 60px 悬浮在 hero 边缘；页面右上角招牌启动按钮 44px 圆 hover 展开 240px + LE Profile popover；内容区 1fr+320px 双栏 + 衬线 tabs 含 accent 下划线 indicator。
**Depends on**: Phase 7
**Requirements**: DTL-01, DTL-02, DTL-03, DTL-04, DTL-05, DTL-06, DTL-07
**Success Criteria** (what must be TRUE):
  1. 用户进入任意游戏详情页能看到该游戏封面的高斯模糊大背景，前景大封面浮在 hero 上方
  2. 启动按钮默认 44px 圆形，hover 时平滑展开到 240px 显示「启动 + LE profile」label，并弹出 LE profile popover
  3. info 区含 mono pill（品牌/年/长度）+ StarRating + 状态 Select；tabs 切换时下划线 indicator 滑动跟随
  4. 现有截图/存档/笔记/会话历史 tab 业务逻辑不变，仅更换皮肤
**Plans**: TBD
**UI hint**: yes

### Phase 9: Scan & Stats Pages
**Goal**: Scan 进度页和 Stats 统计页落地数据可视化层——Scan 顶部 KPI 4 联 + 双栏布局（feed + review queue cards）；Stats 12 列 Grid 仪表盘 KPI + 6 月日历热力图（color-mix）+ 30 日柱图 + 通关进度环 + Top 8 时长榜 + 品牌/年份分布。
**Depends on**: Phase 6 (tokens)
**Requirements**: PGE-01, PGE-02, PGE-03, PGE-04
**Success Criteria** (what must be TRUE):
  1. Scan 进行中页面顶部 KPI 实时更新（已扫/已识别/匹配/低置信度）；左侧 feed 行带状态色 ico；右侧 review queue 卡片含 Bangumi/VNDB 候选对比
  2. Stats 页面 12 列 Grid 渲染 6 月日历热力图（按强度 4 档染色）+ 时间窗 select 切换日/周/月柱图
  3. Top 时长榜按 mini-cover + 排名 + serif 名称 + mono 时长四列展示
  4. 切换强调色后，所有图表色（heatmap、bars、ringstack）随 token 同步换装
**Plans**: TBD
**UI hint**: yes

### Phase 10: Settings & Screenshots
**Goal**: Settings 与 Screenshots 完成最后两块视觉收尾——Settings 200px 左导航 + 主区双栏（七分区 serif h2 + mono lede + path-row + 自定义 toggle）；Screenshots 按游戏分组 masonry 4 列瀑布流 + 点击 lightbox 全屏预览。
**Depends on**: Phase 6 (tokens)
**Requirements**: PGE-05, PGE-06, PGE-07
**Success Criteria** (what must be TRUE):
  1. Settings 页面有 200px 左侧 nav，七分区（外观/扫描/数据源/启动器/计时/数据/关于）平滑滚动定位
  2. 路径项使用 path-row 显示 mono code + 深度 + 状态 + 32px 删除/选择按钮
  3. Screenshots 页面按游戏分组渲染 masonry 4 列（响应式 4/3/2 列），点击进入 lightbox（max-width 80vw + ESC 关闭）
  4. 全部页面在三主题 × 四强调色任意组合下视觉一致、对比可读

## Progress

**Execution Order:**
Phases execute in numeric order: 6 → 7 → 8 → 9 → 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 6. Design Tokens & Tweaks | 1/1 | Complete | 2026-05-08 |
| 7. Library Page Redesign | 1/1 | Complete | 2026-05-08 |
| 8. Detail Page Redesign | 1/1 | Complete | 2026-05-08 |
| 9. Scan & Stats Pages | 1/1 | Complete (partial) | 2026-05-08 |
| 10. Settings & Screenshots | 1/1 | Complete | 2026-05-08 |
