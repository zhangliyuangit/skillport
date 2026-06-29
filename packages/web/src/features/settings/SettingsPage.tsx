import { useEffect, useState, type FormEvent } from "react";
import type { AgentConfig, Diagnosis, SkillPortApi, Snapshot } from "../../api.js";
import { usePolling } from "../../hooks.js";
import { useToast } from "../toast/Toast.js";

const DIAG_LABEL: Record<Diagnosis["kind"], string> = {
  missing: "缺少链接",
  dangling: "死链",
  drift: "内容漂移",
  orphan: "孤儿副本",
  foreign: "外部占用",
  broken: "中心缺失"
};

// Snapshot ids are ISO timestamps with `:` and `.` swapped for `-`; render the
// date and time back in a form people read at a glance.
function formatSnapshotTime(id: string): string {
  const match = id.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return id;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

// Auto-snapshots carry machine labels like `before-sync-pdf`; name them by what
// the person would recognize.
function snapshotReason(label?: string): string {
  if (!label) return "手动快照";
  if (label.startsWith("before-sync-")) return `同步前 · ${label.slice("before-sync-".length)}`;
  if (label.startsWith("before-update-")) return `更新前 · ${label.slice("before-update-".length)}`;
  if (label.startsWith("before-restore-")) return "回滚前";
  return label;
}

export function SettingsPage({ api }: { api: SkillPortApi }) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [id, setId] = useState("");
  const [root, setRoot] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Diagnosis[]>();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const toast = useToast();

  const load = async () => {
    try {
      const [nextAgents, nextSnapshots] = await Promise.all([api.listAgents(), api.listSnapshots()]);
      setAgents(nextAgents);
      setSnapshots(nextSnapshots);
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

  const check = () =>
    void run(async () => {
      const found = await api.doctor();
      setIssues(found);
      toast.show(found.length ? `发现 ${found.length} 个问题` : "一切正常 ✓", found.length ? "error" : "success");
    });

  const repair = () =>
    void run(async () => {
      const result = await api.repair();
      setIssues(result.remaining);
      toast.show(`已修复 ${result.fixed} 个` + (result.remaining.length ? `，剩 ${result.remaining.length} 个需手动处理` : ""), "success");
    });

  const takeSnapshot = () =>
    void run(async () => {
      await api.createSnapshot();
      toast.show("已保存当前状态为快照", "success");
    });

  const restore = (snapshot: Snapshot) => {
    if (!window.confirm(`回滚到 ${formatSnapshotTime(snapshot.id)} 的快照？当前状态会先自动快照，回滚本身也能再撤销。`)) return;
    void run(async () => {
      const result = await api.restoreSnapshot(snapshot.id);
      toast.show(`已回滚 ${result.restored.length} 个 Skill 到该时间点`, "success");
    });
  };

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

      <div className="section-title">健康检查 <span>死链 / 漂移 / 孤儿</span></div>
      <div className="row-actions">
        <button className="button secondary" disabled={busy} onClick={check}>检查</button>
        {issues && issues.some((issue) => issue.fixable) && (
          <button className="button primary" disabled={busy} onClick={repair}>一键修复</button>
        )}
      </div>
      {issues && (issues.length === 0 ? (
        <p className="settings-note">✓ 一切正常，没有发现问题。</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Skill</th><th>Agent</th><th>问题</th><th>说明</th></tr></thead>
            <tbody>
              {issues.map((issue, index) => (
                <tr key={`${issue.name}-${issue.agent ?? ""}-${index}`}>
                  <td className="strong">{issue.name}</td>
                  <td>{issue.agent ?? "—"}</td>
                  <td><span className={`agent ${issue.fixable ? "warning" : "muted"}`}>{DIAG_LABEL[issue.kind]}</span></td>
                  <td>{issue.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="section-title">快照 <span>回滚到任意时间点</span></div>
      <div className="row-actions">
        <button className="button secondary" disabled={busy} onClick={takeSnapshot}>立即快照</button>
      </div>
      <p className="settings-note">同步 / 更新前会自动快照；回滚前也会先保存当前状态，所以回滚本身也能再撤销。最多保留最近 25 个。</p>
      {snapshots.length === 0 ? (
        <p className="settings-note">还没有快照。执行同步 / 更新会自动生成，或点「立即快照」手动保存当前状态。</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>时间</th><th>来由</th><th /></tr></thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.id}>
                  <td className="strong"><code className="path">{formatSnapshotTime(snapshot.id)}</code></td>
                  <td>{snapshotReason(snapshot.label)}</td>
                  <td><button className="button compact" disabled={busy} onClick={() => restore(snapshot)}>回滚</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
