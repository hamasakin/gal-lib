# Requirements: gal-lib

**Milestone:** v1.1 — UI Redesign (桌面应用原型)
**Defined:** 2026-05-08
**Core Value:** 让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆——并且看起来像一座图书馆而不是一坨壁纸。

## v1.1 Requirements

**v1.1 total: 30 requirements across 6 categories.**

### Tokens（设计令牌系统）

- [ ] **TOK-01**: 应用支持三套主题（midnight 深色 / papyrus 暖纸 / ink 高对比），通过 `<html data-theme>` 切换；切换无刷新、无闪屏
- [ ] **TOK-02**: 应用支持四个强调色（violet 霓紫 / teal 青蓝 / sakura 樱粉 / matcha 抹茶），通过 `<html data-accent>` 切换；切换后所有 hover/active/聚焦状态、heatmap 等共用 token 同步换色
- [ ] **TOK-03**: 应用支持两档圆角风格（sharp 锐利 / soft 柔和），通过 `<html data-radius>` 切换；同时影响卡片/按钮/输入框等所有边框圆角
- [ ] **TOK-04**: 应用加载 Noto Serif SC（标题）+ Noto Sans SC（正文）+ JetBrains Mono（数字/路径），离线 fallback 到系统字体
- [ ] **TOK-05**: 三主题 + 四强调色 + 两圆角组合的偏好持久化到 localStorage，应用重启后恢复

### Tweaks（调样面板）

- [ ] **TWK-01**: 屏幕右下浮动 Tweaks 面板按钮（齿轮图标），点击展开调样卡片
- [ ] **TWK-02**: Tweaks 面板提供主题切换、强调色切换、圆角切换、侧栏宽度（narrow/regular/wide）切换、封面密度（small/medium/large）切换 5 组开关
- [ ] **TWK-03**: Tweaks 面板提供 6 个页面跳转快捷入口（图书馆/详情/扫描/统计/设置/截图）便于评审
- [ ] **TWK-04**: 所有 Tweaks 调整即时生效，无需"应用"按钮；面板可通过点击外部或 ESC 关闭

### Library（图书馆主页重塑）

- [ ] **LIB-01**: 主页 Sidebar 保留全部/收藏/通关状态/标签/品牌/年代分类导航，重塑为「藏书章」视觉风格——状态条目带彩色 dot variant（playing/cleared/dropped/todo）
- [ ] **LIB-02**: 主页主区采用「杂志式不对称网格」——首行 hero band（1.6fr + 1 + 1 + 1 四联），后续行为 `repeat(auto-fill, minmax(--card-w, 1fr))` 等密度网格
- [ ] **LIB-03**: 卡片采用 3:4 封面 + 角戳样式——左上角 mono 大写「藏书章」状态戳（5 状态：游玩中/已通关/弃坑/未开始/待复核），右上角收藏标记
- [ ] **LIB-04**: 卡片 hover 时封面渐变浮起（translateY -4px + 阴影增强），底部线性渐变蒙层 + 右下圆形播放图标
- [ ] **LIB-05**: 卡片标题用衬线字体 2 行 clamp，副信息用 mono 字体（最近游玩/总时长/品牌）
- [ ] **LIB-06**: 主页顶部页头（page-hd）= breadcrumb mono 大写小标 + serif h1 大标题 + sub mono；页头下方为 toolbar（搜索 chip / 视图切换 / 排序 select）
- [ ] **LIB-07**: 当存在活跃会话时，「现在游玩」浮条置于网格上方——脉冲 dot + 封面 + 序列时长 mono
- [ ] **LIB-08**: 主页背景含 paper-grain 纹理（径向渐变 + mix-blend-mode: overlay），强度由主题决定

### Detail（详情页重塑）

- [ ] **DTL-01**: 详情页 hero 区域 380px 高，背景为当前游戏封面的模糊放大版（filter: blur(36px) brightness(.5)）+ 自下而上的渐变蒙层
- [ ] **DTL-02**: 详情页大封面 220×293（3:4） 悬浮在 hero 边缘，向下溢出 60px（margin-bottom: -60px）创造层次
- [ ] **DTL-03**: 详情页招牌启动按钮——44px 圆形主色按钮，hover 时宽度展开到 240px 显示「启动 + LE profile」label，外阴影脉冲
- [ ] **DTL-04**: 启动按钮 hover 时上方弹出 LE Profile popover（260px），包含日文/英文/简中/繁中等 LE profile 列表；当前选择有高亮
- [ ] **DTL-05**: 详情页正文左右 1fr+320px 双栏；左栏 tabs（衬线字 + 强调色下划线 indicator）切换 总览/笔记/会话历史/截图/存档/启动配置；右栏为元数据 kv-list + tag list
- [ ] **DTL-06**: 详情页 info 区含 mono pill（品牌/发行年/长度/原始路径）、StarRating、状态 Select 直接挂在 hero
- [ ] **DTL-07**: 详情页存档/截图/笔记/会话历史等 tab 复用 v1.0 已实现的 ScreenshotsTab/SavesTab 业务逻辑，仅重换皮

### Pages（其余 4 页面重塑）

- [ ] **PGE-01**: Scan 进度页采用顶部 KPI 4 联（已扫/已识别/匹配/低置信度）+ 底部进度条线 + 双栏布局——左侧实时 feed 带状态色 ico（ok/warn/err/skip），右侧待复核卡片队列
- [ ] **PGE-02**: 待复核卡片含游戏 mini-cover、Bangumi/VNDB 候选小卡片对比，可一键切换数据源
- [ ] **PGE-03**: Stats 页面采用 12 列 Grid 仪表盘——KPI 4 联（每个 span 3）+ 6 月日历热力图（span 12）+ 30 日柱图（span 8）+ 通关进度环（span 4）+ Top 8 时长榜（span 6）+ 品牌/年份分布（span 6）
- [ ] **PGE-04**: Stats 热力图按 4 档强度（l1/l2/l3/l4）渲染，颜色基于 `color-mix(--accent ...% --bg-2)`；时间窗 select（每日/每周/每月）切换数据源
- [ ] **PGE-05**: Settings 页面采用 200px 左侧 nav + 主区双栏；nav 含七分区（外观/扫描/数据源/启动器/计时/数据/关于），主区每分区有 serif h2 + mono lede + setting rows（路径/toggle/数值输入）
- [ ] **PGE-06**: Settings 路径项（root dirs / LE path / data dir / saves dir）使用 path-row（mono code 显示路径 + 深度 + 状态 + 32px 删除/选择按钮）
- [ ] **PGE-07**: Screenshots 页面按游戏分组——每组 serif h2 + mono meta（拍摄数/最近时间）+ masonry 4 列瀑布流（响应式 4/3/2 列），点击 shot 进入 lightbox 全屏预览
