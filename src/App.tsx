import { useState, useEffect } from 'react';
import './index.css';
import { Sidebar } from './components/Sidebar';
import { ConnectionPanel } from './components/ConnectionPanel';
import { UnifiedAddModal } from './components/UnifiedAddModal';
import { SettingsModal, type SettingsTab } from './components/SettingsModal';
import { SettingsProvider } from './contexts/SettingsContext';
import { I18nProvider } from './contexts/I18nContext';
import { parseProxyLink } from './utils/protocol-parser';
import { fetchSubscription } from './utils/subscription';
import type { ServerConfig, Subscription } from './types/server';

// Server type
export type Server = ServerConfig;

function AppContent() {
  const [servers, setServers] = useState<Server[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load state from store on mount
  useEffect(() => {
    const loadState = async () => {
      if (window.electronAPI?.store) {
        try {
          const [storedServers, storedSubs, storedActiveId] = await Promise.all([
            window.electronAPI.store.get('servers'),
            window.electronAPI.store.get('subscriptions'),
            window.electronAPI.store.get('activeServerId')
          ]);

          if (storedServers) setServers(storedServers);
          if (storedSubs) setSubscriptions(storedSubs);
          if (storedActiveId) setActiveServerId(storedActiveId);
        } catch (error) {
          console.error('Failed to load application state:', error);
        }
      }
      setIsLoaded(true);
    };
    loadState();
  }, []);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [isRoutingOpen, setIsRoutingOpen] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.onVpnStopped) return;

    const unsubscribe = window.electronAPI.onVpnStopped((payload) => {
      console.log('VPN stopped', payload);
      setServers(prev =>
        prev.map(server =>
          server.status === 'connected' || server.status === 'connecting'
            ? { ...server, status: 'disconnected', lastError: payload?.code ?? payload?.reason }
            : server
        )
      );
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  // Persist state changes
  useEffect(() => {
    if (isLoaded && window.electronAPI?.store) {
      window.electronAPI.store.set('servers', servers);
    }
  }, [servers, isLoaded]);

  useEffect(() => {
    if (isLoaded && window.electronAPI?.store) {
      window.electronAPI.store.set('subscriptions', subscriptions);
    }
  }, [subscriptions, isLoaded]);

  useEffect(() => {
    if (isLoaded && window.electronAPI?.store) {
      window.electronAPI.store.set('activeServerId', activeServerId);
    }
  }, [activeServerId, isLoaded]);

  const activeServer = servers.find(s => s.id === activeServerId) || null;

  const handleAddServer = (link: string) => {
    console.log('handleAddServer called with:', link);
    const server = parseProxyLink(link);
    console.log('Parsed server:', server);
    if (!server) {
      throw new Error('Invalid configuration link. Supported formats: vless://, vmess://, trojan://, ss://');
    }
    setServers(prev => [...prev, server]);
    if (!activeServerId) setActiveServerId(server.id);
    console.log('Server added successfully');
  };

  const handleAddSubscription = async (url: string, name: string) => {
    console.log('handleAddSubscription called with:', url, name);
    try {
      const subscriptionId = crypto.randomUUID();
      const subscriptionServers = await fetchSubscription(url);

      const metadata = (subscriptionServers as any).metadata || {};
      const detectedName = (subscriptionServers as any).subscriptionName;
      const finalName = detectedName || name;

      console.log('Fetched servers:', subscriptionServers);
      console.log('Number of servers:', subscriptionServers.length);

      // Mark servers with subscription info
      const markedServers = subscriptionServers.map(server => ({
        ...server,
        subscriptionId,
        subscriptionName: finalName,
      }));

      // Add subscription metadata
      setSubscriptions(prev => [...prev, {
        id: subscriptionId,
        name: finalName,
        url,
        lastUpdate: Date.now(),
        upload: metadata.upload,
        download: metadata.download,
        total: metadata.total,
        expire: metadata.expire,
      }]);

      setServers(prev => [...prev, ...markedServers]);
      if (!activeServerId && markedServers.length > 0) {
        setActiveServerId(markedServers[0].id);
      }
      console.log('Servers added to state');
    } catch (error) {
      console.error('Error in handleAddSubscription:', error);
      throw error;
    }
  };

  const handleDeleteServer = (serverId: string) => {
    setServers(prev => prev.filter(s => s.id !== serverId));
    if (activeServerId === serverId) {
      setActiveServerId(null);
    }
  };

  const handleDeleteSubscription = (subscriptionId: string) => {
    setServers(prev => prev.filter(s => s.subscriptionId !== subscriptionId));
    setSubscriptions(prev => prev.filter(sub => sub.id !== subscriptionId));
    // If active server was from this subscription, clear it
    const activeServerFromSub = servers.find(s => s.id === activeServerId && s.subscriptionId === subscriptionId);
    if (activeServerFromSub) {
      setActiveServerId(null);
    }
  };

  const handleRefreshSubscription = async (subscriptionId: string) => {
    const subscription = subscriptions.find(sub => sub.id === subscriptionId);
    if (!subscription) return;

    try {
      // Remove old servers from this subscription
      setServers(prev => prev.filter(s => s.subscriptionId !== subscriptionId));

      // Fetch new servers
      // Fetch new servers
      const newServers = await fetchSubscription(subscription.url);

      const metadata = (newServers as any).metadata || {};
      const detectedName = (newServers as any).subscriptionName;

      const markedServers = newServers.map(server => ({
        ...server,
        subscriptionId,
        subscriptionName: subscription.name, // Keep existing name or update? User said "fix display", maybe update if detected?
      }));

      // Add new servers
      setServers(prev => [...prev, ...markedServers]);

      // Update last update time and metadata
      setSubscriptions(prev => prev.map(sub =>
        sub.id === subscriptionId ? {
          ...sub,
          lastUpdate: Date.now(),
          upload: metadata.upload,
          download: metadata.download,
          total: metadata.total,
          expire: metadata.expire,
          name: detectedName || sub.name // Optionally update name
        } : sub
      ));
    } catch (error) {
      console.error('Failed to refresh subscription:', error);
      alert('Failed to refresh subscription');
    }
  };

  const handlePingServer = async (serverId: string) => {
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    try {
      // Set to -1 to indicate loading/pinging if needed, or just keep old
      const latency = await window.electronAPI.pingServer(server.address, parseInt(server.port));

      setServers(prev => prev.map(s =>
        s.id === serverId ? { ...s, ping: latency } : s
      ));
    } catch (error) {
      console.error('Ping failed:', error);
      setServers(prev => prev.map(s =>
        s.id === serverId ? { ...s, ping: -1 } : s
      ));
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <Sidebar
        servers={servers}
        subscriptions={subscriptions}
        activeServerId={activeServerId}
        onSelectServer={setActiveServerId}
        onAdd={() => setIsAddModalOpen(true)}
        onOpenSettings={(tab?: SettingsTab) => {
          setSettingsTab(tab || 'general');
          setIsSettingsOpen(true);
        }}
        onOpenRouting={() => setIsRoutingOpen(true)}
        onDeleteServer={handleDeleteServer}
        onDeleteSubscription={handleDeleteSubscription}
        onRefreshSubscription={handleRefreshSubscription}
        onPing={handlePingServer}
      />
      <ConnectionPanel
        server={activeServer}
        onStatusChange={(status: Server['status']) => {
          if (activeServerId) {
            setServers(prev => prev.map(s =>
              s.id === activeServerId ? { ...s, status } : s
            ));
          }
        }}
      />
      <UnifiedAddModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddServer={handleAddServer}
        onAddSubscription={handleAddSubscription}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsTab}
      />
      <SettingsModal
        isOpen={isRoutingOpen}
        onClose={() => setIsRoutingOpen(false)}
        initialTab="routing"
        allowedTabs={['routing']}
        title="Маршрутизация"
      />
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <I18nProvider>
        <AppContent />
      </I18nProvider>
    </SettingsProvider>
  );
}
