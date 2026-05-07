# Roadmap: gal-lib

## Overview

从零到一构建 gal-lib：先搭建可运行的 Tauri 应用骨架和数据层（Phase 1），再接入扫描与元数据引擎让游戏出现在网格中（Phase 2），接着打通 LE 启动 + 进程计时 + 托盘后台（Phase 3），然后完善搜索/筛选/详情/状态管理等库管理功能（Phase 4），最后交付统计图表、截图收集和存档备份（Phase 5）。

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Tauri 应用骨架、Portable 数据层、SQLite migrations、双栏 App Shell
- [x] **Phase 2: Library Ingest** - 多目录扫描、exe 识别、Bangumi/VNDB 元数据抓取、封面网格渲染
- [ ] **Phase 3: Launch & Playtime** - LE 转区启动、进程计时、会话记录、托盘后台
- [ ] **Phase 4: Library Polish** - 搜索/排序/筛选、详情页、自定义标签、通关状态/评分/笔记、设置页
- [ ] **Phase 5: Stats & Media** - 统计图表、截图管理、存档备份恢复

## Phase Details

### Phase 1: Foundation
**Goal**: 可运行的 Tauri 应用骨架交付：Portable 数据目录自动初始化、SQLite schema 就位、双栏 App Shell 可见，单 exe 打包验证通过
**Depends on**: Nothing (first phase)
**Requirements**: APP-01, APP-02, APP-03, LIB-01
**Success Criteria** (what must be TRUE):
  1. 用户双击 .exe 后应用启动，数据目录 `data/` 自动创建在同目录下，数据库文件存在且 schema 已初始化
  2. 主界面呈现双栏布局（左侧边栏 + 右侧主区占位），窗口可正常操作
  3. 打包产物为单 .exe，体积 < 30MB，在无开发环境的 Windows 机器上解压即可启动
**Plans**: TBD
**UI hint**: yes

### Phase 2: Library Ingest
**Goal**: 用户能将本地杂乱 galgame 目录扫描进库，每款游戏自动匹配封面和元数据，以封面网格呈现
**Depends on**: Phase 1
**Requirements**: SCAN-01, SCAN-02, SCAN-03, SCAN-04, SCAN-05, SCAN-06, SCAN-07, SCAN-08, META-01, META-02, META-03, META-04, META-05, META-06, META-07, LIB-02, LIB-06
**Success Criteria** (what must be TRUE):
  1. 用户添加至少一个根目录并触发扫描，实时看到进度（当前目录 / 已完成数 / 总数），扫描结束后游戏出现在封面网格中
  2. 每款游戏的卡片显示从 Bangumi 或 VNDB 拉取的封面、标题，封面本地缓存后不重复下载
  3. 元数据低置信度时用户能从候选列表手动挑选，错配时能通过手动绑定 ID 修正，并可触发单个游戏重新抓取
  4. 网格在上千游戏卡片下仍然流畅滚动（虚拟化渲染）
**Plans**: TBD
**UI hint**: yes

### Phase 3: Launch & Playtime
**Goal**: 用户能通过 LE 一键转区启动游戏，关掉游戏后自动记录本次会话时长，关闭主窗口后计时仍在后台持续
**Depends on**: Phase 2
**Requirements**: LAUNCH-01, LAUNCH-02, LAUNCH-03, LAUNCH-04, LAUNCH-05, TIME-01, TIME-02, TIME-03, TIME-04, TIME-05, TRAY-01, TRAY-02, TRAY-03
**Success Criteria** (what must be TRUE):
  1. 用户点击启动按钮，游戏通过 LE 转区打开；LE 自身退出后系统仍跟踪正确的游戏进程
  2. 游戏关闭后，本次会话记录（开始/结束时间、时长）自动写入，游戏详情页可见累计总时长和会话历史
  3. 用户关闭主窗口后应用最小化到系统托盘，计时继续；托盘右键可恢复窗口或退出应用
  4. 用户可为每款游戏独立选择 LE profile，手动覆盖启动 exe，自定义启动参数和工作目录
**Plans**: TBD

### Phase 4: Library Polish
**Goal**: 用户能快速找到任意游戏，给游戏打标签/状态/评分/笔记，通过详情页查看完整信息，通过设置页管理库配置
**Depends on**: Phase 3
**Requirements**: LIB-03, LIB-04, LIB-05, LIB-07, TAG-01, TAG-02, TAG-03, TAG-04, STAT-01, STAT-02, STAT-03, STAT-04
**Success Criteria** (what must be TRUE):
  1. 用户在搜索框输入标题/品牌/标签关键词，结果实时过滤；可按最近游玩、字母、时长、评分等维度排序
  2. 侧边栏显示自定义标签列表和自动派生分类（品牌/年代/通关状态），点击任意项即可筛选对应游戏
  3. 用户点击游戏卡片打开详情页，可见封面/简介/CV/标签，并可在此标记通关状态、收藏、打分、写笔记
  4. 设置页可添加/移除库根目录、配置扫描深度、指定 LE 路径，修改后无需重启即时生效
**Plans**: TBD
**UI hint**: yes

### Phase 5: Stats & Media
**Goal**: 用户能查看游玩时间统计图表，从详情页管理截图，以及对任意游戏的存档进行备份和恢复
**Depends on**: Phase 4
**Requirements**: STATS-01, STATS-02, SHOT-01, SHOT-02, SAVE-01, SAVE-02, SAVE-03
**Success Criteria** (what must be TRUE):
  1. 用户可在统计页查看每日/每周/每月游玩时长趋势图，以及按游戏的总时长 Top N 分布
  2. 游戏运行期间截图自动收集到 `data/screenshots/<game_id>/`，用户可在详情页查看、导出、删除截图
  3. 用户可为游戏配置存档目录，手动触发备份（带时间戳），并可从历史列表恢复任意一份存档
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 6/6 | Complete | 2026-05-07 |
| 2. Library Ingest | 6/6 | Complete | 2026-05-07 |
| 3. Launch & Playtime | 4/6 | In progress | - |
| 4. Library Polish | 0/TBD | Not started | - |
| 5. Stats & Media | 0/TBD | Not started | - |
