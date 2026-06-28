import { useEffect, useState, type FormEvent } from "react";
import type { AgentConfig, SkillPortApi } from "../../api.js";
import { usePolling } from "../../hooks.js";
import { useToast } from "../toast/Toast.js";

export function SettingsPage({ api }: { api: SkillPortApi }) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [id, setId] = useState("");
  const [root, setRoot] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => {
    try {
      setAgents(await api.listAgents());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    }
  };
  useEffect(() => { void load(); }, []);
  usePolling(() => { if (!busy) void load(); }, 5000);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : "操作失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!id.trim() || !root.trim()) return;
    void run(async () => {
      const newId = id.trim();
      await api.addAgent(newId, root.trim());
      toast.show(`已添加 Agent ${newId}，可点该行“补齐”`, "success");
      setId("");
      setRoot("");
    });
  };

  const populate = (agentId: string) =>
    void run(async () => {
      const result = await api.populateAgent(agentId);
      toast.show(
        `${agentId}：补齐 ${result.installed.length} 个` +
          (result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ""),
        "success"
      );
    });

  return (
    <section className="standalone-page settings-page">
      <header className="page-header"><div><h1>设置</h1><p>管理 SkillPort 同步的 Agent 端。中心仓库：~/.skillport/skills。</p></div></header>
      {error && <div className="inline-error">{error}</div>}

      <div className="section-title">Agent 端</div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>Skill 目录</th><th /></tr></thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <td className="strong">{agent.id}</td>
                <td><code className="path">{agent.root}</code></td>
                <td>
                  <div className="settings-row-actions">
                    <button className="button compact" disabled={busy} onClick={() => populate(agent.id)}>补齐</button>
                    <button className="button compact" disabled={busy || agents.length <= 1} onClick={() => void run(async () => { await api.removeAgent(agent.id); toast.show(`已移除 Agent ${agent.id}`, "success"); })}>移除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="settings-form agent-add-form" onSubmit={add}>
        <label>Agent 名称<input value={id} placeholder="例如 qoder" onChange={(event) => setId(event.target.value)} /></label>
        <label>Skill 目录（绝对路径）<input value={root} placeholder="/Users/you/.qoder/skills" onChange={(event) => setRoot(event.target.value)} /></label>
        <button className="button primary" type="submit" disabled={busy}>添加 Agent</button>
      </form>
      <p className="settings-note">新增 Agent 后，点对应行的“补齐”把已有受管 Skill 的中心版本装进该端（自动跳过有冲突或本地改动的）。</p>
    </section>
  );
}
