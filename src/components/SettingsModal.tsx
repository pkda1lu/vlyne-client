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
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
        }}>
            <div style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '32px',
                width: '850px', 
                height: '700px', 
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 40px 100px rgba(0, 0, 0, 0.6)',
                overflow: 'hidden',
                 position: 'relative'
            }}>
                {/* Background Glow */}
                <div style={{ 
                    position: 'absolute', 
                    top: '-50px', 
                    right: '-50px', 
                    width: '300px', 
                    height: '300px', 
                    background: 'radial-gradient(circle, var(--accent-glow) 0%, transparent 70%)',
                    zIndex: 0,
                    pointerEvents: 'none'
                }} />

                {/* Header */}
                <div style={{
                    padding: '32px 40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    position: 'relative',
                    zIndex: 1
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ padding: '12px', borderRadius: '14px', backgroundColor: 'rgba(255,255,255,0.03)', color: 'var(--accent-color)' }}>
                            <SettingsIcon size={24} />
                        </div>
                        <h2 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.5px' }}>{title || t.settings}</h2>
                    </div>
                    <button onClick={onClose} style={{ 
                        padding: '10px', 
                        color: 'var(--text-secondary)',
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        borderRadius: '12px',
                        border: '1px solid var(--border-color)',
                        transition: 'all 0.2s'
                    }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}>
                        <X size={24} />
                    </button>
                </div>

                {/* Tabs */}
                {tabs.length > 1 && (
                    <div style={{
                        display: 'flex',
                        gap: '8px',
                        padding: '0 40px 24px',
                        overflowX: 'auto',
                        position: 'relative',
                        zIndex: 1
                    }}>
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    padding: '10px 20px',
                                    backgroundColor: activeTab === tab.id ? 'var(--accent-color)' : 'rgba(255,255,255,0.03)',
                                    color: activeTab === tab.id ? '#000' : 'var(--text-secondary)',
                                    borderRadius: '12px',
                                    border: activeTab === tab.id ? 'none' : '1px solid var(--border-color)',
                                    fontWeight: 700,
                                    fontSize: '13px',
                                    transition: 'all 0.2s',
                                    whiteSpace: 'nowrap',
                                }}
                                onMouseEnter={(e) => {
                                    if (activeTab !== tab.id) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
                                }}
                                onMouseLeave={(e) => {
                                    if (activeTab !== tab.id) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                                }}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 40px 32px', position: 'relative', zIndex: 1 }}>
                    <div style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '32px',
                        backgroundColor: 'rgba(255,255,255,0.02)',
                        borderRadius: '24px',
                        padding: '32px',
                        border: '1px solid var(--border-color)'
                    }}>
                        {activeTab === 'general' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
                                            <span style={{ fontSize: '13px', fontWeight: 600, color: updateStatus.includes(t.errorPrefix) ? 'var(--danger-color)' : 'var(--text-secondary)' }}>
                                                {updateStatus}
                                            </span>
                                        )}
                                        <button
                                            onClick={checkForUpdates}
                                            disabled={isCheckingUpdate}
                                            style={{
                                                padding: '10px 18px',
                                                backgroundColor: 'rgba(255,255,255,0.05)',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: '10px',
                                                color: 'var(--text-primary)',
                                                cursor: isCheckingUpdate ? 'wait' : 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                fontSize: '13px',
                                                fontWeight: 700,
                                                transition: 'all 0.2s'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                                        >
                                            <RotateCw size={14} style={{ animation: isCheckingUpdate ? 'spin 1s linear infinite' : 'none' }} />
                                            {t.checkForUpdates}
                                        </button>
                                    </div>
                                </SettingRow>
                            </div>
                        )}

                        {activeTab === 'inbound' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                                <div>
                                    <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--accent-color)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '20px' }}>{t.multiplexing}</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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

                                <div>
                                    <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--accent-color)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '20px' }}>{t.fragment}</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                    <button
                                        onClick={() => navigator.clipboard.writeText(logs)}
                                        style={{
                                            padding: '8px 16px',
                                            backgroundColor: 'rgba(255,255,255,0.05)',
                                            border: '1px solid var(--border-color)',
                                            borderRadius: '10px',
                                            color: 'var(--text-primary)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            fontSize: '13px',
                                            fontWeight: 700,
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                                    >
                                        <Copy size={14} />
                                        {t.copyLogs}
                                    </button>
                                    <button
                                        onClick={() => setLogs('')}
                                        style={{
                                            padding: '8px 16px',
                                            backgroundColor: 'rgba(255, 77, 77, 0.1)',
                                            border: 'none',
                                            borderRadius: '10px',
                                            color: 'var(--danger-color)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            fontSize: '13px',
                                            fontWeight: 700,
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 77, 77, 0.15)'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 77, 77, 0.1)'}
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
                                        backgroundColor: '#0c0e12',
                                        color: '#d4d4d4',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '16px',
                                        padding: '16px',
                                        fontFamily: 'monospace',
                                        fontSize: '12px',
                                        resize: 'none',
                                        whiteSpace: 'pre-wrap',
                                        minHeight: '300px',
                                        outline: 'none'
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '24px 40px',
                    backgroundColor: 'rgba(255,255,255,0.02)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    position: 'relative',
                    zIndex: 1
                }}>
                    <a
                        href="https://t.me/VlyneVpn_bot"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            textDecoration: 'none',
                            color: 'var(--text-secondary)',
                            fontSize: '12px',
                            fontWeight: 600,
                            opacity: 0.6,
                            transition: 'opacity 0.2s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
                    >
                        {t.prodBy}
                    </a>

                    <div style={{ display: 'flex', gap: '16px' }}>
                        <button
                            onClick={() => {
                                if (confirm(t.resetSettingsConfirm)) {
                                    resetSettings();
                                }
                            }}
                            style={{
                                padding: '12px 24px',
                                backgroundColor: 'transparent',
                                border: '1px solid var(--border-color)',
                                borderRadius: '12px',
                                color: 'var(--text-secondary)',
                                fontWeight: 700,
                                fontSize: '13px',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            {t.resetToDefault}
                        </button>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '12px 32px',
                                backgroundColor: 'var(--accent-color)',
                                border: 'none',
                                borderRadius: '12px',
                                color: '#000',
                                fontWeight: 800,
                                fontSize: '13px',
                                transition: 'all 0.2s',
                                boxShadow: '0 4px 15px var(--accent-glow)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-1px)';
                                e.currentTarget.style.boxShadow = '0 6px 20px var(--accent-glow)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 4px 15px var(--accent-glow)';
                            }}
                        >
                            {t.done}
                        </button>
                    </div>
                </div>
            </div>
            <style>{`
                .settings-input {
                    padding: 10px 14px;
                    background-color: #1a1f26;
                    border: 1px solid var(--border-color);
                    border-radius: 10px;
                    color: var(--text-primary);
                    font-weight: 600;
                    outline: none;
                    transition: border-color 0.2s;
                }
                .settings-input:focus {
                    border-color: var(--accent-color);
                }
                .settings-select {
                    padding: 10px 14px;
                    background-color: #1a1f26;
                    border: 1px solid var(--border-color);
                    border-radius: 10px;
                    color: var(--text-primary);
                    min-width: 140px;
                    font-weight: 600;
                    outline: none;
                    cursor: pointer;
                }
                .settings-select:focus {
                    border-color: var(--accent-color);
                }
            `}</style>
        </div>
    );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
            <div style={{ flex: 1, paddingRight: '20px' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '4px', color: 'var(--text-primary)' }}>{label}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500, lineHeight: '1.4' }}>{description}</div>
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
                height: '26px',
                backgroundColor: checked ? 'var(--accent-color)' : '#1a1f26',
                borderRadius: '13px',
                position: 'relative',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                border: checked ? 'none' : '1px solid var(--border-color)',
                cursor: 'pointer',
                outline: 'none'
            }}
        >
            <div style={{
                width: '20px',
                height: '20px',
                backgroundColor: checked ? '#000' : '#4a4d55',
                borderRadius: '50%',
                position: 'absolute',
                top: '2px',
                left: checked ? '25px' : '3px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }} />
        </button>
    );
}
