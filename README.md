# SkillPort

SkillPort 是一个本地优先的 Skill 管理器，用同一个中心目录管理 Codex 和 Claude Code 的 Skill。它提供 CLI 和配套中文管理页面，不需要守护进程，也不会上传本地 Skill。

## 能做什么

- 扫描 `~/.codex/skills` 与 `~/.claude/skills`
- 将已有 Skill 安全纳入 `~/.skillport/skills`
- 默认使用软链接；不支持时可使用复制模式
- 检测两端内容冲突，并要求明确选择来源
- 查看状态与文本差异，按 Codex、Claude 或中心版本同步
- 从公开 GitHub 仓库根目录或指定子目录安装 Skill
- 在本机浏览器中使用中文管理页面

## 安装

需要 Node.js 22 或更高版本。

```bash
npm install -g "https://github.com/zhangliyuangit/skillport/releases/download/v0.1.1/skillport-0.1.1.tgz"
```

安装后检查版本并打开管理页面：

```bash
skillport --version
skillport ui
```

升级时重复执行安装命令：

```bash
npm install -g "https://github.com/zhangliyuangit/skillport/releases/download/v0.1.1/skillport-0.1.1.tgz"
```

卸载：

```bash
npm uninstall -g skillport
```

## 从源码安装

```bash
git clone https://github.com/zhangliyuangit/skillport.git
cd skillport
npm install
npm run build
npm link -w packages/cli
```

源码安装后检查：

```bash
skillport --help
skillport scan
```

也可以不执行 `npm link`，直接运行：

```bash
node packages/cli/dist/main.js scan
```

## 常用命令

```bash
# 查找 Codex / Claude Code 中的 Skill
skillport scan

# 纳入管理；如果两端内容不同，会提示选择来源且不修改文件
skillport add pdf
skillport add pdf --from codex

# 查看全部状态和单个 Skill 的差异
skillport status
skillport status pdf
skillport diff pdf

# 明确选择一个版本同步到另外两端
skillport sync pdf --from codex
skillport sync pdf --from claude
skillport sync pdf --from central

# 从公开 GitHub 仓库安装
skillport install https://github.com/acme/skills
skillport install https://github.com/acme/skills --path skills/pdf

# 停止管理，但保留 Codex 与 Claude Code 中可独立使用的副本
skillport remove pdf

# 打开本地中文管理页面
skillport ui
```

冲突输出大致如下：

```text
Conflict: different copies of "pdf" were found.
Choose the source:
  skillport add pdf --from codex
  skillport add pdf --from claude
No files were changed.
```

## 本地目录

```text
~/.skillport/
├── skills/       # 中心 Skill 副本
└── state.json    # 受管状态
```

默认 Agent 目录：

- Codex：`~/.codex/skills`
- Claude Code：`~/.claude/skills`

可以用 `SKILLPORT_HOME` 为测试或隔离环境指定另一个 SkillPort 目录。

## 安全约束

- 仅接受公开的 `https://github.com/<owner>/<repo>` 地址
- 校验 Skill 名称、仓库子路径、符号链接和 `SKILL.md`
- 所有写入先规划、再校验，并使用原子状态文件和回滚
- 管理页面只监听 `127.0.0.1` 的随机端口，并使用一次性随机令牌保护 API
- 冲突时不会猜测来源，也不会静默覆盖文件

## 开发验证

```bash
npm test
npm run typecheck
npm run build
```

设计验收记录见 [design-qa.md](design-qa.md)。
