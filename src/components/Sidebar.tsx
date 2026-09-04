import { Globe, Power, ScrollText, Settings2, Wallet } from 'lucide-react';

import { useI18n } from '../hooks/useI18n';
import { useStore } from '../lib/store';

export type ViewId = 'home' | 'account' | 'routing' | 'settings' | 'logs';

const ITEMS: { id: ViewId; icon: typeof Power; labelKey: string }[] = [
  { id: 'home', icon: Power, labelKey: 'nav.home' },
  { id: 'account', icon: Wallet, labelKey: 'nav.account' },
  { id: 'routing', icon: Globe, labelKey: 'nav.routing' },
  { id: 'settings', icon: Settings2, labelKey: 'nav.settings' },
  { id: 'logs', icon: ScrollText, labelKey: 'nav.logs' },
];

/**
 * The rail sits collapsed to its icons and widens on hover, so the servers
 * beside it keep the width. It overlays the main column while open rather
 * than pushing it, which would reflow the whole view on a stray pointer.
 */
export function Sidebar({
  view,
  onNavigate,
}: {
  view: ViewId;
  onNavigate: (view: ViewId) => void;
}) {
  const { t } = useI18n();
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
          /* Collapsed, the icon is all there is to go on. */
          title={t(labelKey)}
        >
          <Icon size={17} className="nav-item__icon" />
          <span className="nav-item__label">{t(labelKey)}</span>
        </button>
      ))}

      <div className="sidebar__footer">
        <span>Vlyne {appVersion}</span>
        <span>sing-box {coreVersion}</span>
      </div>
    </nav>
  );
}
