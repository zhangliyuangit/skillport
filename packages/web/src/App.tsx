import { GearSix } from "@phosphor-icons/react/GearSix";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { SquaresFour } from "@phosphor-icons/react/SquaresFour";
import { useState } from "react";
import type { SkillPortApi } from "./api.js";
import { DiscoverPage } from "./features/discover/DiscoverPage.js";
import { InstallDialog } from "./features/install/InstallDialog.js";
import { SettingsPage } from "./features/settings/SettingsPage.js";
import { SkillsPage } from "./features/skills/SkillsPage.js";

type Page = "skills" | "discover" | "settings";

export function App({ api }: { api: SkillPortApi }) {
  const [page, setPage] = useState<Page>("skills");
  const [installOpen, setInstallOpen] = useState(false);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Skill<span>Port</span></div>
        <nav aria-label="主导航">
          <NavButton active={page === "skills"} onClick={() => setPage("skills")} icon={<SquaresFour />}>
            技能
          </NavButton>
          <NavButton active={page === "discover"} onClick={() => setPage("discover")} icon={<MagnifyingGlass />}>
            发现
          </NavButton>
          <NavButton active={page === "settings"} onClick={() => setPage("settings")} icon={<GearSix />}>
            设置
          </NavButton>
        </nav>
        <div className="sidebar-foot">
          <span className="health-dot" />
          <div><strong>本地服务正常</strong><small>~/.skillport/skills</small></div>
        </div>
      </aside>

      <main className="workspace">
        {page === "skills" && (
          <SkillsPage api={api} onInstall={() => setInstallOpen(true)} />
        )}
        {page === "discover" && <DiscoverPage api={api} />}
        {page === "settings" && <SettingsPage />}
      </main>

      {installOpen && (
        <InstallDialog
          api={api}
          onClose={() => setInstallOpen(false)}
          onInstalled={() => {
            setInstallOpen(false);
            setPage("skills");
          }}
        />
      )}
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  children
}: {
  active: boolean;
  onClick(): void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}{children}
    </button>
  );
}
