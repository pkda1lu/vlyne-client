import { ArrowDown, ArrowUp, Clock, Globe, Plus, Power, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { SpeedChart } from '../components/SpeedChart';
import { Segmented } from '../components/ui';
import { ServersPanel } from './ServersPanel';
import { useI18n } from '../hooks/useI18n';
import { daysUntil, formatBytes, formatDate, formatDuration, formatSpeed } from '../lib/format';
import { api } from '../lib/ipc';
import { useStore } from '../lib/store';
import type { Subscription, TunnelMode } from '../lib/types';

/**
 * Connecting and the servers to connect to, side by side.
 *
 * The two used to be separate sections, which meant picking a server and
 * seeing the result of that choice never fit on one screen. The list keeps
 * the left column and everything about the live tunnel stays on the right.
 */
export function HomeView() {
  const { t, locale } = useI18n();
  const status = useStore((s) => s.status);
  const traffic = useStore((s) => s.traffic);
  const history = useStore((s) => s.history);
  const data = useStore((s) => s.data);
  const busy = useStore((s) => s.busy);
  const toggle = useStore((s) => s.toggle);
  const toast = useStore((s) => s.toast);
  const toastError = useStore((s) => s.toastError);
  const activeOutboundId = useStore((s) => s.activeOutboundId);

  const [uptime, setUptime] = useState(0);
  const [adding, setAdding] = useState(false);
  const [ip, setIp] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const state = status?.state ?? 'disconnected';
  const connected = state === 'connected';
  const hasNodes = (data?.nodes.length ?? 0) > 0;

  // Tick the session clock locally rather than pushing a status event a second.
  useEffect(() => {
    if (!connected || !status?.connectedSince) {
      setUptime(0);
      return;
    }
    const since = status.connectedSince;
    const tick = () => setUptime(Math.max(0, Date.now() / 1000 - since));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [connected, status?.connectedSince]);

  // A stale IP from a previous session would be actively misleading.
  useEffect(() => {
    if (!connected) setIp(null);
  }, [connected]);

  const checkIp = async () => {
    setChecking(true);
    try {
      setIp(await api.checkConnectivity());
    } catch (error) {
      toastError(error);
    } finally {
      setChecking(false);
    }
  };

  const setMode = async (mode: TunnelMode) => {
    try {
      const needsElevation = await api.setMode(mode);
      if (needsElevation) {
        toast('info', t('home.elevationNeeded'));
      }
    } catch (error) {
      toastError(error);
    }
  };

  const orbClass = [
    'orb',
    state === 'connecting' || state === 'stopping' ? 'orb--connecting' : '',
    connected ? 'orb--connected' : '',
    state === 'failed' ? 'orb--failed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // In automatic mode the core picks the node, so name the one it actually
  // chose; while disconnected neither is set, so fall back to the persisted
  // choice rather than showing nothing.
  const activeNode =
    data?.nodes.find(
      (n) => n.id === (activeOutboundId ?? status?.nodeId ?? data?.activeNodeId),
    ) ?? null;

  // Show the plan the active server came from. With none selected, and only
  // one subscription in play, that one is unambiguous enough to show anyway.
  const plan = (() => {
    const subs = data?.subscriptions.filter((s) => s.usage) ?? [];
    const owner = activeNode?.subscriptionId
      ? subs.find((s) => s.id === activeNode.subscriptionId)
      : undefined;
    return owner ?? (subs.length === 1 ? subs[0] : undefined) ?? null;
  })();

  const detail = () => {
    if (state === 'failed' && status?.error) return status.error;
    if (!hasNodes) return t('home.noNode');
    if (connected && activeNode) {
      return status?.nodeId
        ? `${activeNode.name} · ${activeNode.server}:${activeNode.serverPort}`
        : t('home.autoUsing', { name: activeNode.name });
    }
    if (activeNode) return activeNode.name;
    return connected ? t('home.tapToDisconnect') : t('home.tapToConnect');
  };

  return (
    <div className="workspace">
      <aside className="workspace__servers">
        <ServersPanel adding={adding} onAddingChange={setAdding} />
      </aside>

      <div className="workspace__main">
        <div className="stack stack--lg">
          <div className="view-header">
            <div>
              <h1 className="view-title">{t('nav.home')}</h1>
              <p className="view-subtitle">{t('home.subtitle')}</p>
            </div>

            <Segmented<TunnelMode>
              value={data?.settings.mode ?? 'systemProxy'}
              onChange={setMode}
              options={[
                { value: 'systemProxy', label: t('home.modeProxy') },
                { value: 'tun', label: t('home.modeTun') },
              ]}
            />
          </div>

          <div className="connect">
            <button
              className={orbClass}
              onClick={hasNodes ? toggle : () => setAdding(true)}
              disabled={busy}
              aria-label={connected ? t('home.tapToDisconnect') : t('home.tapToConnect')}
            >
              <span className="orb__ring orb__ring--outer" aria-hidden />
              <span className="orb__ring orb__ring--inner" aria-hidden />
              <span className="orb__core">
                <Power size={40} strokeWidth={1.6} />
              </span>
            </button>

            <div className="connect__state">{t(`state.${state}`)}</div>
            <div className="connect__detail">{detail()}</div>

            {/* With nothing to connect to, the only useful action is adding a
                server, so offer it outright instead of leaving the orb as the
                sole, unlabelled way through. */}
            {!hasNodes && (
              <button className="btn btn--primary" onClick={() => setAdding(true)}>
                <Plus size={15} />
                {t('nodes.add')}
              </button>
            )}

            {connected && (
              <div className="row">
                <button className="btn btn--sm" onClick={checkIp} disabled={checking}>
                  <ShieldCheck size={14} />
                  {checking ? t('home.checkingIp') : t('home.checkIp')}
                </button>
                {ip && <span className="chip chip--ok">{t('home.yourIp', { ip })}</span>}
              </div>
            )}

            {data?.settings.mode === 'tun' && status && !status.elevated && (
              <button className="btn btn--primary btn--sm" onClick={() => api.restartElevated()}>
                {t('home.restartAsAdmin')}
              </button>
            )}
          </div>

          <div className="metrics">
            <Metric
              icon={<ArrowDown size={13} />}
              label={t('home.download')}
              value={formatSpeed(traffic.down)}
              tone="down"
            />
            <Metric
              icon={<ArrowUp size={13} />}
              label={t('home.upload')}
              value={formatSpeed(traffic.up)}
              tone="up"
            />
            <Metric
              icon={<Globe size={13} />}
              label={t('home.sessionTotal')}
              value={formatBytes(traffic.totalDown + traffic.totalUp)}
            />
            <Metric
              icon={<Clock size={13} />}
              label={t('home.uptime')}
              value={formatDuration(uptime)}
            />
          </div>

          {plan && <PlanSummary subscription={plan} locale={locale} />}

          <section className="card">
            <SpeedChart history={history} label={t('home.download')} />
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * What is left of the plan: traffic and time.
 *
 * The numbers come from the `subscription-userinfo` header the provider sends
 * with the subscription, so a plan that reports neither a quota nor an expiry
 * shows nothing rather than an empty frame.
 */
function PlanSummary({
  subscription,
  locale,
}: {
  subscription: Subscription;
  locale: string;
}) {
  const { t } = useI18n();
  const usage = subscription.usage;
  if (!usage) return null;

  const hasQuota = usage.total > 0;
  const used = usage.upload + usage.download;
  // A provider that over-reports usage should not produce a negative figure.
  const left = Math.max(0, usage.total - used);
  const ratio = hasQuota ? Math.min(1, used / usage.total) : 0;

  const daysLeft = usage.expire ? daysUntil(usage.expire) : null;
  const hasExpiry = daysLeft !== null;
  if (!hasQuota && !hasExpiry) return null;

  const trafficTone = ratio > 0.9 ? 'bad' : ratio > 0.75 ? 'warn' : 'ok';
  const timeTone = daysLeft === null ? 'ok' : daysLeft <= 0 ? 'bad' : daysLeft < 5 ? 'warn' : 'ok';

  return (
    <section className="card">
      <div className="row row--between" style={{ marginBottom: 10 }}>
        <span className="card__title" style={{ margin: 0 }}>
          {subscription.name}
        </span>
        {hasExpiry && (
          <span className={`chip${timeTone === 'ok' ? '' : ` chip--${timeTone}`}`}>
            {daysLeft! <= 0
              ? t('nodes.expired')
              : daysLeft! < 30
                ? t('nodes.expiresIn', { days: daysLeft! })
                : t('nodes.expires', { date: formatDate(usage.expire, locale) })}
          </span>
        )}
      </div>

      {hasQuota ? (
        <>
          <div className="row row--between" style={{ marginBottom: 6 }}>
            <span className="metric__value" style={{ fontSize: 20 }}>
              {t('home.trafficLeft', { left: formatBytes(left) })}
            </span>
            <span className="field__hint">
              {t('nodes.usage', {
                used: formatBytes(used),
                total: formatBytes(usage.total),
              })}
            </span>
          </div>
          <span className="meter">
            <span
              className={`meter__fill${trafficTone === 'ok' ? '' : ` meter__fill--${trafficTone}`}`}
              style={{ width: `${ratio * 100}%` }}
            />
          </span>
        </>
      ) : (
        <span className="field__hint">{t('home.trafficUnlimited')}</span>
      )}
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'up' | 'down';
}) {
  return (
    <div className="metric">
      <div className="metric__label">
        {icon}
        {label}
      </div>
      <div className={`metric__value${tone ? ` metric__value--${tone}` : ''}`}>{value}</div>
    </div>
  );
}
