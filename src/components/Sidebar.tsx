import { type Server } from '../App';
import { type Subscription } from '../types/server';
import { Plus, Trash2, ChevronDown, ChevronRight, RefreshCw, ArrowUp, ArrowDown, Power, Shuffle, Grid, MoreHorizontal, Import } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from '../contexts/I18nContext';

interface SidebarProps {
    servers: Server[];
    subscriptions: Subscription[];
    activeServerId: string | null;
    onSelectServer: (id: string) => void;
    onAdd: () => void;
    onOpenSettings: (tab?: 'general' | 'inbound' | 'routing' | 'dns' | 'core' | 'advanced' | 'logs') => void;
    onOpenRouting: () => void;
    onDeleteServer: (id: string) => void;
    onDeleteSubscription: (id: string) => void;
    onRefreshSubscription: (id: string) => void;
    onPing: (id: string) => void;
}

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getDaysRemaining = (expireTimestamp: number) => {
    // timestamp is usually in seconds from panels
    const now = Date.now();
    const expire = expireTimestamp * 1000; // Convert to ms
    const diff = expire - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
};

export function Sidebar({ servers, subscriptions, activeServerId, onSelectServer, onAdd, onOpenSettings, onOpenRouting, onDeleteServer, onDeleteSubscription, onRefreshSubscription, onPing }: SidebarProps) {
    const { t } = useTranslation();
    const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set(subscriptions.map(s => s.id)));
    const [hoveredServer, setHoveredServer] = useState<string | null>(null);
    const [refreshingSub, setRefreshingSub] = useState<string | null>(null);

    const navItems = [
        { id: 'connect', label: t.connection, icon: Power, onClick: () => null, active: true },
        { id: 'routing', label: t.routing, icon: Shuffle, onClick: () => onOpenRouting() },
        { id: 'services', label: t.comingSoon, icon: Grid, onClick: () => null },
        { id: 'import', label: t.import, icon: Import, onClick: onAdd },
        { id: 'more', label: t.more, icon: MoreHorizontal, onClick: () => onOpenSettings('general') },
    ];

    // Group servers
    const individualServers = servers.filter(s => !s.subscriptionId);
    const subscriptionGroups = subscriptions.map(sub => ({
        subscription: sub,
        servers: servers.filter(s => s.subscriptionId === sub.id),
    })).filter(group => group.servers.length > 0);

    const toggleSubscription = (subId: string) => {
        setExpandedSubs(prev => {
            const next = new Set(prev);
            if (next.has(subId)) {
                next.delete(subId);
            } else {
                next.add(subId);
            }
            return next;
        });
    };

    const getStatusColor = (status: Server['status']) => {
        switch (status) {
            case 'connected': return '#34c759';
            case 'connecting': return '#ff9500';
            default: return '#8e8e93';
        }
    };

    const renderServer = (server: Server, showDelete: boolean = true) => (
        <div
            key={server.id}
            onClick={() => onSelectServer(server.id)}
            onMouseEnter={() => setHoveredServer(server.id)}
            onMouseLeave={() => setHoveredServer(null)}
            style={{
                padding: '12px 16px',
                cursor: 'pointer',
                backgroundColor: server.id === activeServerId ? 'rgba(0, 255, 163, 0.1)' : 'transparent',
                borderRadius: '12px',
                marginBottom: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                borderLeft: server.id === activeServerId ? '3px solid var(--accent-color)' : '3px solid transparent',
                boxShadow: server.id === activeServerId ? 'inset 0 0 15px rgba(0, 255, 163, 0.05)' : 'none',
            }}
            onMouseOver={(e) => {
                if (server.id !== activeServerId) {
                    e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                }
            }}
            onMouseOut={(e) => {
                if (server.id !== activeServerId) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                }
            }}
        >
            <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: getStatusColor(server.status),
                flexShrink: 0,
                boxShadow: server.status === 'connected' ? '0 0 10px var(--accent-color)' : 'none',
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    color: server.id === activeServerId ? 'var(--accent-color)' : 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    letterSpacing: '0.2px'
                }}>
                    {server.name}
                </div>
                <div style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontWeight: 500
                }}>
                    {server.protocol.toUpperCase()} • {server.address}
                    {server.ping !== undefined && (
                        <span style={{
                            marginLeft: '8px',
                            color: server.ping > 0 ? (server.ping < 100 ? 'var(--accent-color)' : '#ffb300') : 'var(--danger-color)',
                            fontWeight: 700
                        }}>
                            {server.ping > 0 ? `${server.ping}ms` : t.timeout}
                        </span>
                    )}
                </div>
            </div>
            {/* Ping Button (visible on hover) */}
            {hoveredServer === server.id && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onPing(server.id);
                    }}
                    style={{
                        padding: '6px',
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        border: 'none',
                        borderRadius: '6px',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        marginRight: '4px',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                    title={t.pingServer}
                >
                    <div style={{ fontSize: '10px', fontWeight: 'bold' }}>{t.ping}</div>
                </button>
            )}
            {showDelete && hoveredServer === server.id && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`${t.deleteServer} ${server.name}?`)) {
                            onDeleteServer(server.id);
                        }
                    }}
                    style={{
                        padding: '6px',
                        backgroundColor: 'rgba(255, 59, 48, 0.1)',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#ff3b30',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Trash2 size={16} />
                </button>
            )}
        </div>
    );

    return (
        <div style={{
            width: '280px',
            backgroundColor: 'var(--bg-secondary)',
            borderRight: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
        }}>
            <div style={{ padding: '24px 20px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                    width: 42,
                    height: 42,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--border-color)',
                    boxShadow: '0 0 20px rgba(0, 255, 163, 0.1)'
                }}>
                    <img src="logo.png" alt="Vlyne" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.5px' }}>VLYNE CLIENT</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t.secureConnection}</span>
                </div>
            </div>

            <div style={{ padding: '8px 12px 16px' }}>
                {navItems.map(item => (
                    <button
                        key={item.id}
                        onClick={item.onClick}
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '10px 14px',
                            marginBottom: 4,
                            borderRadius: 12,
                            backgroundColor: item.active ? 'rgba(0,255,163,0.12)' : 'transparent',
                            color: item.active ? 'var(--accent-color)' : 'var(--text-secondary)',
                            textAlign: 'left',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            borderLeft: item.active ? '3px solid var(--accent-color)' : '3px solid transparent',
                            boxShadow: item.active ? 'inset 0 0 20px rgba(0, 255, 163, 0.05)' : 'none',
                        }}
                        onMouseEnter={(e) => {
                            if (!item.active) {
                                e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                                e.currentTarget.style.color = 'var(--text-primary)';
                                e.currentTarget.style.transform = 'translateX(4px)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = item.active ? 'rgba(0,255,163,0.12)' : 'transparent';
                            if (!item.active) {
                                e.currentTarget.style.color = 'var(--text-secondary)';
                                e.currentTarget.style.transform = 'translateX(0)';
                            }
                        }}
                    >
                        <item.icon size={18} className={item.active ? 'glow-text' : ''} />
                        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.3px' }}>{item.label}</span>
                    </button>
                ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
                <style>{`
                    ::-webkit-scrollbar { width: 4px; }
                    ::-webkit-scrollbar-track { background: transparent; }
                    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
                    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
                `}</style>

                {/* Subscriptions */}
                {subscriptionGroups.length > 0 && (
                    <div style={{ marginBottom: '24px' }}>
                        {subscriptionGroups.map(({ subscription, servers: subServers }) => (
                            <div key={subscription.id} style={{ marginBottom: '12px' }}>
                                <div
                                    onClick={() => toggleSubscription(subscription.id)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '8px 8px',
                                        cursor: 'pointer',
                                        userSelect: 'none',
                                        borderRadius: '8px',
                                        transition: 'background 0.2s'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    {expandedSubs.has(subscription.id) ? <ChevronDown size={14} color="var(--text-secondary)" /> : <ChevronRight size={14} color="var(--text-secondary)" />}
                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                {subscription.name}
                                            </span>
                                            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', backgroundColor: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                                                {subServers.length}
                                            </span>
                                        </div>

                                        {/* Metadata Display */}
                                        {(subscription.upload || subscription.download || subscription.total || subscription.expire) ? (
                                            <div style={{ marginTop: '6px', paddingRight: '4px' }}>
                                                {(subscription.upload || subscription.download || subscription.total) ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                            <div style={{ display: 'flex', gap: '8px', fontWeight: 600 }}>
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                                    <ArrowUp size={10} color="var(--accent-color)" />
                                                                    {formatBytes(subscription.upload || 0)}
                                                                </span>
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                                    <ArrowDown size={10} color="#00d1ff" />
                                                                    {formatBytes(subscription.download || 0)}
                                                                </span>
                                                            </div>
                                                            {(subscription.total || 0) > 0 && (
                                                                <span style={{ opacity: 0.6 }}>
                                                                    / {formatBytes(subscription.total!)}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {(subscription.total || 0) > 0 && (
                                                            <div style={{
                                                                height: '3px',
                                                                backgroundColor: 'rgba(255,255,255,0.05)',
                                                                borderRadius: '2px',
                                                                overflow: 'hidden',
                                                                width: '100%'
                                                            }}>
                                                                <div style={{
                                                                    height: '100%',
                                                                    background: 'linear-gradient(90deg, var(--accent-color), #00d1ff)',
                                                                    width: `${Math.min(100, ((subscription.upload || 0) + (subscription.download || 0)) / subscription.total! * 100)}%`,
                                                                    borderRadius: '2px',
                                                                    transition: 'width 0.3s ease'
                                                                }} />
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : null}
                                                {(subscription.expire || 0) > 0 && (
                                                    <div style={{ 
                                                        fontSize: '10px', 
                                                        fontWeight: 700,
                                                        marginTop: '4px',
                                                        color: getDaysRemaining(subscription.expire!) < 3 ? 'var(--danger-color)' : 'var(--text-secondary)' 
                                                    }}>
                                                        {getDaysRemaining(subscription.expire!)} {t.daysLeft}
                                                    </div>
                                                )}
                                            </div>
                                        ) : null}
                                    </div>
                                    <div style={{ display: 'flex', gap: '2px' }}>
                                        <button
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                setRefreshingSub(subscription.id);
                                                await onRefreshSubscription(subscription.id);
                                                setRefreshingSub(null);
                                            }}
                                            disabled={refreshingSub === subscription.id}
                                            style={{
                                                padding: '6px',
                                                borderRadius: '6px',
                                                color: 'var(--text-secondary)',
                                                cursor: refreshingSub === subscription.id ? 'not-allowed' : 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                            title={t.refreshSubscription}
                                        >
                                            <RefreshCw
                                                size={14}
                                                style={{
                                                    animation: refreshingSub === subscription.id ? 'spin 1s linear infinite' : 'none',
                                                }}
                                            />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (confirm(`${t.deleteSubscription} "${subscription.name}" ${t.deleteSubscriptionConfirm}`)) {
                                                    onDeleteSubscription(subscription.id);
                                                }
                                            }}
                                            style={{
                                                padding: '6px',
                                                borderRadius: '6px',
                                                color: 'var(--text-secondary)',
                                                transition: 'all 0.2s'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = 'rgba(255, 77, 77, 0.1)';
                                                e.currentTarget.style.color = 'var(--danger-color)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                e.currentTarget.style.color = 'var(--text-secondary)';
                                            }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                                {expandedSubs.has(subscription.id) && (
                                    <div style={{ paddingLeft: '8px' }}>
                                        {subServers.map(server => renderServer(server, false))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Individual Servers */}
                {individualServers.length > 0 && (
                    <div>
                        <div style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            letterSpacing: '1px',
                            textTransform: 'uppercase',
                            color: 'var(--text-secondary)',
                            padding: '8px 8px',
                            marginBottom: '4px',
                        }}>
                            {t.individualServers}
                        </div>
                        {individualServers.map(server => renderServer(server))}
                    </div>
                )}
            </div>

            <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)' }}>
                <button
                    onClick={onAdd}
                    style={{
                        width: '100%',
                        padding: '14px',
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        fontSize: '14px',
                        fontWeight: 700,
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                        e.currentTarget.style.borderColor = 'var(--border-color)';
                        e.currentTarget.style.transform = 'translateY(0)';
                    }}
                >
                    <Plus size={18} />
                    {t.add}
                </button>
            </div>
        </div>
    );
}
