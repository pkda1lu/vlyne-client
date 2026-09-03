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

/**
 * Whether a line is a connection winding down rather than something wrong.
 *
 * The core reports every closed connection at ERROR level, so a round of
 * latency checks paints the log red even when each one succeeded — the probe
 * closing the response body is precisely what a completed check looks like.
 * Genuine failures, a dial timing out for instance, read differently and are
 * left alone.
 */
function isTeardownNoise(text: string): boolean {
  if (!text.includes('connection:')) return false;
  return /closed|cancell?ed|reset by peer|EOF/i.test(text);
}

export function LogsView() {
  const { t } = useI18n();
  const logs = useStore((s) => s.logs);
  const toast = useStore((s) => s.toast);

  const [autoscroll, setAutoscroll] = useState(true);
  const [verbose, setVerbose] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const visible = verbose ? logs : logs.filter((l) => !isTeardownNoise(l.text));
  const hidden = logs.length - visible.length;

  useEffect(() => {
    if (!autoscroll) return;
    const el = container.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, autoscroll]);

  const copy = async () => {
    // Copy what is on screen: a report built from a filtered view should match
    // what the person filing it was looking at.
    await writeText(visible.map((l) => l.text).join('\n'));
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
          <div style={{ minWidth: 125 }}>
            <Switch label={t('logs.verbose')} checked={verbose} onChange={setVerbose} />
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

      {hidden > 0 && !verbose && (
        <p className="field__hint">{t('logs.hidden', { count: hidden })}</p>
      )}

      <div className="log" ref={container}>
        {visible.length === 0 ? (
          <span className="muted">{t('logs.empty')}</span>
        ) : (
          visible.map((line, i) => {
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
