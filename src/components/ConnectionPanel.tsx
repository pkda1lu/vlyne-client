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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)', padding: '40px', position: 'relative', overflow: 'hidden' }}>
            {/* Background Decor */}
            <div style={{ 
                position: 'absolute', 
                top: '-100px', 
                right: '-200px', 
                width: '600px', 
                height: '600px', 
                background: 'radial-gradient(circle, var(--accent-glow) 0%, transparent 70%)',
                zIndex: 0
            }} />

            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                            <div style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                backgroundColor: isConnected ? 'var(--accent-color)' : isConnecting ? '#ffb300' : 'var(--text-secondary)',
                                boxShadow: isConnected ? `0 0 10px var(--accent-color)` : 'none'
                            }} />
                            <span style={{ fontSize: 13, fontWeight: 700, color: isConnected ? 'var(--accent-color)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {isConnecting ? t.connecting : (isConnected ? t.connected : t.notConnected)}
                            </span>
                        </div>
                        <h1 style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-0.5px' }}>{server.name}</h1>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{server.address}</div>
                    </div>
                    <button
                        onClick={() => setShowInfo(true)}
                        style={{
                            padding: '12px',
                            borderRadius: '14px',
                            backgroundColor: 'rgba(255,255,255,0.03)',
                            color: 'var(--text-secondary)',
                            border: `1px solid var(--border-color)`,
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                        title={t.serverInfo || 'Server Info'}
                    >
                        <Info size={20} />
                    </button>
                </div>

                <ServerInfoModal isOpen={showInfo} onClose={() => setShowInfo(false)} server={server} />

                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '60px'
                }}>
                    {/* Power Button */}
                    <div style={{ position: 'relative' }}>
                        <button
                            style={{
                                width: '220px',
                                height: '220px',
                                borderRadius: '50%',
                                background: isConnected
                                    ? 'linear-gradient(135deg, var(--accent-color) 0%, #00d1ff 100%)'
                                    : 'linear-gradient(135deg, #1a1f26 0%, #0d0f14 100%)',
                                border: `2px solid ${isConnected ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.05)'}`,
                                color: isConnected ? '#000' : 'var(--text-secondary)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '14px',
                                transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                                boxShadow: isConnected ? `0 0 60px var(--accent-glow)` : 'none',
                                cursor: isConnecting ? 'wait' : 'pointer',
                                zIndex: 2,
                                position: 'relative'
                            }}
                            disabled={isConnecting}
                            onClick={handleToggleVpn}
                        >
                            <Power size={70} strokeWidth={1.5} />
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '15px', fontWeight: 800 }}>
                                    {isConnecting ? t.connecting : (isConnected ? t.disconnect : t.connect)}
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.8 }}>
                                    {isConnected ? elapsed : '00:00:00'}
                                </div>
                            </div>
                        </button>
                        {isConnected && (
                            <div style={{
                                position: 'absolute',
                                top: '-20px',
                                left: '-20px',
                                right: '-20px',
                                bottom: '-20px',
                                borderRadius: '50%',
                                border: '2px solid var(--accent-color)',
                                opacity: 0.2,
                                animation: 'spin 10s linear infinite'
                            }} />
                        )}
                    </div>

                    {/* Metrics Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 200px)', gap: '20px' }}>
                        <InfoCard icon={<Globe size={16} color="var(--accent-color)" />} label={t.protocol} value={server.protocol.toUpperCase()} />
                        <InfoCard
                            icon={<Activity size={16} color="var(--accent-color)" />}
                            label={t.ping}
                            value={ping !== null ? `${ping} ms` : '...'}
                            action={<RefreshCw size={14} style={{ cursor: 'pointer', opacity: 0.5 }} onClick={measurePing} />}
                        />
                         <InfoCard
                            icon={<Gauge size={16} color="#00d1ff" />}
                            label={t.load}
                            value={server.load ?? '—'}
                            action={<RefreshCw size={14} style={{ cursor: isConnected ? 'pointer' : 'not-allowed', opacity: isConnected ? 0.5 : 0.2, animation: isSpeedTesting ? 'spin 1s linear infinite' : 'none' }} onClick={checkSpeed} />}
                        />
                        <InfoCard icon={<Lock size={16} color="var(--accent-color)" />} label={t.encryption} value="AES-256-GCM" />
                        <InfoCard icon={<Shield size={16} color="var(--accent-color)" />} label={t.security} value={t.active} />
                        <InfoCard icon={<Globe size={16} color="var(--accent-color)" />} label="IP Address" value={server.address} />
                    </div>
                </div>

                <footer style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center' }}>
                    <div className="glass-card" style={{ padding: '12px 24px', borderRadius: '40px', display: 'flex', gap: '32px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            <Shield size={14} color="var(--accent-color)" />
                            UDP Enabled
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            <Lock size={14} color="var(--accent-color)" />
                            IPv6 Protection
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    );
}

function InfoCard({ icon, label, value, action }: { icon: React.ReactNode; label: string; value: string | number; action?: React.ReactNode }) {
    return (
        <div style={{
            backgroundColor: 'rgba(255,255,255,0.02)',
            border: `1px solid var(--border-color)`,
            borderRadius: '18px',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            position: 'relative',
            transition: 'all 0.2s'
        }} className="rd-hover-effect">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {icon}
                    <span>{label}</span>
                </div>
                {action}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
        </div>
    );
}
