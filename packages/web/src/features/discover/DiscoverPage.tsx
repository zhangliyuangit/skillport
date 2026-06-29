import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Stack } from "@phosphor-icons/react/Stack";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { useEffect, useState } from "react";
import type { DiscoveredSkill, SkillContent, SkillPortApi } from "../../api.js";
import { usePolling } from "../../hooks.js";
import { SkillContentView } from "../../SkillContentView.js";
import { useToast } from "../toast/Toast.js";

const ADDABLE = new Set<DiscoveredSkill["classification"]>([
  "single-source",
  "identical"
]);

export function DiscoverPage({ api }: { api: SkillPortApi }) {
  const [items, setItems] = useState<DiscoveredSkill[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<SkillContent>();
  const toast = useToast();

  const load = async () => {
    try {
      setItems(await api.discover());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "扫描失败");
    }
  };
  useEffect(() => { void load(); }, []);
  usePolling(() => { if (!busy && !preview) void load(); }, 8000);

  // The Discover page only lists Skills that are not yet managed.
  const visible = items
    .filter((item) => item.classification !== "managed")
    .filter((item) => {
      const q = query.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        (item.description ?? "").toLowerCase().includes(q)
      );
    });
  const eligible = visible.filter((item) => ADDABLE.has(item.classification));

  const showPreview = async (item: DiscoveredSkill) => {
    try {
      setPreview(await api.previewAgent(item.agents[0]!, item.name));
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : `预览 ${item.name} 失败`, "error");
    }
  };

  const addOne = async (item: DiscoveredSkill) => {
    setBusy(true);
    try {
      await api.add(item.name, item.agents[0]);
      toast.show(`已纳入 ${item.name}`, "success");
      await load();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : `纳入 ${item.name} 失败`, "error");
    } finally {
      setBusy(false);
    }
  };

  const deleteSkill = async (item: DiscoveredSkill) => {
    const where = item.agents.join("、");
    if (!window.confirm(`从 ${where} 删除「${item.name}」？将移入回收站，可手动恢复。`)) return;
    setBusy(true);
    try {
      for (const agent of item.agents) await api.deleteSkill(agent, item.name);
      toast.show(`已删除「${item.name}」（移入回收站）`, "success");
      await load();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : `删除 ${item.name} 失败`, "error");
    } finally {
      setBusy(false);
    }
  };

  const addAll = async () => {
    const targets = eligible;
    if (targets.length === 0) return;
    setBusy(true);
    setError("");
    const skipped = visible.length - targets.length;
    let added = 0;
    const failed: string[] = [];
    for (const item of targets) {
      setNotice(`正在纳入 ${added + failed.length + 1}/${targets.length}…`);
      try {
        await api.add(item.name, item.agents[0]);
        added += 1;
      } catch {
        failed.push(item.name);
      }
    }
    await load();
    setBusy(false);
    setNotice("");
    const parts = [`已纳入 ${added} 个`];
    if (failed.length) parts.push(`${failed.length} 个失败（${failed.join("、")}）`);
    if (skipped) parts.push(`${skipped} 个需手动处理（冲突或无法读取）`);
    toast.show(`${parts.join("，")}。`, failed.length ? "error" : "success");
  };

  return (
    <section className="standalone-page">
      <header className="page-header">
        <div><h1>发现</h1><p>扫描 Codex 和 Claude Code 中尚未纳入管理的 Skill。</p></div>
        <div className="header-actions">
          <button className="button primary" disabled={busy || eligible.length === 0} onClick={() => void addAll()}><Stack />一键纳入{eligible.length ? `（${eligible.length}）` : ""}</button>
          <button className="button secondary" disabled={busy} onClick={() => void load()}><ArrowClockwise />重新扫描</button>
        </div>
      </header>
      <div className="toolbar">
        <label className="search"><MagnifyingGlass /><input aria-label="搜索技能" placeholder="搜索名称或说明..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>
      {error && <div className="inline-error">{error}</div>}
      {notice && <div className="inline-notice">{notice}</div>}
      <div className="table-wrap">
        <table><thead><tr><th>名称</th><th>所在 Agent</th><th>检查结果</th><th /></tr></thead>
          <tbody>{visible.map((item) => <tr key={item.name}><td className="strong">{item.name}{item.description && <small className="skill-desc">{item.description}</small>}</td><td>{item.agents.join("、")}</td><td>{item.classification === "error" ? <span className="agent warning"><WarningCircle />无法读取</span> : item.classification === "conflict" ? <span className="agent warning"><WarningCircle />内容不一致</span> : <span className="agent healthy"><CheckCircle />可以纳入</span>}</td><td><div className="row-actions"><button className="button compact" disabled={busy} onClick={() => void showPreview(item)}>预览</button><button className="button compact" disabled={busy || item.classification === "error"} onClick={() => void addOne(item)}>纳入管理</button><button className="button compact danger" disabled={busy} onClick={() => void deleteSkill(item)}>删除</button></div></td></tr>)}</tbody>
        </table>
        {visible.length === 0 && <div className="empty">没有发现新的 Skill</div>}
      </div>

      {preview && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(undefined); }}>
          <div className="modal preview-modal" role="dialog" aria-modal="true">
            <button className="icon-button close" aria-label="关闭" onClick={() => setPreview(undefined)}><X /></button>
            <h2>{preview.name}</h2><span className="muted">SKILL.md</span>
            <SkillContentView text={preview.text} truncated={preview.truncated} />
          </div>
        </div>
      )}
    </section>
  );
}
