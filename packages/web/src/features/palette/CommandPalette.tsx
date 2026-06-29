import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { useEffect, useState, type KeyboardEvent } from "react";
import type { SkillPortApi, SkillSummary } from "../../api.js";

type Page = "skills" | "discover" | "settings";

interface Item {
  kind: "nav" | "skill";
  id: string;
  label: string;
  detail?: string;
  page?: Page;
}

const NAV: Item[] = [
  { kind: "nav", id: "skills", label: "技能", page: "skills" },
  { kind: "nav", id: "discover", label: "发现", page: "discover" },
  { kind: "nav", id: "settings", label: "设置", page: "settings" }
];

export function CommandPalette({
  api,
  onClose,
  onNavigate,
  onSelectSkill
}: {
  api: SkillPortApi;
  onClose(): void;
  onNavigate(page: Page): void;
  onSelectSkill(name: string): void;
}) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    void api.listSkills().then(setSkills).catch(() => undefined);
  }, [api]);

  const q = query.trim().toLowerCase();
  const navMatches = NAV.filter((item) => !q || item.label.includes(query.trim()));
  const skillMatches: Item[] = skills
    .filter((skill) => !q || skill.name.toLowerCase().includes(q) || (skill.description ?? "").toLowerCase().includes(q))
    .slice(0, 8)
    .map((skill) => ({ kind: "skill", id: skill.name, label: skill.name, ...(skill.description ? { detail: skill.description } : {}) }));
  const items = [...navMatches, ...skillMatches];
  const active = Math.min(index, Math.max(0, items.length - 1));

  const activate = (item: Item) => {
    if (item.kind === "nav" && item.page) onNavigate(item.page);
    else onSelectSkill(item.id);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (event.key === "Enter") { event.preventDefault(); if (items[active]) activate(items[active]!); }
    else if (event.key === "Escape") { event.preventDefault(); onClose(); }
  };

  return (
    <div className="modal-backdrop palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <div className="palette-search">
          <MagnifyingGlass />
          <input autoFocus aria-label="搜索技能或跳转" placeholder="搜索技能或跳转…" value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); }} onKeyDown={onKeyDown} />
          <kbd>esc</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {items.length === 0 && <li className="palette-empty">没有匹配</li>}
          {items.map((item, i) => (
            <li
              key={`${item.kind}:${item.id}`}
              role="option"
              aria-selected={i === active}
              className={`palette-item ${i === active ? "active" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(event) => { event.preventDefault(); activate(item); }}
            >
              <span className={`palette-kind ${item.kind}`}>{item.kind === "nav" ? "跳转" : "技能"}</span>
              <span className="palette-label">{item.label}</span>
              {item.detail && <span className="palette-desc">{item.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
