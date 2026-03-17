import { X, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { type Server } from '../App';
import { useTranslation } from '../contexts/I18nContext';

interface ServerInfoModalProps {
    isOpen: boolean;
    onClose: () => void;
    server: Server;
}

export function ServerInfoModal({ isOpen, onClose, server }: ServerInfoModalProps) {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    const copyLink = async () => {
        if (server.originalLink) {
            await navigator.clipboard.writeText(server.originalLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const InfoRow = ({ label, value }: { label: string, value: string | undefined }) => {
        if (!value) return null;
        return (
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '12px 0' }}>
                <span style={{ width: '120px', color: 'var(--text-secondary)', fontSize: '14px' }}>{label}</span>
                <span style={{ flex: 1, color: 'var(--text-primary)', fontSize: '14px', wordBreak: 'break-all' }}>{value}</span>
            </div>
        );
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(20px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
        }} onClick={onClose}>
            <div style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '32px',
                width: '90%',
                maxWidth: '650px',
                maxHeight: '85vh',
                overflowY: 'auto',
                padding: '40px',
                boxShadow: '0 40px 100px rgba(0, 0, 0, 0.6)',
                position: 'relative',
                overflow: 'hidden'
            }} onClick={e => e.stopPropagation()}>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ padding: '12px', borderRadius: '14px', backgroundColor: 'rgba(255,255,255,0.03)', color: 'var(--accent-color)' }}>
                            <Check size={24} />
                        </div>
                        <h2 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-0.5px' }}>{t.serverInfo || 'Server Info'}</h2>
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

                {/* Content */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', position: 'relative', zIndex: 1 }}>

                    {/* Link Section */}
                    <div>
                        <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '12px' }}>
                            {t.configurationLink || 'Configuration Link'}
                        </label>
                        <div style={{ 
                            position: 'relative',
                            backgroundColor: 'rgba(255,255,255,0.02)',
                            borderRadius: '16px',
                            border: '1px solid var(--border-color)',
                            overflow: 'hidden'
                        }}>
                            <textarea
                                readOnly
                                value={server.originalLink || ''}
                                style={{
                                    width: '100%',
                                    height: '100px',
                                    padding: '16px',
                                    paddingRight: '60px',
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    color: 'var(--text-primary)',
                                    fontSize: '13px',
                                    resize: 'none',
                                    fontFamily: 'monospace',
                                    lineHeight: '1.6',
                                    outline: 'none'
                                }}
                            />
                            <button
                                onClick={copyLink}
                                style={{
                                    position: 'absolute',
                                    top: '12px',
                                    right: '12px',
                                    padding: '10px',
                                    backgroundColor: 'rgba(255,255,255,0.05)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '12px',
                                    color: copied ? 'var(--accent-color)' : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                            >
                                {copied ? <Check size={18} /> : <Copy size={18} />}
                            </button>
                        </div>
                    </div>

                    {/* Details Grid */}
                    <div style={{ 
                        backgroundColor: 'rgba(255,255,255,0.02)',
                        borderRadius: '24px',
                        padding: '24px 32px',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        flexDirection: 'column'
                    }}>
                        <InfoRow label={t.name} value={server.name} />
                        <InfoRow label={t.protocol} value={server.protocol.toUpperCase()} />
                        <InfoRow label={t.address} value={server.address} />
                        <InfoRow label={t.port} value={server.port} />
                        <InfoRow label={t.network} value={server.network} />
                        <InfoRow label={t.security} value={server.security} />

                        {(server.protocol === 'vless' || server.protocol === 'vmess') && (
                            <InfoRow label={t.uuid} value={(server as any).uuid} />
                        )}
                        {server.protocol === 'vless' && (
                            <InfoRow label={t.flow} value={(server as any).flow} />
                        )}
                        {server.protocol === 'vmess' && (
                            <>
                                <InfoRow label={t.alterId} value={(server as any).alterId?.toString()} />
                                <InfoRow label={t.cipher} value={(server as any).cipher} />
                            </>
                        )}
                        {(server.protocol === 'trojan' || server.protocol === 'shadowsocks') && (
                            <InfoRow label={t.password} value={(server as any).password} />
                        )}
                        {server.sni && <InfoRow label={t.sni} value={server.sni} />}
                        {server.subscriptionName && <InfoRow label={t.subscription} value={server.subscriptionName} />}
                    </div>

                </div>
            </div>
        </div>
    );
}
