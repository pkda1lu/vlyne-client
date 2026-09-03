import { Globe, Power, ScrollText, Server, Settings2 } from 'lucide-react';

import { useI18n } from '../hooks/useI18n';
import { useStore } from '../lib/store';

export type ViewId = 'home' | 'nodes' | 'routing' | 'settings' | 'logs';

const ITEMS: { id: ViewId; icon: typeof Power; labelKey: string }[] = [
  { id: 'home', icon: Power, labelKey: 'nav.home' },
  { id: 'nodes', icon: Server, labelKey: 'nav.nodes' },
  { id: 'routing', icon: Globe, labelKey: 'nav.routing' },
  { id: 'settings', icon: Settings2, labelKey: 'nav.settings' },
  { id: 'logs', icon: ScrollText, labelKey: 'nav.logs' },
];

export function Sidebar({
  view,
  onNavigate,
}: {
  view: ViewId;
  onNavigate: (view: ViewId) => void;
}) {
  const { t } = useI18n();
  const nodeCount = useStore((s) => s.data?.nodes.length ?? 0);
  const appVersion = useStore((s) => s.appVersion);
  const coreVersion = useStore((s) => s.coreVersion);

  return (
    <nav className="sidebar">
      {ITEMS.map(({ id, icon: Icon, labelKey }) => (
        <button
          key={id}
          className={`nav-item${view === id ? ' nav-item--active' : ''}`}
          onClick={() => onNavigate(id)}
          aria-current={view === id ? 'page' : undefined}
        >
          <Icon size={17} />
          <span>{t(labelKey)}</span>
          {/* Only the server count is worth surfacing at a glance. */}
          {id === 'nodes' && nodeCount > 0 && (
            <span className="nav-item__badge">{nodeCount}</span>
          )}
        </button>
      ))}

      <div className="sidebar__footer">
        <span>Vlyne {appVersion}</span>
        <span>sing-box {coreVersion}</span>
      </div>
    </nav>
  );
}
