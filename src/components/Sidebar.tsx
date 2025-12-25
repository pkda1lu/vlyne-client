import { type Server } from '../App';
import { type Subscription } from '../types/server';
import { Plus, Settings, Trash2, ChevronDown, ChevronRight, RefreshCw, ArrowUp, ArrowDown, Power, Shuffle, Grid, MoreHorizontal, Import, LogOut } from 'lucide-react';
import { useMemo, useState } from 'react';
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

    const navItems = useMemo(() => ([
        { id: 'connect', label: 'Подключение', icon: Power, onClick: () => null, active: true },
        { id: 'routing', label: 'Маршрутизация', icon: Shuffle, onClick: () => onOpenRouting() },
        { id: 'services', label: 'Скоро...', icon: Grid, onClick: () => null },
        { id: 'import', label: 'Импорт', icon: Import, onClick: onAdd },
        { id: 'more', label: 'Еще', icon: MoreHorizontal, onClick: () => onOpenSettings('general') },
    ]), [onAdd, onOpenSettings, onOpenRouting]);

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
                backgroundColor: server.id === activeServerId ? 'var(--accent-color)' : 'transparent',
                borderRadius: '8px',
                marginBottom: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                transition: 'background-color 0.2s',
                position: 'relative',
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
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    fontWeight: 500,
                    fontSize: '14px',
                    color: server.id === activeServerId ? '#fff' : 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>
                    {server.name}
                </div>
                <div style={{
                    fontSize: '12px',
                    color: server.id === activeServerId ? 'rgba(255,255,255,0.7)' : 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>
                    {server.protocol.toUpperCase()} • {server.address}
                    {server.ping !== undefined && (
                        <span style={{
                            marginLeft: '8px',
                            color: '#fff',
                            fontWeight: 600
                        }}>
                            {server.ping > 0 ? `${server.ping}ms` : 'Timeout'}
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
                    title="Ping server"
                >
                    <div style={{ fontSize: '10px', fontWeight: 'bold' }}>Ping</div>
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
            boxShadow: '4px 0 18px rgba(0,0,0,0.25)'
        }}>
            <div style={{ padding: '20px 16px 12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: '#0b0d0f',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    border: '1px solid var(--border-color)'
                }}>
                    <img src="logo.png" alt="Vlyne" style={{ width: '70%', height: '70%', objectFit: 'contain' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: 0.2 }}>VLYNE CLIENT</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Безопасное подключение</span>
                </div>
            </div>

            <div style={{ padding: '8px 8px 12px' }}>
                {navItems.map(item => (
                    <button
                        key={item.id}
                        onClick={item.onClick}
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '10px 12px',
                            marginBottom: 6,
                            borderRadius: 10,
                            backgroundColor: item.active ? 'rgba(0,195,106,0.12)' : 'transparent',
                            color: item.active ? '#fff' : 'var(--text-secondary)',
                            textAlign: 'left',
                            transition: 'background-color 0.2s, color 0.2s'
                        }}
                        onMouseEnter={(e) => {
                            if (!item.active) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = item.active ? 'rgba(0,195,106,0.12)' : 'transparent';
                        }}
                    >
                        <item.icon size={18} />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{item.label}</span>
                    </button>
                ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 12px' }}>
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
                                        padding: '8px 4px',
                                        cursor: 'pointer',
                                        userSelect: 'none',
                                    }}
                                >
                                    {expandedSubs.has(subscription.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                {subscription.name}
                                            </span>
                                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                {subServers.length}
                                            </span>
                                        </div>

                                        {/* Metadata Display */}
                                        {(subscription.upload || subscription.download || subscription.total || subscription.expire) ? (
                                            <div style={{ marginTop: '4px', paddingRight: '4px' }}>
                                                {(subscription.upload || subscription.download || subscription.total) ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                                                        {/* Stats Row */}
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }} title="Upload">
                                                                    <ArrowUp size={10} />
                                                                    {formatBytes(subscription.upload || 0)}
                                                                </span>
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }} title="Download">
                                                                    <ArrowDown size={10} />
                                                                    {formatBytes(subscription.download || 0)}
                                                                </span>
                                                            </div>
                                                            {(subscription.total || 0) > 0 && (
                                                                <span title="Total Limit">
                                                                    / {formatBytes(subscription.total!)}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Progress Bar */}
                                                        {(subscription.total || 0) > 0 && (
                                                            <div style={{
                                                                height: '4px',
                                                                backgroundColor: 'rgba(255,255,255,0.1)',
                                                                borderRadius: '2px',
                                                                overflow: 'hidden',
                                                                width: '100%'
                                                            }}>
                                                                <div style={{
                                                                    height: '100%',
                                                                    backgroundColor: 'var(--accent-color)',
                                                                    width: `${Math.min(100, ((subscription.upload || 0) + (subscription.download || 0)) / subscription.total! * 100)}%`,
                                                                    borderRadius: '2px',
                                                                    transition: 'width 0.3s ease'
                                                                }} />
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : null}
                                                {(subscription.expire || 0) > 0 && (
                                                    <div style={{ fontSize: '10px', color: getDaysRemaining(subscription.expire!) < 3 ? '#ff3b30' : 'var(--text-secondary)' }}>
                                                        {getDaysRemaining(subscription.expire!)} days left
                                                    </div>
                                                )}
                                            </div>
                                        ) : null}
                                    </div>
                                    <button
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            setRefreshingSub(subscription.id);
                                            await onRefreshSubscription(subscription.id);
                                            setRefreshingSub(null);
                                        }}
                                        disabled={refreshingSub === subscription.id}
                                        style={{
                                            padding: '4px',
                                            backgroundColor: 'transparent',
                                            border: 'none',
                                            color: 'var(--text-secondary)',
                                            cursor: refreshingSub === subscription.id ? 'not-allowed' : 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            opacity: refreshingSub === subscription.id ? 0.5 : 1,
                                        }}
                                        title="Refresh subscription"
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
                                            padding: '4px',
                                            backgroundColor: 'transparent',
                                            border: 'none',
                                            color: 'var(--text-secondary)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                {expandedSubs.has(subscription.id) && (
                                    <div style={{ marginLeft: '8px' }}>
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
                            fontSize: '13px',
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                            padding: '8px 4px',
                            marginBottom: '8px',
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
                        padding: '12px',
                        backgroundColor: 'var(--accent-color)',
                        color: '#fff',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        fontWeight: 500,
                        transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--accent-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--accent-color)'}
                >
                    <Plus size={20} />
                    {t.add}
                </button>
            </div>
        </div>
    );
}
