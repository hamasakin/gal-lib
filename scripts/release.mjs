#!/usr/bin/env node
/**
 * gal-lib 发版脚本 —— 把手工的「bump 四处版本字段 → commit → 打 annotated tag → push」收成一条命令。
 *
 * 用法：
 *   npm run release            无参 → patch bump（0.2.3 → 0.2.4）
 *   npm run release -- patch   等价于无参
 *   npm run release -- minor   minor bump（0.2.3 → 0.3.0）
 *   npm run release -- major   major bump（0.2.3 → 1.0.0）
 *   npm run release -- 0.3.0   显式指定目标版本号
 *
 * 流程：参数解析 → 三项前置检查 → 四处精确替换 bump → commit → tag 草稿 + 编辑器定稿 → push master + tag。
 * 纯 Node 标准库实现，无任何新 npm 依赖。失败一律 process.exit(1) 并打印中文提示。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

// 仓库根 = 脚本目录（scripts/）的上一级。
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..');

const PKG_JSON = join(REPO_ROOT, 'package.json');
const TAURI_CONF = join(REPO_ROOT, 'src-tauri', 'tauri.conf.json');
const CARGO_TOML = join(REPO_ROOT, 'src-tauri', 'Cargo.toml');
const CARGO_LOCK = join(REPO_ROOT, 'src-tauri', 'Cargo.lock');

/** 致命错误：打印中文提示并退出。 */
function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

/** 同步执行 git 命令，cwd 固定为仓库根。返回 trim 后的 stdout。 */
function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

// ───────────────────────── 1. 参数解析 ─────────────────────────

/** 解析 X.Y.Z 字符串为 [major, minor, patch] 数字三元组，非法返回 null。 */
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 从 package.json 文本里用正则提取顶层 version 字段值。 */
function readCurrentVersion() {
  let text;
  try {
    text = readFileSync(PKG_JSON, 'utf8');
  } catch {
    die(`读取 package.json 失败：${PKG_JSON}`);
  }
  const m = /"version"\s*:\s*"([^"]+)"/.exec(text);
  if (!m) die('在 package.json 中找不到 "version" 字段。');
  if (!parseSemver(m[1])) {
    die(`package.json 的当前版本号 "${m[1]}" 不是合法的 X.Y.Z 格式。`);
  }
  return m[1];
}

function computeTarget(current, arg) {
  const [maj, min, pat] = parseSemver(current);
  if (arg === undefined || arg === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (arg === 'minor') return `${maj}.${min + 1}.0`;
  if (arg === 'major') return `${maj + 1}.0.0`;
  if (/^\d+\.\d+\.\d+$/.test(arg)) return arg;
  die(
    `无法识别的参数 "${arg}"。\n` +
    `  合法用法：npm run release [无参=patch | patch | minor | major | X.Y.Z]`
  );
}

const argv = process.argv.slice(2);
if (argv.length > 1) {
  die(`只接受 0 或 1 个参数，收到 ${argv.length} 个：${argv.join(' ')}`);
}

const currentVersion = readCurrentVersion();
const OLD = currentVersion;
const NEW = computeTarget(currentVersion, argv[0]);

if (!parseSemver(NEW)) {
  die(`解析出的目标版本号 "${NEW}" 非法。`);
}
if (NEW === OLD) {
  die(`目标版本 ${NEW} 与当前版本相同，无需发版。`);
}

const TAG = `v${NEW}`;
console.log(`\n发版：${OLD} → ${NEW}（tag ${TAG}）`);

// ───────────────────────── 2. 前置检查（任何文件写入之前）─────────────────────────

// ① 工作区干净
const porcelain = git(['status', '--porcelain']);
if (porcelain) {
  die(
    '工作区不干净，存在未提交改动。请先提交或暂存后再发版：\n' +
    porcelain.split('\n').map((l) => `    ${l}`).join('\n')
  );
}

// ② 当前分支为 master
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'master') {
  die(`当前分支为 "${branch}"，发版必须在 master 分支上进行。`);
}

