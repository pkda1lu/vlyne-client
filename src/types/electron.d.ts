export interface ElectronAPI {
    startVpn: (config: any) => Promise<{ success: boolean; error?: string }>;
    stopVpn: () => Promise<{ success: boolean; error?: string }>;
    pingServer: (host: string, port: number) => Promise<number>;
    fetchSubscription: (url: string) => Promise<{ data: string; name?: string; userInfo?: string }>;
    onLog: (callback: (log: string) => void) => () => void;
    onVpnStopped: (callback: (payload: any) => void) => () => void;
    store: {
        get: (key: string) => Promise<any>;
        set: (key: string, val: any) => Promise<void>;
    };
    getVersion: () => Promise<string>;
    checkForUpdates: () => Promise<any>;
    downloadUpdate: () => Promise<void>;
    installUpdate: () => Promise<void>;
    onUpdateAvailable: (callback: (info: any) => void) => () => void;
    onDownloadProgress: (callback: (progress: any) => void) => () => void;
    onUpdateDownloaded: (callback: (info: any) => void) => () => void;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
