# SkillPort

SkillPort 是一个本地优先的 Skill 管理器，用同一个中心目录管理 Codex 和 Claude Code 的 Skill。它提供 CLI 和配套中文管理页面，不需要守护进程，也不会上传本地 Skill。

## 能做什么

- 扫描 `~/.codex/skills` 与 `~/.claude/skills`
- 将已有 Skill 安全纳入 `~/.skillport/skills`
- 默认使用软链接；不支持时可使用复制模式
- 检测两端内容冲突，并要求明确选择来源
- 查看状态与文本差异，按 Codex、Claude 或中心版本同步
- 在保留管理的前提下，单独关闭或开启某个客户端
- 内置 Codex、Claude Code，并可注册任意自定义 Agent（如 qoder）
- 从公开 GitHub 仓库根目录或指定子目录安装 Skill
- 在本机浏览器中使用中文管理页面

## 安装

需要 Node.js 22 或更高版本。

```bash
npm install -g "https://github.com/zhangliyuangit/skillport/releases/download/v0.3.0/skillport-0.3.0.tgz"
```

安装后检查版本并打开管理页面：

```bash
skillport --version
skillport ui
```

升级时重复执行安装命令：

```bash
npm install -g "https://github.com/zhangliyuangit/skillport/releases/download/v0.3.0/skillport-0.3.0.tgz"
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

# 新建：生成一个 SKILL.md 模板并纳入所有 Agent
skillport new my-skill --description "一句话说明用途"

# 查看全部状态和单个 Skill 的差异
skillport status
skillport status pdf
skillport diff pdf

# 明确选择一个版本同步到另外两端
skillport sync pdf --from codex
skillport sync pdf --from claude
skillport sync pdf --from central

# 单独关闭/开启某个客户端（保留中心副本，可随时恢复）
skillport disable pdf --agent codex
skillport enable pdf --agent codex

# 管理 Agent 端：内置 codex/claude，可注册任意自定义 Agent
skillport agent list
skillport agent add qoder --root ~/.qoder/skills
skillport agent populate qoder   # 把已有受管 Skill 补齐到新 Agent
skillport agent remove qoder

# 从公开 GitHub 仓库安装
skillport install https://github.com/acme/skills
skillport install https://github.com/acme/skills --path skills/pdf

# 更新：从记录的 GitHub 来源重新拉取最新（有变化才动，自动先快照）
skillport update pdf
skillport update --all

# 删除某个 Agent 里未纳管的 Skill（移入 ~/.skillport/trash，可手动恢复）
skillport delete junk --agent codex

# 停止管理，但保留 Codex 与 Claude Code 中可独立使用的副本
skillport remove pdf

# 全部停止管理：把每个 Skill 的软链接换成各端独立真实副本（卸载前的安全脱钩）
skillport remove --all

# 健康检查：扫描死链 / 内容漂移 / 孤儿副本，--fix 修复可自动处理的
skillport doctor
skillport doctor --fix

# 快照：sync 前会自动打快照，也可手动；可列出、回滚
skillport snapshot create --label 改动前
skillport snapshot list
skillport snapshot restore 2026-06-28T16-10-36-658Z

# 一键安全卸载：脱钩为各端独立副本；--purge 同时删除 ~/.skillport
skillport uninstall
skillport uninstall --purge

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
├── state.json    # 受管状态
└── config.json   # 已注册的 Agent 端（不存在时使用内置默认）
```

默认 Agent 目录：

- Codex：`~/.codex/skills`
- Claude Code：`~/.claude/skills`

用 `skillport agent add <id> --root <绝对路径>` 注册更多 Agent（例如 qoder、qoder-cli），也可以在管理页面的「设置」里添加。注册后，新纳入的 Skill 会同步到所有已配置的 Agent；已有 Skill 用 `skillport agent populate <id>`（或设置页的「补齐」按钮）一次性装进新增的 Agent。管理页面的技能 / 发现页会按所有已配置 Agent 动态出列。

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
