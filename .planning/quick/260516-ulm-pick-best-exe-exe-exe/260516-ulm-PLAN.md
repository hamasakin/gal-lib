---
phase: quick-260516-ulm
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src-tauri/src/scan/walker.rs
autonomous: true
requirements: [SCAN-05]

must_haves:
  truths:
    - "游戏根目录有正分 exe 时，深层子目录里的更高分 exe 不会被选中"
    - "游戏根目录无正分候选时，扫描会下探更深层子目录寻找正分 exe"
    - "锁定的评分规则不变：仅 score > 0 合格，全负/无候选返回 None，同分按 mtime 较新者胜"
    - "score_exe 仍以 game_dir 根作为 parent_dir 参数（前缀匹配/坏目录惩罚语义不变）"
  artifacts:
    - path: "src-tauri/src/scan/walker.rs"
      provides: "pick_best_exe 分层（按目录深度）匹配实现 + 更新后的模块/函数 doc"
      contains: "pick_best_exe"
  key_links:
    - from: "pick_best_exe"
      to: "WalkDir entry.depth()"
      via: "按 entry.depth() 分组逐层评估"
      pattern: "\\.depth\\(\\)"
---

<objective>
修复 `pick_best_exe` 的 EXE 匹配逻辑：当前对整个游戏目录做无深度限制的平铺递归，纯按分数取最高，导致深层子目录里评分更高的 exe 会压过游戏根目录里的正主。

改为**按目录深度分层匹配**：先只看 depth 0（游戏根目录）的 exe，若该层存在正分候选则在该层内按分数/mtime 取最佳并直接返回；该层无正分候选才下探 depth 1，重复，直到某层命中或全部走完返回 None。

Purpose: 浅层（更靠近游戏根）的 exe 几乎总是真正的主程序；深层子目录通常是 redist/tools/汉化补丁等。优先浅层能消除「选错正主」的扫描 bug。
Output: 改写后的 `pick_best_exe`、同步更新的 walker.rs 模块/函数 doc 注释、新增覆盖「浅层正主 vs 深层高分 exe」的单元测试。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

@src-tauri/src/scan/walker.rs
@src-tauri/src/scan/exe_score.rs

<interfaces>
<!-- 关键契约 — executor 直接使用，无需再探索代码库 -->

src-tauri/src/scan/exe_score.rs:
```rust
/// path 是候选 .exe；parent_dir 是游戏目录根（per-game scan 的根，不一定是 path 的直接父目录）。
pub fn score_exe(path: &Path, parent_dir: &Path) -> i32;
```
- 评分契约（locked，本计划不改）：仅返回值参与排名；前缀匹配以 parent_dir 名为准；
  路径含 redist/tools/launcher/extras/crack/_install 子目录 → -3。

src-tauri/src/scan/walker.rs (现状，本计划改写):
```rust
pub fn pick_best_exe(game_dir: &Path) -> Option<PathBuf>;
```
- 当前实现：`WalkDir::new(game_dir)` 无 min/max_depth → 全递归平铺，纯按分数取最高（同分 mtime 兜底）。
- `walkdir::WalkDir` 的 entry 提供 `entry.depth()` —— 相对 `game_dir` 的深度，根目录下的文件 depth == 1。
  （注意：`WalkDir::new(game_dir)` 时，`game_dir` 本身 depth==0，其直接子文件 depth==1。）
</interfaces>

<locked_rule_note>
⚠ **SCAN-05 偏差标注（executor / reviewer 必读）**

`02-CONTEXT.md` § 文件系统扫描引擎 第 42 行的 locked 措辞为：
「递归 exe 扫描（SCAN-05）：在每款游戏目录内**全递归（不受深度限制）**扫所有 .exe，按打分挑首发候选」

本计划把「全递归平铺排名」改为「按深度分层、浅层优先」。这是对同一意图（挑出正主 exe）的
**bug 修复式精化**，不改动 locked 的评分启发式（+/- 规则、score>0 合格门槛、全负返回 None、
同分 mtime 兜底全部保留）。仅遍历/排名策略变化。

