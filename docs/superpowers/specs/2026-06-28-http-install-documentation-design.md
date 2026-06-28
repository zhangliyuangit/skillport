# SkillPort HTTPS 安装文档设计

## 目标

让用户无需克隆仓库或手工下载文件，直接从 GitHub Release 安装 SkillPort。

## 变更范围

- README 的安装章节首先展示完整的 GitHub Release HTTPS 安装命令。
- 原有源码构建方式保留，并改为“从源码安装”。
- README 增加升级和卸载命令。
- `v0.1.1` Release 说明使用同一条完整 HTTPS 安装命令。

## 命令

```bash
npm install -g "https://github.com/zhangliyuangit/skillport/releases/download/v0.1.1/skillport-0.1.1.tgz"
```

安装后用 `skillport --version` 和 `skillport ui` 验证。升级重复执行安装命令；卸载使用 `npm uninstall -g skillport`。

## 边界

- 本次不发布 npm Registry 包，因此不宣称支持 `npm install -g skillport`。
- 不增加安装脚本或 `curl | sh`，避免额外供应链与 shell 执行风险。
- README 与 Release 必须保持版本和 URL 一致。

## 验证

- 在临时 npm prefix 中通过 HTTPS URL 安装。
- `skillport --version` 输出 `0.1.1`。
- 检查 README 与 Release 均包含同一条完整安装命令。
