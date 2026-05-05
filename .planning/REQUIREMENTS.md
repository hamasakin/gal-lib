# Requirements: gal-lib

**Defined:** 2026-05-06
**Core Value:** 让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆

## v1 Requirements

**v1 total: 53 requirements across 12 categories.**

### Scanning（目录扫描与游戏识别）

- [ ] **SCAN-01**: 用户可以添加 1 个或多个游戏库根目录，并可单独移除
- [ ] **SCAN-02**: 用户可以为每个根目录单独配置扫描深度（默认 1 层，可选 1/2/3）
- [ ] **SCAN-03**: 用户可以触发全量或增量扫描，看到实时进度（当前目录、已完成数、总数）
- [ ] **SCAN-04**: 扫描时按"第 N 层子目录 = 一款游戏"识别游戏边界
- [ ] **SCAN-05**: 扫描自动从游戏目录内识别启动 exe（递归扫描 + 启发式打分排除安装/卸载/启动器/补丁）
- [ ] **SCAN-06**: 扫描中用户可单独跳过或重试某个目录
- [ ] **SCAN-07**: 元数据低置信度匹配时让用户从候选列表手动挑选
- [ ] **SCAN-08**: 增量扫描跳过已识别的游戏，仅处理新增目录

### Metadata（元数据匹配）

- [ ] **META-01**: 系统从 Bangumi（bgm.tv）拉取游戏元数据（标题、封面、简介、CV、品牌、发行日期、标签）
- [ ] **META-02**: Bangumi 未命中或低置信度时 fallback 到 VNDB
- [ ] **META-03**: 目录名清洗（去版本号、汉化标记、商家名、括号噪声）后做模糊搜索
- [ ] **META-04**: 封面图本地缓存到 `data/covers/`（按 game_id 命名，避免重复下载）
- [ ] **META-05**: 用户可以手动搜索并绑定指定 Bangumi 或 VNDB ID 修正错配
- [ ] **META-06**: 用户可以触发单个游戏元数据重新抓取/刷新
- [ ] **META-07**: API 调用有限速器（避免被 Bangumi/VNDB 限流）+ 失败重试

### Launching（启动器与转区）

- [ ] **LAUNCH-01**: 系统自动检测 Locale Emulator 安装路径（注册表 + 常见路径），允许用户手动指定
- [ ] **LAUNCH-02**: 用户可以点击启动按钮通过 LE 一键转区启动游戏
- [ ] **LAUNCH-03**: 用户可以为每款游戏选择 LE profile（简体/繁体/日文/自定义）
- [ ] **LAUNCH-04**: 用户可以为每款游戏自定义启动参数和工作目录（cwd）
- [ ] **LAUNCH-05**: 用户可以从游戏目录候选列表中手动覆盖启动 exe 路径

### Playtime（游玩时间记录）

- [ ] **TIME-01**: 启动游戏后系统自动跟踪游戏 exe 进程
- [ ] **TIME-02**: 系统正确识别 LE 启动后实际游戏进程（不被 LE 自身退出干扰）
- [ ] **TIME-03**: 游戏进程退出时自动写入会话记录（开始时间、结束时间、时长）
- [ ] **TIME-04**: 用户可以查看每款游戏的总时长和会话历史列表
- [ ] **TIME-05**: 关闭主窗口后计时仍然进行（后台模式）

### Library UI（库视图与导航）

- [ ] **LIB-01**: 主界面采用双栏布局（左侧边栏 + 右侧主区）
- [ ] **LIB-02**: 主区显示封面网格，每张卡片显示封面、标题、状态、时长
- [ ] **LIB-03**: 用户可以全文搜索游戏（标题 / 罗马音 / 别名 / 品牌 / 标签）
- [ ] **LIB-04**: 用户可以按多种方式排序（最近游玩、添加日期、字母、时长、评分）
- [ ] **LIB-05**: 用户点击卡片打开游戏详情页（封面、简介、CV、标签、笔记、操作）
- [ ] **LIB-06**: 网格视图虚拟化，支持上千游戏卡片流畅滚动
- [ ] **LIB-07**: 设置页可配置库根目录、扫描深度、LE 路径、UI 偏好

### Categorization（标签与分类）

- [ ] **TAG-01**: 用户可以创建、编辑、删除自定义标签
- [ ] **TAG-02**: 用户可以给游戏打 0~N 个标签
- [ ] **TAG-03**: 侧边栏显示标签列表，点击筛选对应游戏
- [ ] **TAG-04**: 侧边栏显示自动派生的分类（品牌、年代、通关状态）

### Status / Notes（通关状态、收藏、评分、笔记）

- [ ] **STAT-01**: 用户可以标记游戏通关状态（未开始 / 游玩中 / 已通关 / 弃坑）
- [ ] **STAT-02**: 用户可以收藏 / 取消收藏游戏
- [ ] **STAT-03**: 用户可以给游戏打分（1-10 或 5 星）
- [ ] **STAT-04**: 用户可以为每款游戏写多行笔记/备注

### System Tray（托盘与后台）

- [ ] **TRAY-01**: 应用支持系统托盘图标
- [ ] **TRAY-02**: 关闭主窗口默认最小化到托盘（不退出进程）
- [ ] **TRAY-03**: 托盘菜单提供恢复窗口、退出应用选项

### Statistics（统计图表）

- [ ] **STATS-01**: 用户可以查看每日 / 每周 / 每月游玩时长趋势图
- [ ] **STATS-02**: 用户可以查看按游戏的总时长分布（Top N 排行）

### Screenshots（截图管理）

