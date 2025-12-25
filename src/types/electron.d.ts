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
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
