import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { X } from "@phosphor-icons/react/X";
import { useState } from "react";
import type { SkillPortApi } from "../../api.js";
import { useToast } from "../toast/Toast.js";

export function InstallDialog({ api, onClose, onInstalled }: { api: SkillPortApi; onClose(): void; onInstalled(): void }) {
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const toast = useToast();
  const install = async () => {
    try {
      const result = await api.install(url, path || undefined);
      const skipped = result.skipped ?? [];
      if (skipped.length > 0) {
        const names = skipped.map((entry) => entry.split("/").pop()).filter(Boolean).join("、");
        toast.show(`已安装 ${result.name}，跳过 ${skipped.length} 个软链：${names}`, "success");
      } else {
        toast.show(`已安装 ${result.name}`, "success");
      }
      onInstalled();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "安装失败");
    }
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <button className="icon-button close" aria-label="关闭" onClick={onClose}><X /></button>
        <GithubLogo size={28} weight="fill" className="modal-icon" />
        <h2 id="install-title">从 GitHub 安装</h2>
        <p>支持仓库根目录，或指定包含 SKILL.md 的子目录。</p>
        <label>仓库地址<input aria-label="仓库地址" placeholder="https://github.com/acme/skills" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
        <label>Skill 子目录 <span>可选</span><input aria-label="Skill 子目录" placeholder="skills/pdf" value={path} onChange={(event) => setPath(event.target.value)} /></label>
        {error && <div className="inline-error">{error}</div>}
        <div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={!url.startsWith("https://github.com/")} onClick={() => void install()}>安装</button></div>
      </div>
    </div>
  );
}
