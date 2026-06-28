import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { useEffect, useState } from "react";
import type { DiscoveredSkill, SkillPortApi } from "../../api.js";

export function DiscoverPage({ api }: { api: SkillPortApi }) {
  const [items, setItems] = useState<DiscoveredSkill[]>([]);
  const load = async () => setItems(await api.discover());
  useEffect(() => { void load(); }, []);

  return (
    <section className="standalone-page">
      <header className="page-header"><div><h1>发现</h1><p>扫描 Codex 和 Claude Code 中尚未纳入管理的 Skill。</p></div><button className="button secondary" onClick={() => void load()}><ArrowClockwise />重新扫描</button></header>
      <div className="table-wrap">
        <table><thead><tr><th>名称</th><th>所在 Agent</th><th>检查结果</th><th /></tr></thead>
          <tbody>{items.map((item) => <tr key={item.name}><td className="strong">{item.name}</td><td>{item.agents.join("、")}</td><td>{item.classification === "error" ? <span className="agent warning"><WarningCircle />无法读取</span> : item.classification === "conflict" ? <span className="agent warning"><WarningCircle />内容不一致</span> : <span className="agent healthy"><CheckCircle />可以纳入</span>}</td><td><button className="button compact" disabled={item.classification === "error"} onClick={() => void api.add(item.name, item.agents[0])}>纳入管理</button></td></tr>)}</tbody>
        </table>
        {items.length === 0 && <div className="empty">没有发现新的 Skill</div>}
      </div>
    </section>
  );
}