// ③ 目标 tag 本地与远端均不存在
const localTag = git(['tag', '--list', TAG]);
if (localTag) {
  die(`本地已存在 tag ${TAG}，请勿重复发版。`);
}
let remoteTag;
try {
  remoteTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${TAG}`]);
} catch (err) {
  die(`检查远端 tag 失败（无法访问 origin）：${err.message}`);
}
if (remoteTag) {
  die(`远端 origin 已存在 tag ${TAG}，请勿重复发版。`);
}

console.log('✓ 前置检查通过（工作区干净 / 分支 master / 目标 tag 未占用）');

// ───────────────────────── 3. Bump 四处版本字段 ─────────────────────────

const BUMPED_FILES = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];

/** 回滚提示：bump 中途失败时打印。 */
function rollbackHint() {
  console.error(
    `  若已写入部分文件，可执行以下命令回滚：\n` +
    `    git checkout -- ${BUMPED_FILES.join(' ')}`
  );
}

/** 读文件 → 用 regex 精确替换（要求恰好命中 1 次）→ 写回（保留原换行风格）。 */
function bumpFile(absPath, label, regex, replacer) {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    die(`读取 ${label} 失败：${absPath}`);
  }
  let count = 0;
  const next = text.replace(regex, (...args) => {
    count += 1;
    return replacer(...args);
  });
  if (count !== 1) {
    rollbackHint();
    die(
      `${label} 的版本字段未按预期命中（命中 ${count} 次，应为 1 次）。\n` +
      `  可能该文件的版本字段格式已变，请人工检查。`
    );
  }
  // 不强制转 LF —— readFileSync/writeFileSync 默认按字节处理，CRLF 原样保留。
  writeFileSync(absPath, next);
}

const escOld = OLD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// package.json —— 顶层 "version": "OLD"
bumpFile(PKG_JSON, 'package.json',
  new RegExp(`("version"\\s*:\\s*")${escOld}(")`),
  (_, a, b) => `${a}${NEW}${b}`);

// src-tauri/tauri.conf.json —— "version": "OLD"
bumpFile(TAURI_CONF, 'src-tauri/tauri.conf.json',
  new RegExp(`("version"\\s*:\\s*")${escOld}(")`),
  (_, a, b) => `${a}${NEW}${b}`);

// src-tauri/Cargo.toml —— 仅 [package] 段内的 version = "OLD"
// 锚定文件开头 [package]，到下一个 [ 段之前的范围里替换 version。
bumpFile(CARGO_TOML, 'src-tauri/Cargo.toml',
  new RegExp(`(\\[package\\][\\s\\S]*?\\nversion = ")${escOld}(")`),
  (_, a, b) => `${a}${NEW}${b}`);

// src-tauri/Cargo.lock —— 仅 gal-lib 自身条目：name = "gal-lib" 紧随的 version 行
bumpFile(CARGO_LOCK, 'src-tauri/Cargo.lock',
  new RegExp(`(name = "gal-lib"\\r?\\nversion = ")${escOld}(")`),
  (_, a, b) => `${a}${NEW}${b}`);

console.log(`✓ 已 bump 四处版本字段到 ${NEW}`);

// ───────────────────────── 4. 提交 ─────────────────────────

let committed = false;
try {
  git(['add', 'package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']);
  git(['commit', '-m', `chore: bump version to ${NEW}`]);
  committed = true;
} catch (err) {
  rollbackHint();
  die(`提交失败：${err.message}`);
}
console.log(`✓ 已提交 (chore: bump version to ${NEW})`);

/** commit 已成功后的失败收尾指引。 */
function dieAfterCommit(stage, hint) {
  console.error(`\n✗ ${stage}`);
  console.error('  注意：版本 bump 的 commit 已成功（停在 commit 之后）。');
  console.error('  请手动收尾：');
  for (const line of hint) console.error(`    ${line}`);
  console.error('');
  process.exit(1);
}

// ───────────────────────── 5. 生成 tag 消息草稿 + 编辑器定稿 ─────────────────────────

// 上一个 HEAD 可达的 v* tag（同时有 v0.2.x 与 v1.x，不能用字典序，用 describe 取可达最近 tag）。
const prevTag = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD'], { allowFail: true });

let logOutput;
if (prevTag) {
  logOutput = git(['log', `${prevTag}..HEAD`, '--pretty=format:- %s'], { allowFail: true });
} else {
  logOutput = git(['log', '--pretty=format:- %s'], { allowFail: true });
}

const draftPath = join(tmpdir(), `gal-lib-release-${TAG}.txt`);
const draft = `Release ${TAG}\n\n${logOutput || ''}\n`;
try {
  writeFileSync(draftPath, draft);
} catch (err) {
  dieAfterCommit(`写入 tag 草稿临时文件失败：${err.message}`, [
    `git tag -a ${TAG}    # 手动打 tag`,
    `git push origin master ${TAG}`,
  ]);
}

