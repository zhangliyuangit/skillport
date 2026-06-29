import { useState } from "react";
import { Markdown } from "./Markdown.js";

/** SKILL.md viewer with a rendered Markdown / raw source toggle. */
export function SkillContentView({ text, truncated }: { text: string; truncated: boolean }) {
  const [raw, setRaw] = useState(false);
  return (
    <div className="content-view">
      <div className="content-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!raw} className={`tab ${raw ? "" : "active"}`} onClick={() => setRaw(false)}>预览</button>
        <button type="button" role="tab" aria-selected={raw} className={`tab ${raw ? "active" : ""}`} onClick={() => setRaw(true)}>源码</button>
      </div>
      {raw ? (
        <pre className="skill-content">{text}{truncated ? "\n…（已截断）" : ""}</pre>
      ) : (
        <div className="skill-content markdown-scroll">
          <Markdown text={text} />
          {truncated && <p className="markdown-empty">…（内容已截断）</p>}
        </div>
      )}
    </div>
  );
}
