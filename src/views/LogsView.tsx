import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { Copy, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Switch } from '../components/ui';
import { useI18n } from '../hooks/useI18n';
import { api } from '../lib/ipc';
import { useStore } from '../lib/store';

/** Colour a line by the severity sing-box prints inside it. */
function severity(text: string): '' | 'error' | 'warn' {
  const lower = text.toLowerCase();
  if (lower.includes('error') || lower.includes('fatal')) return 'error';
  if (lower.includes('warn')) return 'warn';
  return '';
}

export function LogsView() {
  const { t } = useI18n();
  const logs = useStore((s) => s.logs);
  const toast = useStore((s) => s.toast);

  const [autoscroll, setAutoscroll] = useState(true);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoscroll) return;
    const el = container.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, autoscroll]);

  const copy = async () => {
    await writeText(logs.map((l) => l.text).join('\n'));
    toast('success', t('logs.copied'));
  };

  return (
    <div className="stack">
      <div className="view-header">
        <div>
          <h1 className="view-title">{t('logs.title')}</h1>
          <p className="view-subtitle">{t('logs.subtitle')}</p>
        </div>

        <div className="row">
          {/* `Switch` renders its own label, so it must not be nested in one. */}
          <div style={{ minWidth: 150 }}>
            <Switch label={t('logs.autoscroll')} checked={autoscroll} onChange={setAutoscroll} />
          </div>
          <button className="btn btn--sm" onClick={copy} disabled={logs.length === 0}>
            <Copy size={13} />
            {t('logs.copy')}
          </button>
          <button
            className="btn btn--sm"
            onClick={() => {
              void api.clearLogs();
              useStore.setState({ logs: [] });
            }}
            disabled={logs.length === 0}
          >
            <Trash2 size={13} />
            {t('logs.clear')}
          </button>
        </div>
      </div>

      <div className="log" ref={container}>
        {logs.length === 0 ? (
          <span className="muted">{t('logs.empty')}</span>
        ) : (
          logs.map((line, i) => {
            const kind = severity(line.text);
            return (
              <div key={`${line.at}-${i}`} className={kind ? `log__line--${kind}` : undefined}>
                {line.text}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