/** 解析编辑器命令：core.editor → GIT_EDITOR → EDITOR → VISUAL → notepad。 */
function resolveEditor() {
  const fromGit = git(['config', 'core.editor'], { allowFail: true });
  const raw = fromGit || process.env.GIT_EDITOR || process.env.EDITOR || process.env.VISUAL || 'notepad';
  // core.editor / 环境变量可能含参数，按空格拆分命令与参数。
  const parts = raw.trim().split(/\s+/);
  return { cmd: parts[0], args: parts.slice(1) };
}

const editor = resolveEditor();
console.log(`  打开编辑器定稿 tag 消息：${editor.cmd} ${draftPath}`);

const editRes = spawnSync(editor.cmd, [...editor.args, draftPath], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});

if (editRes.error || editRes.status !== 0) {
  try { rmSync(draftPath, { force: true }); } catch { /* ignore */ }
  dieAfterCommit(
    `编辑器异常退出（${editRes.error ? editRes.error.message : `退出码 ${editRes.status}`}）。`,
    [
      `git tag -a ${TAG}    # 手动打 tag`,
      `git push origin master ${TAG}`,
    ]
  );
}

// ───────────────────────── 6. 打 tag ─────────────────────────

let finalMsg;
try {
  finalMsg = readFileSync(draftPath, 'utf8');
} catch (err) {
  try { rmSync(draftPath, { force: true }); } catch { /* ignore */ }
  dieAfterCommit(`读回 tag 草稿临时文件失败：${err.message}`, [
    `git tag -a ${TAG}`,
    `git push origin master ${TAG}`,
  ]);
}

// 去掉 # 注释行与首尾空白后判断是否为空。
const cleaned = finalMsg
  .split(/\r?\n/)
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')
  .trim();

if (!cleaned) {
  try { rmSync(draftPath, { force: true }); } catch { /* ignore */ }
  dieAfterCommit('tag 消息为空，已取消打 tag。', [
    `git tag -a ${TAG}    # 重新填写 tag 消息`,
    `git push origin master ${TAG}`,
  ]);
}

try {
  git(['tag', '-a', TAG, '-F', draftPath]);
} catch (err) {
  try { rmSync(draftPath, { force: true }); } catch { /* ignore */ }
  dieAfterCommit(`打 tag 失败：${err.message}`, [
    `git tag -a ${TAG} -F <消息文件>`,
    `git push origin master ${TAG}`,
  ]);
}
// 打 tag 成功后即可清理临时文件。
try { rmSync(draftPath, { force: true }); } catch { /* ignore */ }
console.log(`✓ 已打 tag ${TAG}`);

// ───────────────────────── 7. 推送 ─────────────────────────

try {
  git(['push', 'origin', 'master']);
} catch (err) {
  dieAfterCommit(`推送 master 失败：${err.message}`, [
    `git push origin master    # 重新推送分支`,
    `git push origin ${TAG}     # 再推送 tag 触发 release.yml`,
  ]);
}
console.log('✓ 已推送 master');

try {
  git(['push', 'origin', TAG]);
} catch (err) {
  console.error(`\n✗ 推送 tag ${TAG} 失败：${err.message}`);
  console.error('  注意：commit 与 master 分支均已推送，仅 tag 未推送。');
  console.error('  请手动收尾：');
  console.error(`    git push origin ${TAG}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ 已推送 tag ${TAG}，release.yml 将自动出包`);
console.log(`\n发版完成：${OLD} → ${NEW}\n`);
