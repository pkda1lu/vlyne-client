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
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
        }} onClick={onClose}>
            <div style={{
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: '12px',
                width: '90%',
                maxWidth: '600px',
                maxHeight: '90vh',
                overflowY: 'auto',
                padding: '24px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 600 }}>{t.serverInfo || 'Server Info'}</h2>
                    <button onClick={onClose} style={{ padding: '4px', color: 'var(--text-secondary)' }}>
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

                    {/* Link Section */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                            {t.configurationLink || 'Configuration Link'}
                        </label>
                        <div style={{ position: 'relative' }}>
                            <textarea
                                readOnly
                                value={server.originalLink || ''}
                                style={{
                                    width: '100%',
                                    height: '80px',
                                    padding: '12px',
                                    paddingRight: '40px',
                                    backgroundColor: 'var(--bg-primary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '8px',
                                    color: 'var(--text-primary)',
                                    fontSize: '12px',
                                    resize: 'none',
                                    fontFamily: 'monospace'
                                }}
                            />
                            <button
                                onClick={copyLink}
                                style={{
                                    position: 'absolute',
                                    top: '8px',
                                    right: '8px',
                                    padding: '6px',
                                    backgroundColor: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '6px',
                                    color: copied ? 'var(--success-color)' : 'var(--text-secondary)',
                                    cursor: 'pointer'
                                }}
                            >
                                {copied ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                        </div>
                    </div>

                    {/* Details Table */}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
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
