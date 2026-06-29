import { File } from "@phosphor-icons/react/File";
import { X } from "@phosphor-icons/react/X";
import { useState } from "react";
import type { SkillPortApi } from "../../api.js";
import { useToast } from "../toast/Toast.js";

export function NewSkillDialog({
  api,
  onClose,
  onCreated
}: {
  api: SkillPortApi;
  onClose(): void;
  onCreated(): void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const toast = useToast();

  const create = async () => {
    try {
      await api.createSkill(name.trim(), description.trim() || undefined);
      toast.show(`已创建 ${name.trim()}`, "success");
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-skill-title">
        <button className="icon-button close" aria-label="关闭" onClick={onClose}><X /></button>
        <File size={26} weight="fill" className="modal-icon" />
        <h2 id="new-skill-title">新建 Skill</h2>
        <p>生成一个 SKILL.md 模板，并纳入所有已配置的 Agent。</p>
        <label>名称<input aria-label="名称" placeholder="例如 my-skill" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>描述 <span>可选</span><input aria-label="描述" placeholder="一句话说明用途" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {error && <div className="inline-error">{error}</div>}
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>取消</button>
          <button className="button primary" disabled={!name.trim()} onClick={() => void create()}>创建</button>
        </div>
      </div>
    </div>
  );
}
