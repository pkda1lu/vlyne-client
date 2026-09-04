import { disable as disableAutostart, enable as enableAutostart } from '@tauri-apps/plugin-autostart';
import { FolderOpen, FileJson } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Card, CommitInput, Field, Modal, Switch } from '../components/ui';
import { useI18n } from '../hooks/useI18n';
import { api } from '../lib/ipc';
import { useStore } from '../lib/store';
import type { Settings } from '../lib/types';

export function SettingsView() {
  const { t } = useI18n();
  const settings = useStore((s) => s.data?.settings);
  const save = useStore((s) => s.saveSettings);
  const toastError = useStore((s) => s.toastError);
  const toast = useStore((s) => s.toast);
  const appVersion = useStore((s) => s.appVersion);
  const coreVersion = useStore((s) => s.coreVersion);

  const [preview, setPreview] = useState<string | null>(null);

  // The service address is stored with the account rather than in settings: it
  // sits next to a credential, and the config preview renders settings verbatim.
  const [apiBase, setApiBase] = useState('');
  useEffect(() => {
    api
      .accountInfo()
      .then((info) => setApiBase(info.apiBase))
      .catch(() => setApiBase(''));
  }, []);

  if (!settings) return null;

  /**
   * The base is re-read from the store rather than taken from this render.
   * Saving round-trips through the backend, so blurring two fields in quick
   * succession would otherwise have the second overwrite the first with a
   * clone made before the first had come back.
   */
  const patch = (mutate: (draft: Settings) => void) => {
    const current = useStore.getState().data?.settings ?? settings;
    const draft: Settings = structuredClone(current);
    mutate(draft);
    void save(draft);
  };

  /** Ports are only worth saving once they are a plausible port. */
  const port = (value: string, apply: (port: number) => void) => {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) apply(parsed);
  };

  /**
   * Registering with Windows is what actually makes this setting real, so the
   * stored flag is only updated once the registration succeeded.
   */
  const setLaunchAtLogin = async (enabled: boolean) => {
    try {
      if (enabled) await enableAutostart();
      else await disableAutostart();
      patch((d) => (d.general.launchAtLogin = enabled));
    } catch (error) {
      toastError(error);
    }
  };

  const showConfig = async () => {
    try {
      setPreview(await api.previewConfig());
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <div className="stack stack--lg">
      <div className="view-header">
        <div>
          <h1 className="view-title">{t('settings.title')}</h1>
        </div>
      </div>

      <Card title={t('settings.general')}>
        <Field label={t('settings.language')}>
          <select
            className="select"
            value={settings.general.language}
            onChange={(e) => patch((d) => (d.general.language = e.target.value))}
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </Field>

        <div style={{ marginTop: 8 }}>
          <Switch
            label={t('settings.autoConnect')}
            checked={settings.general.autoConnect}
            onChange={(v) => patch((d) => (d.general.autoConnect = v))}
          />
          <Switch
            label={t('settings.launchAtLogin')}
            checked={settings.general.launchAtLogin}
            onChange={(v) => void setLaunchAtLogin(v)}
          />
          <Switch
            label={t('settings.startMinimized')}
            checked={settings.general.startMinimized}
            onChange={(v) => patch((d) => (d.general.startMinimized = v))}
          />
          <Switch
            label={t('settings.closeToTray')}
            checked={settings.general.closeToTray}
            onChange={(v) => patch((d) => (d.general.closeToTray = v))}
          />
          <Switch
            label={t('settings.checkUpdates')}
            checked={settings.general.checkUpdates}
            onChange={(v) => patch((d) => (d.general.checkUpdates = v))}
          />
        </div>
      </Card>

      <Card title={t('settings.subscriptions')}>
        <Switch
          label={t('settings.subsCheckOnStart')}
          hint={t('settings.subsCheckOnStartHint')}
          checked={settings.subscriptions.checkOnStart}
          onChange={(v) => patch((d) => (d.subscriptions.checkOnStart = v))}
        />
        <Switch
          label={t('settings.subsAutoUpdate')}
          hint={t('settings.subsAutoUpdateHint')}
          checked={settings.subscriptions.autoUpdate}
          onChange={(v) => patch((d) => (d.subscriptions.autoUpdate = v))}
        />

        {/* The interval only means anything while the timer is running. */}
        {settings.subscriptions.autoUpdate && (
          <Field label={t('settings.subsInterval')} hint={t('settings.subsIntervalHint')}>
            <CommitInput
              type="number"
              value={String(settings.subscriptions.updateIntervalHours)}
              onCommit={(v) => {
                const hours = Number(v);
                // The same bounds the core clamps to, so the field never
                // shows a number the scheduler would quietly ignore.
                if (Number.isInteger(hours) && hours >= 1 && hours <= 168) {
                  patch((d) => (d.subscriptions.updateIntervalHours = hours));
                }
              }}
            />
          </Field>
        )}
      </Card>

      <Card title={t('settings.connection')}>
        <div className="grid-2">
          <Field label={t('settings.socksPort')}>
            <CommitInput
              type="number"
              value={String(settings.inbound.socksPort)}
              onCommit={(v) => port(v, (p) => patch((d) => (d.inbound.socksPort = p)))}
            />
          </Field>
          <Field label={t('settings.httpPort')}>
            <CommitInput
              type="number"
              value={String(settings.inbound.httpPort)}
              onCommit={(v) => port(v, (p) => patch((d) => (d.inbound.httpPort = p)))}
            />
          </Field>
          <Field label={t('settings.clashPort')}>
            <CommitInput
              type="number"
              value={String(settings.inbound.clashPort)}
              onCommit={(v) => port(v, (p) => patch((d) => (d.inbound.clashPort = p)))}
            />
          </Field>
        </div>

        <Switch
          label={t('settings.allowLan')}
          hint={t('settings.allowLanHint')}
          checked={settings.inbound.allowLan}
          onChange={(v) => patch((d) => (d.inbound.allowLan = v))}
        />
      </Card>

      <Card title={t('settings.dns')}>
        <div className="grid-2">
          <Field label={t('settings.dnsRemote')} hint={t('settings.dnsRemoteHint')}>
            <CommitInput
              value={settings.dns.remote}
              onCommit={(v) => patch((d) => (d.dns.remote = v.trim()))}
            />
          </Field>
          <Field label={t('settings.dnsDirect')}>
            <CommitInput
              value={settings.dns.direct}
              onCommit={(v) => patch((d) => (d.dns.direct = v.trim()))}
            />
          </Field>
        </div>

        <Switch
          label={t('settings.fakeip')}
          hint={t('settings.fakeipHint')}
          checked={settings.dns.enableFakeip}
          onChange={(v) => patch((d) => (d.dns.enableFakeip = v))}
        />
        <Switch
          label={t('settings.disableCache')}
          checked={settings.dns.disableCache}
          onChange={(v) => patch((d) => (d.dns.disableCache = v))}
        />
      </Card>

      <Card title={t('settings.tun')}>
        <Field label={t('settings.mtu')}>
          <CommitInput
            type="number"
            value={String(settings.tun.mtu)}
            onCommit={(v) => {
              const mtu = Number(v);
              if (mtu >= 576 && mtu <= 9000) patch((d) => (d.tun.mtu = mtu));
            }}
          />
        </Field>

        <Switch
          label={t('settings.strictRoute')}
          hint={t('settings.strictRouteHint')}
          checked={settings.tun.strictRoute}
          onChange={(v) => patch((d) => (d.tun.strictRoute = v))}
        />
        <Switch
          label={t('settings.autoRoute')}
          checked={settings.tun.autoRoute}
          onChange={(v) => patch((d) => (d.tun.autoRoute = v))}
        />
        <Switch
          label={t('settings.ipv6')}
          checked={settings.tun.ipv6}
          onChange={(v) => patch((d) => (d.tun.ipv6 = v))}
        />
      </Card>

      <Card title={t('settings.probe')}>
        <div className="grid-2">
          <Field label={t('settings.probeUrl')}>
            <CommitInput
              value={settings.probe.url}
              onCommit={(v) => patch((d) => (d.probe.url = v.trim()))}
            />
          </Field>
          <Field label={t('settings.probeTimeout')}>
            <CommitInput
              type="number"
              value={String(settings.probe.timeoutMs)}
              onCommit={(v) => {
                const ms = Number(v);
                if (ms >= 500 && ms <= 30000) patch((d) => (d.probe.timeoutMs = ms));
              }}
            />
          </Field>
        </div>

        <Field label={t('settings.probeInterval')} hint={t('settings.probeIntervalHint')}>
          <CommitInput
            type="number"
            value={String(settings.probe.intervalS)}
            onCommit={(v) => {
              const seconds = Number(v);
              if (seconds >= 30 && seconds <= 3600) patch((d) => (d.probe.intervalS = seconds));
            }}
          />
        </Field>
      </Card>

      <Card title={t('settings.service')}>
        <Field label={t('settings.apiBase')} hint={t('settings.apiBaseHint')}>
          <CommitInput
            value={apiBase}
            placeholder={t('settings.apiBaseDefault')}
            ariaLabel={t('settings.apiBase')}
            onCommit={async (value) => {
              try {
                // Show what was stored, not what was typed: a bare host gains
                // a scheme, and a rejected address must not appear accepted.
                setApiBase(await api.accountSetApiBase(value));
                toast('success', t('settings.apiBaseSaved'));
              } catch (error) {
                toastError(error);
                setApiBase((await api.accountInfo()).apiBase);
              }
            }}
          />
        </Field>
      </Card>

      <Card title={t('settings.core')}>
        <div className="grid-2">
          <Field label={t('settings.logLevel')}>
            <select
              className="select"
              value={settings.core.logLevel}
              onChange={(e) => patch((d) => (d.core.logLevel = e.target.value))}
            >
              {['trace', 'debug', 'info', 'warn', 'error'].map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Switch
          label={t('settings.mux')}
          hint={t('settings.muxHint')}
          checked={settings.core.multiplex.enabled}
          onChange={(v) => patch((d) => (d.core.multiplex.enabled = v))}
        />

        <Field label={t('settings.configOverride')} hint={t('settings.configOverrideHint')}>
          <textarea
            className="textarea"
            defaultValue={settings.core.configOverride ?? ''}
            placeholder='{"log": {"level": "debug"}}'
            onBlur={(e) =>
              patch((d) => (d.core.configOverride = e.target.value.trim() || null))
            }
          />
        </Field>

        <div className="row" style={{ marginTop: 4 }}>
          <button className="btn btn--sm" onClick={showConfig}>
            <FileJson size={13} />
            {t('settings.previewConfig')}
          </button>
          <button className="btn btn--sm" onClick={() => api.openDataFolder()}>
            <FolderOpen size={13} />
            {t('settings.openDataFolder')}
          </button>
        </div>

        <div className="row" style={{ marginTop: 12, gap: 16 }}>
          <span className="muted">
            {t('settings.appVersion')}: {appVersion}
          </span>
          <span className="muted">
            {t('settings.coreVersion')}: {coreVersion}
          </span>
        </div>
      </Card>

      {preview && (
        <Modal
          title={t('settings.previewConfig')}
          onClose={() => setPreview(null)}
          footer={
            <button className="btn" onClick={() => setPreview(null)}>
              {t('common.close')}
            </button>
          }
        >
          <pre className="log" style={{ height: '52vh', margin: 0 }}>
            {preview}
          </pre>
        </Modal>
      )}
    </div>
  );
}
