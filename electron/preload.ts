import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    startVpn: (config: any) => ipcRenderer.invoke('start-vpn', config),
    stopVpn: () => ipcRenderer.invoke('stop-vpn'),
    pingServer: (host: string, port: number) => ipcRenderer.invoke('ping-server', host, port),
    fetchSubscription: (url: string) => ipcRenderer.invoke('fetch-subscription', url),
    onLog: (callback: (log: string) => void) => {
        const subscription = (_: any, log: string) => callback(log);
        ipcRenderer.on('xray-log', subscription);
        return () => ipcRenderer.removeListener('xray-log', subscription);
    },
    onVpnStopped: (callback: (payload: any) => void) => {
        const subscription = (_: any, payload: any) => callback(payload);
        ipcRenderer.on('vpn-stopped', subscription);
        return () => ipcRenderer.removeListener('vpn-stopped', subscription);
    },
    store: {
        get: (key: string) => ipcRenderer.invoke('get-store', key),
        set: (key: string, val: any) => ipcRenderer.invoke('set-store', key, val),
    },
    getVersion: () => ipcRenderer.invoke('get-version'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
});
