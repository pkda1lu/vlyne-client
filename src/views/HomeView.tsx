import { ArrowDown, ArrowUp, Clock, Globe, Plus, Power, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { SpeedChart } from '../components/SpeedChart';
import { Segmented } from '../components/ui';
import { useI18n } from '../hooks/useI18n';
import { formatBytes, formatDuration, formatSpeed } from '../lib/format';
import { api } from '../lib/ipc';
import { useStore } from '../lib/store';
import type { TunnelMode } from '../lib/types';

export function HomeView({ onManageNodes }: { onManageNodes: () => void }) {
  const { t } = useI18n();
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
          onClick={hasNodes ? toggle : onManageNodes}
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
          <button className="btn btn--primary" onClick={onManageNodes}>
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

      <section className="card">
        <SpeedChart history={history} label={t('home.download')} />
      </section>
    </div>
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
