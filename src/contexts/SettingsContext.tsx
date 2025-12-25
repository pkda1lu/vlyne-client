import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AppSettings } from '../types/settings';
import { defaultSettings } from '../types/settings';

interface SettingsContextType {
    settings: AppSettings;
    updateSettings: (newSettings: Partial<AppSettings>) => void;
    resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const SETTINGS_KEY = 'settings';

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<AppSettings>(defaultSettings);
    const [isLoading, setIsLoading] = useState(true);

    // Load from store on mount
    useEffect(() => {
        const loadSettings = async () => {
            if (window.electronAPI?.store) {
                try {
                    const stored = await window.electronAPI.store.get(SETTINGS_KEY);
                    if (stored) {
                        const migratedInbound = { ...(stored.inbound || {}) };
                        // Migrate old default ports (10808/10809) to new defaults (10806/10810)
                        if (
                            stored.inbound?.socksPort === 10808 &&
                            stored.inbound?.httpPort === 10809
                        ) {
                            migratedInbound.socksPort = 10806;
                            migratedInbound.httpPort = 10810;
                        }

                        setSettings(prev => ({
                            ...prev,
                            ...stored,
                            // Deep merge to ensure new keys exist if schema changes
                            general: { ...prev.general, ...(stored.general || {}) },
                            inbound: { ...prev.inbound, ...migratedInbound },
                            routing: { ...prev.routing, ...(stored.routing || {}) },
                            dns: { ...prev.dns, ...(stored.dns || {}) },
                            core: { ...prev.core, ...(stored.core || {}) },
                            advanced: { ...prev.advanced, ...(stored.advanced || {}) },
                        }));
                    }
                } catch (error) {
                    console.error('Failed to load settings:', error);
                }
            }
            setIsLoading(false);
        };
        loadSettings();
    }, []);

    // Save to store whenever settings change
    useEffect(() => {
        if (!isLoading && window.electronAPI?.store) {
            window.electronAPI.store.set(SETTINGS_KEY, settings);
        }
    }, [settings, isLoading]);

    const updateSettings = (newSettings: Partial<AppSettings>) => {
        setSettings(prev => ({
            ...prev,
            ...newSettings,
            // Deep merge for nested objects
            general: { ...prev.general, ...(newSettings.general || {}) },
            routing: { ...prev.routing, ...(newSettings.routing || {}) },
            dns: { ...prev.dns, ...(newSettings.dns || {}) },
            inbound: { ...prev.inbound, ...(newSettings.inbound || {}) },
            core: { ...prev.core, ...(newSettings.core || {}) },
            advanced: { ...prev.advanced, ...(newSettings.advanced || {}) },
        }));
    };

    const resetSettings = () => {
        setSettings(defaultSettings);
    };

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings() {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within SettingsProvider');
    }
    return context;
}
