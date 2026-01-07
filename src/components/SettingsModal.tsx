import { useState, useEffect } from 'react';
import { X, Settings as SettingsIcon, Copy, Trash2, RotateCw } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useTranslation } from '../contexts/I18nContext';

export type SettingsTab = 'general' | 'inbound' | 'routing' | 'dns' | 'core' | 'advanced' | 'logs';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: SettingsTab;
    allowedTabs?: SettingsTab[];
    title?: string;
}

export function SettingsModal({ isOpen, onClose, initialTab, allowedTabs, title }: SettingsModalProps) {
    const { settings, updateSettings, resetSettings } = useSettings();
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [logs, setLogs] = useState<string>('');
    const [appVersion, setAppVersion] = useState<string>('');
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [updateStatus, setUpdateStatus] = useState<string | null>(null);

    useEffect(() => {
        if (window.electronAPI?.getVersion) {
            window.electronAPI.getVersion().then(setAppVersion);
        }
    }, []);

    const checkForUpdates = async () => {
        if (isCheckingUpdate) return;
        setIsCheckingUpdate(true);
        setUpdateStatus(null);
        try {
            const result = await window.electronAPI.checkForUpdates();
            if (result.status === 'no-update') {
                setUpdateStatus(t.latestVersionInstalled);
            } else if (result.status === 'checked' && result.updateInfo) {
                setUpdateStatus(t.versionAvailable.replace('{{version}}', result.updateInfo.version));
            } else if (result.status === 'error') {
                setUpdateStatus(`${t.errorPrefix}${result.error}`);
            }
        } catch (error: any) {
            setUpdateStatus(`${t.errorPrefix}${error.message || 'Unknown error'}`);
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    // Listen to real logs
    useEffect(() => {
        if (!window.electronAPI?.onLog) return;
        const unsubscribe = window.electronAPI.onLog((log) => {
            setLogs((prev) => {
                const newLogs = prev + log + '\n';
                return newLogs.length > 50000 ? newLogs.slice(-50000) : newLogs;
            });
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (isOpen) {
            const nextTab = initialTab || allowedTabs?.[0] || 'general';
            setActiveTab(nextTab);
        }
    }, [isOpen, initialTab, allowedTabs]);

    if (!isOpen) return null;

    const allTabs: { id: SettingsTab; label: string }[] = [
        { id: 'general', label: t.general },
        { id: 'inbound', label: t.inbound },
        { id: 'routing', label: t.routing },
        { id: 'dns', label: t.dns },
        { id: 'core', label: t.core },
        { id: 'advanced', label: t.advanced },
        { id: 'logs', label: t.logs },
    ];

    const tabs = allowedTabs ? allTabs.filter(tab => allowedTabs.includes(tab.id)) : allTabs;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
        }}>
            <div style={{
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: '12px',
                width: '700px', // Fixed width
                height: '550px', // Fixed height
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                overflow: 'hidden', // Ensure no spillover
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <SettingsIcon size={24} />
                        <h2 style={{ fontSize: '20px', fontWeight: 600 }}>{title || t.settings}</h2>
                    </div>
                    <button onClick={onClose} style={{ padding: '4px', color: 'var(--text-secondary)' }}>
                        <X size={24} />
                    </button>
                </div>

                {/* Tabs */}
                {tabs.length > 1 && (
                    <div style={{
                        display: 'flex',
                        gap: '4px',
                        padding: '16px 24px 0',
                        borderBottom: '1px solid var(--border-color)',
                        overflowX: 'auto',
                    }}>
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: activeTab === tab.id ? 'var(--accent-color)' : 'transparent',
                                    color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
                                    borderRadius: '8px 8px 0 0',
                                    fontWeight: 500,
                                    fontSize: '14px',
                                    transition: 'all 0.2s',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
                    {activeTab === 'general' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <SettingRow
                                label={t.autoConnect}
                                description={t.autoConnectDesc}
                            >
                                <Toggle
                                    checked={settings.general.autoConnect}
                                    onChange={(checked) => updateSettings({ general: { ...settings.general, autoConnect: checked } })}
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.autoEnableProxy}
                                description={t.autoEnableProxyDesc}
                            >
                                <Toggle
                                    checked={settings.general.autoEnableProxy}
                                    onChange={(checked) => updateSettings({ general: { ...settings.general, autoEnableProxy: checked } })}
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.minimizeToTray}
                                description={t.minimizeToTrayDesc}
                            >
                                <Toggle
                                    checked={settings.general.minimizeToTray}
                                    onChange={(checked) => updateSettings({ general: { ...settings.general, minimizeToTray: checked } })}
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.language}
                                description={t.languageDesc}
                            >
                                <select
                                    value={settings.general.language}
                                    onChange={(e) => updateSettings({ general: { ...settings.general, language: e.target.value as 'en' | 'ru' } })}
                                    className="settings-select"
                                >
                                    <option value="en">English</option>
                                    <option value="ru">Русский</option>
                                </select>
                            </SettingRow>

                            <div style={{ borderTop: '1px solid var(--border-color)', margin: '10px 0' }}></div>

                            <SettingRow
                                label={t.applicationVersion}
                                description={`${t.currentVersion}: ${appVersion}`}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {updateStatus && (
                                        <span style={{ fontSize: '13px', color: updateStatus.includes(t.errorPrefix) ? '#ff3b30' : 'var(--text-secondary)' }}>
                                            {updateStatus}
                                        </span>
                                    )}
                                    <button
                                        onClick={checkForUpdates}
                                        disabled={isCheckingUpdate}
                                        style={{
                                            padding: '8px 16px',
                                            backgroundColor: 'var(--bg-primary)',
                                            border: '1px solid var(--border-color)',
                                            borderRadius: '8px',
                                            color: 'var(--text-primary)',
                                            cursor: isCheckingUpdate ? 'wait' : 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            fontSize: '13px',
                                            fontWeight: 500
                                        }}
                                    >
                                        <RotateCw size={14} style={{ animation: isCheckingUpdate ? 'spin 1s linear infinite' : 'none' }} />
                                        {t.checkForUpdates}
                                    </button>
                                </div>
                            </SettingRow>
                        </div>
                    )}

                    {activeTab === 'inbound' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <SettingRow
                                label={t.socksPort}
                                description={t.socksPortDesc}
                            >
                                <input
                                    type="number"
                                    value={settings.inbound.socksPort}
                                    onChange={(e) => updateSettings({ inbound: { ...settings.inbound, socksPort: parseInt(e.target.value) } })}
                                    className="settings-input"
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.httpPort}
                                description={t.httpPortDesc}
                            >
                                <input
                                    type="number"
                                    value={settings.inbound.httpPort}
                                    onChange={(e) => updateSettings({ inbound: { ...settings.inbound, httpPort: parseInt(e.target.value) } })}
                                    className="settings-input"
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.allowLan}
                                description={t.allowLanDesc}
                            >
                                <Toggle
                                    checked={settings.inbound.allowLan}
                                    onChange={(checked) => updateSettings({ inbound: { ...settings.inbound, allowLan: checked } })}
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.udpSupport}
                                description={t.udpSupportDesc}
                            >
                                <Toggle
                                    checked={settings.inbound.udpSupport}
                                    onChange={(checked) => updateSettings({ inbound: { ...settings.inbound, udpSupport: checked } })}
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.trafficSniffing}
                                description={t.trafficSniffingDesc}
                            >
                                <Toggle
                                    checked={settings.inbound.sniffing}
                                    onChange={(checked) => updateSettings({ inbound: { ...settings.inbound, sniffing: checked } })}
                                />
                            </SettingRow>
                        </div>
                    )}

                    {activeTab === 'routing' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <SettingRow
                                label={t.routingMode}
                                description={t.routingModeDesc}
                            >
                                <select
                                    value={settings.routing.mode}
                                    onChange={(e) => updateSettings({ routing: { ...settings.routing, mode: e.target.value as any } })}
                                    className="settings-select"
                                >
                                    <option value="global">{t.global}</option>
                                    <option value="bypass-lan">{t.bypassLan}</option>
                                    <option value="bypass-china">{t.bypassChina}</option>
                                    <option value="custom">{t.custom}</option>
                                </select>
                            </SettingRow>

                            <SettingRow
                                label={t.domainStrategy}
                                description={t.domainStrategyDesc}
                            >
                                <select
                                    value={settings.routing.domainStrategy}
                                    onChange={(e) => updateSettings({ routing: { ...settings.routing, domainStrategy: e.target.value as any } })}
                                    className="settings-select"
                                >
                                    <option value="AsIs">{t.asIs}</option>
                                    <option value="IPIfNonMatch">{t.ipIfNonMatch}</option>
                                    <option value="IPOnDemand">{t.ipOnDemand}</option>
                                </select>
                            </SettingRow>
                        </div>
                    )}

                    {activeTab === 'dns' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <SettingRow
                                label={t.primaryDns}
                                description={t.primaryDnsDesc}
                            >
                                <input
                                    type="text"
                                    value={settings.dns.primaryDns}
                                    onChange={(e) => updateSettings({ dns: { ...settings.dns, primaryDns: e.target.value } })}
                                    className="settings-input"
                                    style={{ width: '200px' }}
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.fallbackDns}
                                description={t.fallbackDnsDesc}
                            >
                                <input
                                    type="text"
                                    value={settings.dns.fallbackDns}
                                    onChange={(e) => updateSettings({ dns: { ...settings.dns, fallbackDns: e.target.value } })}
                                    className="settings-input"
                                    style={{ width: '200px' }}
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.dnsStrategy}
                                description={t.dnsStrategyDesc}
                            >
                                <select
                                    value={settings.dns.strategy}
                                    onChange={(e) => updateSettings({ dns: { ...settings.dns, strategy: e.target.value as any } })}
                                    className="settings-select"
                                >
                                    <option value="UseIP">{t.useIp}</option>
                                    <option value="UseIPv4">{t.useIpv4}</option>
                                    <option value="UseIPv6">{t.useIpv6}</option>
                                </select>
                            </SettingRow>
                        </div>
                    )}

                    {activeTab === 'core' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <SettingRow
                                label={t.logLevel}
                                description={t.logLevelDesc}
                            >
                                <select
                                    value={settings.core.logLevel}
                                    onChange={(e) => updateSettings({ core: { ...settings.core, logLevel: e.target.value as any } })}
                                    className="settings-select"
                                >
                                    <option value="none">{t.levelNone}</option>
                                    <option value="error">{t.levelError}</option>
                                    <option value="warning">{t.levelWarning}</option>
                                    <option value="info">{t.levelInfo}</option>
                                    <option value="debug">{t.levelDebug}</option>
                                </select>
                            </SettingRow>

                            <SettingRow
                                label={t.accessLog}
                                description={t.accessLogDesc}
                            >
                                <Toggle
                                    checked={settings.core.accessLog}
                                    onChange={(checked) => updateSettings({ core: { ...settings.core, accessLog: checked } })}
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.errorLog}
                                description={t.errorLogDesc}
                            >
                                <Toggle
                                    checked={settings.core.errorLog}
                                    onChange={(checked) => updateSettings({ core: { ...settings.core, errorLog: checked } })}
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.enableStats}
                                description={t.enableStatsDesc}
                            >
                                <Toggle
                                    checked={settings.core.enableStats}
                                    onChange={(checked) => updateSettings({ core: { ...settings.core, enableStats: checked } })}
                                />
                            </SettingRow>
                        </div>
                    )}

                    {activeTab === 'advanced' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div style={{ marginBottom: '12px' }}>
                                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>{t.multiplexing}</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <SettingRow
                                        label={t.enableMux}
                                        description={t.enableMuxDesc}
                                    >
                                        <Toggle
                                            checked={settings.advanced.mux.enabled}
                                            onChange={(checked) => updateSettings({ advanced: { ...settings.advanced, mux: { ...settings.advanced.mux, enabled: checked } } })}
                                        />
                                    </SettingRow>

                                    {settings.advanced.mux.enabled && (
                                        <SettingRow
                                            label={t.concurrency}
                                            description={t.concurrencyDesc}
                                        >
                                            <input
                                                type="number"
                                                value={settings.advanced.mux.concurrency}
                                                onChange={(e) => updateSettings({ advanced: { ...settings.advanced, mux: { ...settings.advanced.mux, concurrency: parseInt(e.target.value) } } })}
                                                className="settings-input"
                                            />
                                        </SettingRow>
                                    )}
                                </div>
                            </div>

                            <div style={{ marginBottom: '12px' }}>
                                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>{t.fragment}</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <SettingRow
                                        label={t.enableFragment}
                                        description={t.enableFragmentDesc}
                                    >
                                        <Toggle
                                            checked={settings.advanced.fragment.enabled}
                                            onChange={(checked) => updateSettings({ advanced: { ...settings.advanced, fragment: { ...settings.advanced.fragment, enabled: checked } } })}
                                        />
                                    </SettingRow>

                                    {settings.advanced.fragment.enabled && (
                                        <>
                                            <SettingRow
                                                label={t.packets}
                                                description={t.packetsDesc}
                                            >
                                                <input
                                                    type="text"
                                                    value={settings.advanced.fragment.packets}
                                                    onChange={(e) => updateSettings({ advanced: { ...settings.advanced, fragment: { ...settings.advanced.fragment, packets: e.target.value } } })}
                                                    className="settings-input"
                                                    style={{ width: '150px' }}
                                                />
                                            </SettingRow>

                                            <SettingRow
                                                label={t.length}
                                                description={t.lengthDesc}
                                            >
                                                <input
                                                    type="text"
                                                    value={settings.advanced.fragment.length}
                                                    onChange={(e) => updateSettings({ advanced: { ...settings.advanced, fragment: { ...settings.advanced.fragment, length: e.target.value } } })}
                                                    className="settings-input"
                                                    style={{ width: '150px' }}
                                                />
                                            </SettingRow>

                                            <SettingRow
                                                label={t.interval}
                                                description={t.intervalDesc}
                                            >
                                                <input
                                                    type="text"
                                                    value={settings.advanced.fragment.interval}
                                                    onChange={(e) => updateSettings({ advanced: { ...settings.advanced, fragment: { ...settings.advanced.fragment, interval: e.target.value } } })}
                                                    className="settings-input"
                                                    style={{ width: '150px' }}
                                                />
                                            </SettingRow>
                                        </>
                                    )}
                                </div>
                            </div>

                            <SettingRow
                                label={t.maxConnections}
                                description={t.maxConnectionsDesc}
                            >
                                <input
                                    type="number"
                                    value={settings.advanced.maxConnections}
                                    onChange={(e) => updateSettings({ advanced: { ...settings.advanced, maxConnections: parseInt(e.target.value) } })}
                                    className="settings-input"
                                />
                            </SettingRow>

                            <SettingRow
                                label={t.connectionTimeout}
                                description={t.connectionTimeoutDesc}
                            >
                                <input
                                    type="number"
                                    value={settings.advanced.connectionTimeout}
                                    onChange={(e) => updateSettings({ advanced: { ...settings.advanced, connectionTimeout: parseInt(e.target.value) } })}
                                    className="settings-input"
                                />
                            </SettingRow>
                        </div>
                    )}

                    {activeTab === 'logs' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button
                                    onClick={() => navigator.clipboard.writeText(logs)}
                                    style={{
                                        padding: '6px 12px',
                                        backgroundColor: 'var(--bg-primary)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '6px',
                                        color: 'var(--text-secondary)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        fontSize: '13px',
                                    }}
                                >
                                    <Copy size={14} />
                                    {t.copyLogs}
                                </button>
                                <button
                                    onClick={() => setLogs('')}
                                    style={{
                                        padding: '6px 12px',
                                        backgroundColor: 'rgba(255, 59, 48, 0.1)',
                                        border: 'none',
                                        borderRadius: '6px',
                                        color: '#ff3b30',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        fontSize: '13px',
                                    }}
                                >
                                    <Trash2 size={14} />
                                    {t.clearLogs}
                                </button>
                            </div>
                            <textarea
                                value={logs || t.noLogs}
                                readOnly
                                style={{
                                    flex: 1,
                                    width: '100%',
                                    backgroundColor: '#1e1e1e',
                                    color: '#d4d4d4',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '8px',
                                    padding: '12px',
                                    fontFamily: 'monospace',
                                    fontSize: '12px',
                                    resize: 'none',
                                    whiteSpace: 'pre-wrap',
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <a
                        href="https://t.me/VlyneVpn_bot"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            textDecoration: 'none',
                            color: 'var(--text-secondary)',
                            fontSize: '12px',
                            opacity: 0.7,
                            transition: 'opacity 0.2s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                    >
                        {t.prodBy}
                    </a>

                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            onClick={() => {
                                if (confirm(t.resetSettingsConfirm)) {
                                    resetSettings();
                                }
                            }}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: 'var(--bg-primary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '8px',
                                color: 'var(--text-secondary)',
                                fontWeight: 500,
                            }}
                        >
                            {t.resetToDefault}
                        </button>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: 'var(--accent-color)',
                                border: 'none',
                                borderRadius: '8px',
                                color: '#fff',
                                fontWeight: 500,
                            }}
                        >
                            {t.done}
                        </button>
                    </div>
                </div>
            </div>
            <style>{`
                .settings-input {
                    width: 100px;
                    padding: 8px 12px;
                    background-color: var(--bg-primary);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    color: var(--text-primary);
                }
                .settings-select {
                    padding: 8px 12px;
                    background-color: var(--bg-primary);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    color: var(--text-primary);
                    min-width: 120px;
                }
            `}</style>
        </div>
    );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '4px' }}>{label}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{description}</div>
            </div>
            <div>{children}</div>
        </div>
    );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <button
            onClick={() => onChange(!checked)}
            style={{
                width: '48px',
                height: '28px',
                backgroundColor: checked ? 'var(--accent-color)' : '#555',
                borderRadius: '14px',
                position: 'relative',
                transition: 'background-color 0.2s',
                border: 'none',
                cursor: 'pointer',
            }}
        >
            <div style={{
                width: '22px',
                height: '22px',
                backgroundColor: '#fff',
                borderRadius: '50%',
                position: 'absolute',
                top: '3px',
                left: checked ? '23px' : '3px',
                transition: 'left 0.2s',
            }} />
        </button>
    );
}
