import { type Server } from '../App';
import { Power, Shield, Globe, Activity, Info, Lock, Gauge, RefreshCw } from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../contexts/I18nContext';
import { useSettings } from '../contexts/SettingsContext';
import { ServerInfoModal } from './ServerInfoModal';

interface ConnectionPanelProps {
    server: Server | null;
    onStatusChange: (status: Server['status']) => void;
    onUpdateServer: (id: string, updates: Partial<Server>) => void;
}

export function ConnectionPanel({ server, onStatusChange, onUpdateServer }: ConnectionPanelProps) {
    const { t } = useTranslation();
    const { settings } = useSettings();
    const [ping, setPing] = useState<number | null>(null);
    const [showInfo, setShowInfo] = useState(false);
    const [isSpeedTesting, setIsSpeedTesting] = useState(false);
    const hasAutoConnected = useRef(false);
    const [connectedAt, setConnectedAt] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState<string>('00:00:00');

    const isConnected = server?.status === 'connected';
    const isConnecting = server?.status === 'connecting';

    const handleToggleVpn = async () => {
        if (!server) return;

        if (isConnected) {
            const res = await window.electronAPI.stopVpn();
            if (res.success) onStatusChange('disconnected');
            setConnectedAt(null);
        } else {
            onStatusChange('connecting');
            // Pass both server config and app settings
            const res = await window.electronAPI.startVpn({
                server,
                settings: settings
            });
            if (res.success) {
                onStatusChange('connected');
                setConnectedAt(Date.now());
            } else {
                onStatusChange('disconnected');
                console.error(res.error);
                alert(`${t.failedToConnect}: ${res.error}`);
            }
        }
    };

    const checkSpeed = async () => {
        if (!server || !isConnected) return;

        setIsSpeedTesting(true);
        // Clear old value
        onUpdateServer(server.id, { load: '...' });

        try {
            const startTime = Date.now();
            // Download a small file (5MB approx) to test speed
            const response = await fetch('https://speed.cloudflare.com/__down?bytes=5000000', { cache: 'no-store' });
            await response.blob();
            const endTime = Date.now();

            const durationInSeconds = (endTime - startTime) / 1000;
            const bitsLoaded = 5000000 * 8;
            const bps = bitsLoaded / durationInSeconds;
            const mbps = (bps / (1024 * 1024)).toFixed(1);

            onUpdateServer(server.id, { load: `${mbps} Mbps` });
        } catch (error) {
            console.error('Speed test failed:', error);
            onUpdateServer(server.id, { load: 'Error' });
        } finally {
            setIsSpeedTesting(false);
        }
    };

    const measurePing = async () => {
        if (!server?.port) return;
        setPing(null); // Show loading state
        const result = await window.electronAPI.pingServer(server.address, parseInt(server.port));
        setPing(result);
    };

    useEffect(() => {
        if (!server) {
            setPing(null);
            return;
        }

        measurePing();

        // Update ping every 10 seconds
        const interval = setInterval(measurePing, 10000);

        return () => clearInterval(interval);
    }, [server]);

    useEffect(() => {
        if (!server || !settings.general.autoConnect || hasAutoConnected.current || isConnected || isConnecting) {
            return;
        }
        hasAutoConnected.current = true;
        handleToggleVpn();
    }, [server, settings.general.autoConnect]);

    useEffect(() => {
        if (!connectedAt) {
            setElapsed('00:00:00');
            return;
        }
        const update = () => {
            const diff = Date.now() - connectedAt;
            const hrs = Math.floor(diff / 3600000).toString().padStart(2, '0');
            const mins = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
            const secs = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
            setElapsed(`${hrs}:${mins}:${secs}`);
        };
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [connectedAt]);

    if (!server) {
        return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', gap: '16px' }}>
                <Shield size={64} style={{ opacity: 0.3 }} />
                <div style={{ fontSize: '16px' }}>{t.notConnected}</div>
                <div style={{ fontSize: '14px', opacity: 0.7 }}>{t.selectServer}</div>
            </div>
        );
    }

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            backgroundColor: isConnected ? 'var(--success-color)' : isConnecting ? '#ffb300' : 'var(--text-secondary)'
                        }} />
                        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                            {isConnecting ? t.connecting : (isConnected ? t.connected : t.notConnected)}
                        </span>
                    </div>
                    <h1 style={{ fontSize: '26px', fontWeight: 700, marginTop: 6 }}>{server.name}</h1>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{server.address}</div>
                </div>
                <button
                    onClick={() => setShowInfo(true)}
                    style={{
                        padding: '10px',
                        borderRadius: '12px',
                        backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-secondary)',
                        border: `1px solid var(--border-color)`,
                        cursor: 'pointer'
                    }}
                    title={t.serverInfo || 'Server Info'}
                >
                    <Info size={20} />
                </button>
            </div>

            <ServerInfoModal isOpen={showInfo} onClose={() => setShowInfo(false)} server={server} />

            <div style={{
                flex: 1,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '24px',
                alignItems: 'center'
            }}>
                <div style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: `1px solid var(--border-color)`,
                    borderRadius: '18px',
                    padding: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.35)'
                }}>
                    <button
                        style={{
                            width: '210px',
                            height: '210px',
                            borderRadius: '32px',
                            background: isConnected
                                ? 'linear-gradient(145deg, #00c36a 0%, #00a85c 100%)'
                                : 'linear-gradient(145deg, #1c2026 0%, #15191f 100%)',
                            border: `1px solid ${isConnected ? 'rgba(0,195,106,0.6)' : 'var(--border-color)'}`,
                            color: '#fff',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '14px',
                            transition: 'all 0.25s ease',
                            boxShadow: isConnected ? '0 0 60px rgba(0,195,106,0.45)' : 'none',
                            cursor: isConnecting ? 'wait' : 'pointer'
                        }}
                        disabled={isConnecting}
                        onClick={handleToggleVpn}
                    >
                        <Power size={62} />
                        <span style={{ fontSize: '16px', fontWeight: 700 }}>
                            {isConnecting ? t.connecting : (isConnected ? t.disconnect : t.connect)}
                        </span>
                        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
                            {isConnected ? elapsed : '00:00:00'}
                        </span>
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '16px' }}>
                    <InfoCard icon={<Globe size={18} />} label={t.protocol} value={server.protocol.toUpperCase()} />
                    <InfoCard
                        icon={<Activity size={18} />}
                        label={t.ping}
                        value={ping !== null ? `${ping} ms` : '...'}
                        action={<RefreshCw size={14} style={{ cursor: 'pointer' }} onClick={measurePing} />}
                    />
                    <InfoCard icon={<Lock size={18} />} label={t.encryption} value="AES-256" />
                    <InfoCard
                        icon={<Gauge size={18} />}
                        label={t.load}
                        value={server.load ?? '—'}
                        action={<RefreshCw size={14} style={{ cursor: isConnected ? 'pointer' : 'not-allowed', opacity: isConnected ? 1 : 0.5, animation: isSpeedTesting ? 'spin 1s linear infinite' : 'none' }} onClick={checkSpeed} />}
                    />
                    <InfoCard icon={<Shield size={18} />} label={t.security} value={t.active} />
                    <InfoCard icon={<Info size={18} />} label={t.address} value={server.address} />
                </div>
            </div>
        </div>
    );
}

function InfoCard({ icon, label, value, action }: { icon: React.ReactNode; label: string; value: string | number; action?: React.ReactNode }) {
    return (
        <div style={{
            backgroundColor: 'var(--bg-secondary)',
            border: `1px solid var(--border-color)`,
            borderRadius: '14px',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            position: 'relative'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {icon}
                    <span>{label}</span>
                </div>
                {action}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
        </div>
    );
}