- [ ] **SHOT-01**: 游戏运行期间自动收集截图（监听全局 PrintScreen 或定时机制）到 `data/screenshots/<game_id>/`
- [ ] **SHOT-02**: 用户可以在游戏详情页查看、导出、删除截图

### Saves（存档管理）

- [ ] **SAVE-01**: 用户可以为每款游戏配置存档目录路径
- [ ] **SAVE-02**: 用户可以触发存档备份（带时间戳保存到 `data/saves/<game_id>/<timestamp>/`）
- [ ] **SAVE-03**: 用户可以查看历史备份列表并恢复任意一份

### App / Distribution（应用形态与分发）

- [ ] **APP-01**: 应用以 Portable 模式运行：所有用户数据放在 .exe 同目录的 `data/`
- [ ] **APP-02**: 首次启动自动初始化数据库 schema、默认配置、目录结构
- [ ] **APP-03**: 单 .exe 分发，目标体积 < 30MB，解压即用

## v2 Requirements

### Future Enhancements

- **PROGRESS-01**: 通关达成度跟踪（episode / route）
- **HOTKEY-01**: 全局热键（隐藏/显示主窗口、快速启动收藏的游戏）
- **DISCORD-01**: Discord Rich Presence（显示当前在玩的游戏）
- **BATCH-01**: 批量编辑（批量打标签、批量改通关状态）
- **PROFILES-01**: 多 Library Profile 切换
- **EXPORT-01**: 配置 / 库数据导入导出（JSON 备份）
- **METASRC-01**: 接入更多元数据源（DLsite / Getchu / ErogameScape）

## Out of Scope

| Feature | Reason |
|---------|--------|
| 跨平台（macOS / Linux） | Locale Emulator 是 Windows 独占技术，转区是核心功能，跨平台没有等价方案 |
| 多用户切换 | 一台机器一个用户使用，多用户需求会大幅复杂化数据模型 |
| NTLEAS / 其他转区工具 | 用户明确选择只支持 LE，避免启动器抽象过早膨胀 |
| 窗口焦点检测计时 | 用户明确选仅进程存活计时，挂机时间作为已知误差接受 |
| 闲置阈值（无键鼠输入暂停计时） | 全局键鼠监听有杀软误报风险且用户明确不需要 |
| 自动更新机制 | Portable 模式优先，更新方式留给用户手动替换 .exe |
| 云同步 / 多设备同步 | v1 是单机应用，不引入云后端 |
| 商店 / 在线购买集成 | 这是收藏管理器，不是商店 |
| 中文社区元数据源（DLsite/Getchu/EGS） | Bangumi+VNDB 双源已能覆盖中文圈主流需求；列入 v2 |
| 视频预览 / 试玩 / 直播集成 | 远超核心价值，明确不做 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| APP-01 | Phase 1 | Pending |
| APP-02 | Phase 1 | Pending |
| APP-03 | Phase 1 | Pending |
| LIB-01 | Phase 1 | Pending |
| SCAN-01 | Phase 2 | Pending |
| SCAN-02 | Phase 2 | Pending |
| SCAN-03 | Phase 2 | Pending |
| SCAN-04 | Phase 2 | Pending |
| SCAN-05 | Phase 2 | Pending |
| SCAN-06 | Phase 2 | Pending |
| SCAN-07 | Phase 2 | Pending |
| SCAN-08 | Phase 2 | Pending |
| META-01 | Phase 2 | Pending |
| META-02 | Phase 2 | Pending |
| META-03 | Phase 2 | Pending |
| META-04 | Phase 2 | Pending |
| META-05 | Phase 2 | Pending |
| META-06 | Phase 2 | Pending |
| META-07 | Phase 2 | Pending |
| LIB-02 | Phase 2 | Pending |
| LIB-06 | Phase 2 | Pending |
| LAUNCH-01 | Phase 3 | Pending |
| LAUNCH-02 | Phase 3 | Pending |
| LAUNCH-03 | Phase 3 | Pending |
| LAUNCH-04 | Phase 3 | Pending |
| LAUNCH-05 | Phase 3 | Pending |
| TIME-01 | Phase 3 | Pending |
| TIME-02 | Phase 3 | Pending |
| TIME-03 | Phase 3 | Pending |
| TIME-04 | Phase 3 | Pending |
| TIME-05 | Phase 3 | Pending |
| TRAY-01 | Phase 3 | Pending |
| TRAY-02 | Phase 3 | Pending |
| TRAY-03 | Phase 3 | Pending |
| LIB-03 | Phase 4 | Pending |
| LIB-04 | Phase 4 | Pending |
| LIB-05 | Phase 4 | Pending |
| LIB-07 | Phase 4 | Pending |
| TAG-01 | Phase 4 | Pending |
| TAG-02 | Phase 4 | Pending |
| TAG-03 | Phase 4 | Pending |
| TAG-04 | Phase 4 | Pending |
| STAT-01 | Phase 4 | Pending |
| STAT-02 | Phase 4 | Pending |
| STAT-03 | Phase 4 | Pending |
| STAT-04 | Phase 4 | Pending |
| STATS-01 | Phase 5 | Pending |
| STATS-02 | Phase 5 | Pending |
| SHOT-01 | Phase 5 | Pending |
| SHOT-02 | Phase 5 | Pending |
| SAVE-01 | Phase 5 | Pending |
| SAVE-02 | Phase 5 | Pending |
| SAVE-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 53 total
- Mapped to phases: 53 ✓
- Unmapped: 0

---
*Requirements defined: 2026-05-06*
*Last updated: 2026-05-06 after initial definition*
