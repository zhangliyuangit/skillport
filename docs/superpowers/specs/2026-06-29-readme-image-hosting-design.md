# README 图片托管修复设计

## 目标

修复 GitHub README 中 Logo 和管理页面截图无法加载的问题，并让本次由 Codex 完成的提交在 GitHub 上显示 Codex 联合贡献者身份。

## 方案

- 将 SVG Logo 无损渲染为 PNG。
- 通过已登录的 GitHub 页面把 Logo PNG 和管理页面截图上传到 GitHub `user-attachments`。
- 将 README 中两个仓库相对路径替换为永久附件 URL，避免依赖当前网络无法访问的 `raw.githubusercontent.com`。
- 提交仍以仓库所有者为主作者，并添加官方 `openai-codex[bot]` 的 `Co-authored-by` trailer。
- 不修改或重写已有提交，因此现有 Claude 贡献者记录会保留，Codex 将作为新的贡献者出现。

## 验证

- 两个附件 URL 均能返回图片内容。
- README 渲染后不再显示破图或替代文本。
- 本地 Markdown 路径检查和仓库现有测试保持通过。
- 推送后检查最新提交的联合作者映射和仓库 Contributors 展示。

