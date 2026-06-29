import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { File } from "@phosphor-icons/react/File";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { AgentConfig, SkillContent, SkillDiff, SkillPortApi, SkillSummary } from "../../api.js";
import { usePolling } from "../../hooks.js";
import { SkillContentView } from "../../SkillContentView.js";
import { useToast } from "../toast/Toast.js";

export function SkillsPage({
  api,
  onInstall,
  onNewSkill
}: {
  api: SkillPortApi;
  onInstall(): void;
  onNewSkill(): void;
}) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selected, setSelected] = useState<SkillSummary>();
  const [diff, setDiff] = useState<SkillDiff>();
  const [content, setContent] = useState<SkillContent>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const toast = useToast();

  const load = async () => {
    try {
      const [loadedSkills, loadedAgents] = await Promise.all([
        api.listSkills(),
        api.listAgents()
      ]);
      setSkills(loadedSkills);
      setAgents(loadedAgents);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    }
  };

  useEffect(() => { void load(); }, []);
  usePolling(() => { if (!pending && !selected) void load(); }, 5000);

  const filtered = useMemo(
    () => skills.filter((skill) => skill.name.toLowerCase().includes(query.toLowerCase())),
    [skills, query]
  );
  const attention = skills.filter((skill) => skill.overall !== "Synced").length;

  const select = async (skill: SkillSummary) => {
    setSelected(skill);
    setDiff(undefined);
    setContent(undefined);
    try { setContent(await api.preview(skill.name)); } catch { setContent(undefined); }
    if (skill.overall !== "Synced") {
      try { setDiff(await api.diff(skill.name)); } catch { setDiff(undefined); }
    }
  };

  const resolve = async (from: string) => {
    if (!selected) return;
    setPending(true);
    try {
      await api.sync(selected.name, from);
      toast.show(`已用「${from === "central" ? "中心" : from}」版本同步 ${selected.name}`, "success");
      await load();
      setSelected(undefined);
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : "同步失败", "error");
    } finally {
      setPending(false);
    }
  };

  const updateSkill = async () => {
    if (!selected) return;
    setPending(true);
    try {
      const result = await api.update(selected.name);
      toast.show(result.updated ? `${selected.name} 已更新到最新` : `${selected.name} 已是最新`, "success");
      await load();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : "更新失败", "error");
    } finally {
      setPending(false);
    }
  };

  const toggleAgent = async (name: string, agent: string, enabled: boolean) => {
    setPending(true);
    try {
      await api.setEnabled(name, agent, enabled);
      toast.show(`${name} 在 ${agent} 已${enabled ? "启用" : "关闭"}`, "success");
      await load();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : "切换失败", "error");
    } finally {
      setPending(false);
    }
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
          <button className="button secondary" onClick={onInstall}><GithubLogo weight="fill" />从 GitHub 安装</button>
          <button className="button primary" onClick={onNewSkill}><File weight="fill" />新建 Skill</button>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>来源</th>{agents.map((agent) => <th key={agent.id}>{agent.id}</th>)}<th>模式</th><th>状态</th><th /></tr></thead>
            <tbody>
              {filtered.map((skill) => (
                <tr key={skill.name} className={selected?.name === skill.name ? "selected" : ""} onClick={() => void select(skill)} tabIndex={0}>
                  <td><span className="skill-name"><File />{skill.name}</span>{skill.description && <small className="skill-desc">{skill.description}</small>}</td>
                  <td>{skill.source ? <span className="source"><GithubLogo weight="fill" />{skill.source.owner}/{skill.source.repo}</span> : "本地"}</td>
                  {agents.map((agent) => (
                    <td key={agent.id}>
                      <AgentToggle
                        value={skill.agents[agent.id] ?? "missing"}
                        disabled={pending}
                        onToggle={(enabled) => void toggleAgent(skill.name, agent.id, enabled)}
                      />
                    </td>
                  ))}
                  <td>{Object.values(skill.modes).every((mode) => mode === "symlink") ? "中心链接" : "复制"}</td>
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
          {selected.description && <p className="inspector-desc">{selected.description}</p>}
          <dl>
            <dt>来源</dt><dd>{selected.source ? `${selected.source.owner}/${selected.source.repo}` : "本地"}</dd>
            <dt>模式</dt><dd>{Object.values(selected.modes).every((mode) => mode === "symlink") ? "中心链接" : "复制"}</dd>
            {agents.map((agent) => (
              <Fragment key={agent.id}><dt>{agent.id} 状态</dt><dd>{translateAgent(selected.agents[agent.id] ?? "missing")}</dd></Fragment>
            ))}
            <dt>上次更新</dt><dd>{new Date(selected.updatedAt).toLocaleString("zh-CN")}</dd>
            <dt>状态</dt><dd><Status value={selected.overall} /></dd>
          </dl>
          {selected.source && (
            <button className="button secondary update-action" disabled={pending} onClick={() => void updateSkill()}><GithubLogo weight="fill" />从 GitHub 更新</button>
          )}
          <div className="section-title">内容 <span>SKILL.md</span></div>
          {content ? <SkillContentView text={content.text} truncated={content.truncated} /> : <pre className="skill-content">加载中…</pre>}
          <div className="section-title">差异 <span>SKILL.md</span></div>
          <pre className="diff">{diff?.text ?? "当前版本没有可显示的文本差异。"}</pre>
          <div className="resolution-actions">
            {agents
              .filter((agent) => sourceUsable(selected.agents[agent.id]))
              .map((agent) => (
                <button key={agent.id} className="button secondary" disabled={pending} onClick={() => void resolve(agent.id)}>使用 {agent.id} 版本</button>
              ))}
            <button className="button primary" disabled={pending} onClick={() => void resolve("central")}>使用中心版本</button>
          </div>
        </aside>
      )}
    </div>
  );
}

function sourceUsable(value: string | undefined): boolean {
  return value === "linked" || value === "copied" || value === "local changes";
}

function AgentToggle({
  value,
  disabled,
  onToggle
}: {
  value: string;
  disabled: boolean;
  onToggle(enabled: boolean): void;
}) {
  const off = value === "disabled";
  const healthy = value === "linked" || value === "copied";
  // Missing / errored Agents are not togglable here (use Settings → populate).
  if (value === "missing" || value === "error" || value === "foreign link") {
    return <span className="agent muted">{translateAgent(value)}</span>;
  }
  return (
    <div className="agent-toggle">
      <button
        type="button"
        role="switch"
        aria-checked={!off}
        aria-label={off ? "启用" : "关闭"}
        className={`switch ${off ? "" : "on"}`}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(off);
        }}
      >
        <span className="switch-thumb" />
      </button>
      <span className={off ? "agent muted" : healthy ? "agent healthy" : "agent warning"}>
        {off ? null : healthy ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}
        {translateAgent(value)}
      </span>
    </div>
  );
}

function translateAgent(value: string) {
  return ({ linked: "已链接", copied: "已复制", "local changes": "本地有修改", missing: "缺失", disabled: "已关闭", "foreign link": "外部链接" } as Record<string, string>)[value] ?? value;
}

function Status({ value }: { value: SkillSummary["overall"] }) {
  const labels = { Synced: "已同步", "Local changes": "需要处理", Missing: "缺失", Error: "存在冲突" };
  return <span className={`status ${value === "Synced" ? "ok" : "attention"}`}><i />{labels[value]}</span>;
}
