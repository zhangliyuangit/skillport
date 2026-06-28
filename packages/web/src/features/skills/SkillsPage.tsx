import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { File } from "@phosphor-icons/react/File";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { useEffect, useMemo, useState } from "react";
import type { SkillDiff, SkillPortApi, SkillSummary } from "../../api.js";

export function SkillsPage({
  api,
  onInstall
}: {
  api: SkillPortApi;
  onInstall(): void;
}) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selected, setSelected] = useState<SkillSummary>();
  const [diff, setDiff] = useState<SkillDiff>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setSkills(await api.listSkills());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(
    () => skills.filter((skill) => skill.name.toLowerCase().includes(query.toLowerCase())),
    [skills, query]
  );
  const attention = skills.filter((skill) => skill.overall !== "Synced").length;

  const select = async (skill: SkillSummary) => {
    setSelected(skill);
    setDiff(undefined);
    if (skill.overall !== "Synced") {
      try { setDiff(await api.diff(skill.name)); } catch { setDiff(undefined); }
    }
  };

  const resolve = async (from: "codex" | "claude" | "central") => {
    if (!selected) return;
    await api.sync(selected.name, from);
    await load();
    setSelected(undefined);
  };

  return (
    <div className={`skills-layout ${selected ? "with-inspector" : ""}`}>
      <section className="skills-main">
        <header className="page-header">
          <div><h1>技能</h1><p className={attention ? "needs-attention" : ""}>{skills.length} 个技能 · {attention} 项需要处理</p></div>
        </header>
        <div className="toolbar">
          <label className="search"><MagnifyingGlass /><input aria-label="搜索技能" placeholder="搜索技能..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <button className="button secondary" onClick={() => void load()}><ArrowClockwise />扫描</button>
          <button className="button primary" onClick={onInstall}><GithubLogo weight="fill" />从 GitHub 安装</button>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>来源</th><th>Codex</th><th>Claude</th><th>模式</th><th>状态</th><th /></tr></thead>
            <tbody>
              {filtered.map((skill) => (
                <tr key={skill.name} className={selected?.name === skill.name ? "selected" : ""} onClick={() => void select(skill)} tabIndex={0}>
                  <td><span className="skill-name"><File />{skill.name}</span></td>
                  <td>{skill.source ? <span className="source"><GithubLogo weight="fill" />{skill.source.owner}/{skill.source.repo}</span> : "本地"}</td>
                  <td><AgentState value={skill.agents.codex} /></td>
                  <td><AgentState value={skill.agents.claude} /></td>
                  <td>{skill.modes.codex === "symlink" && skill.modes.claude === "symlink" ? "中心链接" : "复制"}</td>
                  <td><Status value={skill.overall} /></td>
                  <td><CaretRight /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty">没有匹配的技能</div>}
        </div>
      </section>

      {selected && (
        <aside className="inspector">
          <button className="icon-button close" aria-label="关闭详情" onClick={() => setSelected(undefined)}><X /></button>
          <h2>{selected.name}</h2><span className="muted">SKILL.md</span>
          <dl>
            <dt>来源</dt><dd>{selected.source ? `${selected.source.owner}/${selected.source.repo}` : "本地"}</dd>
            <dt>模式</dt><dd>{selected.modes.codex === "symlink" ? "中心链接" : "复制"}</dd>
            <dt>Codex 状态</dt><dd>{translateAgent(selected.agents.codex)}</dd>
            <dt>Claude 状态</dt><dd>{translateAgent(selected.agents.claude)}</dd>
            <dt>上次更新</dt><dd>{new Date(selected.updatedAt).toLocaleString("zh-CN")}</dd>
            <dt>状态</dt><dd><Status value={selected.overall} /></dd>
          </dl>
          <div className="section-title">差异 <span>SKILL.md</span></div>
          <pre className="diff">{diff?.text ?? "当前版本没有可显示的文本差异。"}</pre>
          <div className="resolution-actions">
            <button className="button primary" onClick={() => void resolve("codex")}>使用 Codex 版本</button>
            <button className="button secondary" onClick={() => void resolve("claude")}>使用 Claude 版本</button>
            <button className="button secondary" onClick={() => void resolve("central")}>使用中心版本</button>
          </div>
        </aside>
      )}
    </div>
  );
}

function AgentState({ value }: { value: string }) {
  const healthy = value === "linked" || value === "copied";
  return <span className={healthy ? "agent healthy" : "agent warning"}>{healthy ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}{translateAgent(value)}</span>;
}

function translateAgent(value: string) {
  return ({ linked: "已链接", copied: "已复制", "local changes": "本地有修改", missing: "缺失" } as Record<string, string>)[value] ?? value;
}

function Status({ value }: { value: SkillSummary["overall"] }) {
  const labels = { Synced: "已同步", "Local changes": "需要处理", Missing: "缺失", Error: "存在冲突" };
  return <span className={`status ${value === "Synced" ? "ok" : "attention"}`}><i />{labels[value]}</span>;
}
