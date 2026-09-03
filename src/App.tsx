import { AlertCircle, ArrowUpCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Sidebar, type ViewId } from './components/Sidebar';
import { useI18n } from './hooks/useI18n';
import { useUpdater } from './hooks/useUpdater';
import { TitleBar } from './components/TitleBar';
import { useStore } from './lib/store';
import { HomeView } from './views/HomeView';
import { LogsView } from './views/LogsView';
import { NodesView } from './views/NodesView';
import { RoutingView } from './views/RoutingView';
import { SettingsView } from './views/SettingsView';

export function App() {
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const toast = useStore((s) => s.toast);

  const [view, setView] = useState<ViewId>('home');
  const { t } = useI18n();
  const update = useUpdater();

  useEffect(() => {
    init().catch((error) => toast('error', String(error)));
  }, [init, toast]);

  return (
    <div className="shell">
      <TitleBar />
      <Sidebar view={view} onNavigate={setView} />

      <main className="main">
        {/* Nothing can render meaningfully before the first snapshot arrives. */}
        {!ready ? null : view === 'home' ? (
          <HomeView onManageNodes={() => setView('nodes')} />
        ) : view === 'nodes' ? (
          <NodesView />
        ) : view === 'routing' ? (
          <RoutingView />
        ) : view === 'settings' ? (
          <SettingsView />
        ) : (
          <LogsView />
        )}
      </main>

      <div className="toasts">
        {/* An update offer sits with the toasts but never dismisses itself. */}
        {update.available && (
          <div className="toast toast--success">
            <ArrowUpCircle size={16} color="var(--ok)" />
            <span className="toast__text">
              {t('update.available', { version: update.available.version })}
              {update.downloading && update.progress !== null && (
                <span className="meter" style={{ marginTop: 8 }}>
                  <span
                    className="meter__fill"
                    style={{ width: `${Math.round(update.progress * 100)}%` }}
                  />
                </span>
              )}
            </span>
            <button
              className="btn btn--sm btn--primary"
              onClick={() => void update.install()}
              disabled={update.downloading}
            >
              {update.downloading ? t('update.installing') : t('update.install')}
            </button>
            <button
              className="btn btn--ghost btn--icon"
              onClick={update.dismiss}
              disabled={update.downloading}
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {toasts.map((item) => (
          <div key={item.id} className={`toast toast--${item.kind}`}>
            {item.kind === 'error' ? (
              <AlertCircle size={16} color="var(--bad)" />
            ) : item.kind === 'success' ? (
              <CheckCircle2 size={16} color="var(--ok)" />
            ) : (
              <Info size={16} color="var(--ink-3)" />
            )}
            <span className="toast__text">{item.text}</span>
            <button
              className="btn btn--ghost btn--icon"
              onClick={() => dismissToast(item.id)}
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