执行时：保持 SCAN-05 评分契约逐字不变；walker.rs 模块顶部 doc 中对 SCAN-05 的引用需更新为
分层描述，并在 doc 中简短记录该精化（一行即可，例如「分层匹配：浅层优先，深层兜底」）。
若 reviewer 认为该偏差需用户确认，由编排层处理 —— planner 已就地决定按用户期望行为实现。
</locked_rule_note>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: 把 pick_best_exe 改写为按目录深度分层匹配</name>
  <files>src-tauri/src/scan/walker.rs</files>
  <behavior>
    - 浅层正主优先：游戏根目录直接有一个正分 exe、某深层子目录有评分更高的 exe → 选根目录那个。
    - 深层兜底：游戏根目录无任何正分 exe（如根下只有负分 setup.exe），depth 1 子目录有正分 exe → 选 depth 1 那个。
    - 同层并列：同一层内两个正分 exe 分数相同 → 取 mtime 较新者（沿用现有 tiebreak）。
    - 全无正分候选 → 返回 None（与现有 pick_best_exe_returns_none_when_all_negative 行为一致）。
  </behavior>
  <action>
    改写 `pick_best_exe(game_dir: &Path) -> Option<PathBuf>`，实现「按目录深度分层、浅层优先」匹配。

    实现要点（复用 WalkDir，不重写遍历）：
    1. 仍用 `WalkDir::new(game_dir).follow_links(false)`，**不要**加 min/max_depth（需要遍历全部层级，只是分层评估）。
    2. 对每个 `.exe` 文件 entry：调 `score_exe(path, game_dir)`（parent_dir 仍传 `game_dir` 根，
       语义不变 —— exe_score.rs doc 已明确）；只保留 `score > 0` 的候选（locked 门槛不变）。
    3. 用 `entry.depth()` 作为分层键。把所有正分候选按 depth 分桶 —— 推荐用
       `BTreeMap<usize, (i32, SystemTime, PathBuf)>`：key 是 depth，value 是该层当前最佳
       `(score, mtime, path)`；插入时按「score 更高，或 score 相等且 mtime 更新」更新该 depth 的最佳。
    4. 全部 entry 遍历完后，`BTreeMap` 按 depth 升序迭代，**返回第一个非空层的最佳 path**
       （浅层优先：depth 越小越优先）。无任何正分候选 → 返回 None。
    5. mtime 读取沿用现有方式（`entry.metadata().ok().and_then(|m| m.modified().ok()).unwrap_or(SystemTime::UNIX_EPOCH)`）。

    保持不变：`filter_map(|r| r.ok())` 忽略单条目 IO 错误；`score > 0` 合格门槛；同分 mtime 兜底。
    实现 SCAN-05（评分契约逐字不变，仅遍历/排名策略精化为分层 —— 见 context 的 locked_rule_note）。

    禁止：min/max_depth 截断遍历（会漏掉真正需要兜底的深层 exe）；改动 score_exe 调用的
    parent_dir 参数；引入「v1/简化版」之类降级措辞。
  </action>
  <verify>
    <automated>cargo test --manifest-path src-tauri/Cargo.toml scan::walker -- --nocapture</automated>
  </verify>
  <done>pick_best_exe 按深度分层，浅层有正分候选即在该层取最佳返回；浅层无正分候选才下探深层；现有 4 个 walker 测试 + 新增分层测试全部通过。</done>
</task>

<task type="auto">
  <name>Task 2: 新增分层匹配单元测试 + 同步 doc 注释</name>
  <files>src-tauri/src/scan/walker.rs</files>
  <action>
    在 `walker.rs` 的 `#[cfg(test)] mod tests` 内新增至少两个测试（沿用现有 `temp_dir` / `write_sized` 辅助函数）：

    1. `pick_best_exe_prefers_shallow_over_deeper_higher_score`：
       - 游戏根目录 `Fate/` 放一个正分但非最高分的 exe（例如 `Fate.exe`，prefix+5 / size+2 → 正分）。
       - 在深层子目录 `Fate/data/bin/` 放一个**评分更高**的 exe —— 注意要避开 score_exe 的坏目录
         惩罚词（redist/tools/launcher/extras/crack/_install），用中性子目录名（如 `data`、`bin`）。
         让深层 exe 评分确实 > 根目录 exe（例如深层用 `Fate_cn.exe` 拿 +15 后缀奖励）。
       - 断言：`pick_best_exe` 返回**根目录**的 `Fate.exe`，而不是深层那个更高分的。
       - 在断言信息里说明：浅层正主必须压过深层高分 exe。

    2. `pick_best_exe_falls_through_to_deeper_when_shallow_has_no_positive`：
       - 游戏根目录只放负分 exe（如 `setup.exe` —— -10 名字惩罚，净负分）。
       - 深层子目录（中性名，如 `Fate/game/`）放一个正分 exe（如 `Fate.exe`，size>1MB）。
       - 断言：`pick_best_exe` 返回深层那个正分 exe（浅层无正分 → 兜底下探命中）。

    同步更新 doc 注释：
    - walker.rs 顶部模块 doc 第 9-14 行对 `pick_best_exe` 的描述：把「full-recursive walk ...
      return the highest-scoring one」改成分层描述（浅层优先逐层匹配，浅层无正分候选时下探深层），
      并保留 / 更新对 locked SCAN-05 的引用 —— 一行注明这是分层精化（评分契约不变）。
    - `pick_best_exe` 函数上方的 doc 注释（现第 68-72 行「Recursively walks ... no depth limit ...」）
      同步改为分层描述。

    禁止：删除或弱化现有 4 个 walker 测试；在 doc 里保留过时的「full-recursive / no depth limit」措辞。
  </action>
  <verify>
    <automated>cargo test --manifest-path src-tauri/Cargo.toml scan::walker -- --nocapture</automated>
  </verify>
  <done>新增的浅层优先 / 深层兜底两个测试均通过；walker.rs 模块 doc 与函数 doc 已改为分层描述、无残留「full-recursive / no depth limit」措辞；`grep -n "depth" src-tauri/src/scan/walker.rs` 能看到 doc 中的分层描述与代码中的 `entry.depth()` 用法。</done>
</task>

</tasks>

<verification>
- `cargo test --manifest-path src-tauri/Cargo.toml scan::` 全绿（walker + exe_score 两个模块的全部测试）。
- `cargo build --manifest-path src-tauri/Cargo.toml` 无警告失败。
- walker.rs 模块 doc 与 `pick_best_exe` 函数 doc 已更新为分层匹配描述。
</verification>

<success_criteria>
- pick_best_exe 按目录深度分层：浅层（depth 小）有 score>0 候选即在该层按分数/mtime 取最佳返回。
- 浅层无正分候选时才下探更深层，逐层重复直到命中或返回 None。
- locked 评分契约（+/- 规则、score>0 门槛、全负返回 None、同分 mtime 兜底、score_exe 的 parent_dir=game_dir 根）逐字不变。
- 新增「浅层正主 vs 深层高分 exe」「浅层无正主→深层兜底」两个测试通过，现有测试不回退。
- SCAN-05 偏差已在 PLAN 的 locked_rule_note 中标注。
</success_criteria>

<output>
After completion, create `.planning/quick/260516-ulm-pick-best-exe-exe-exe/260516-ulm-SUMMARY.md`
</output>
