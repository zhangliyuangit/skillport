import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Renders SKILL.md body as Markdown (GFM). The YAML frontmatter is stripped —
 * its name/description are already shown as fields. Raw HTML is not rendered,
 * so untrusted Skill content cannot inject markup.
 */
export function Markdown({ text }: { text: string }) {
  const body = text.replace(FRONTMATTER, "").trim();
  if (!body) return <p className="markdown-empty">（无正文内容）</p>;
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
          )
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
