export function SettingsPage() {
  return (
    <section className="standalone-page settings-page">
      <header className="page-header"><div><h1>设置</h1><p>SkillPort 只在本机管理这些目录。</p></div></header>
      <div className="settings-form">
        <label>中心仓库<input value="~/.skillport/skills" readOnly /></label>
        <label>Codex Skill 目录<input value="~/.codex/skills" readOnly /></label>
        <label>Claude Code Skill 目录<input value="~/.claude/skills" readOnly /></label>
        <label>首选同步方式<select defaultValue="symlink"><option value="symlink">软链接（推荐）</option><option value="copy">复制</option></select></label>
      </div>
      <p className="settings-note">第一版暂不允许在已有受管 Skill 时迁移目录。</p>
    </section>
  );
}
