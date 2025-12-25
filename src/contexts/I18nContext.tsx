import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useSettings } from './SettingsContext';
import { translations } from '../locales';
import type { Translation } from '../locales/en';

interface I18nContextType {
    t: Translation;
    language: 'en' | 'ru';
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
    const { settings } = useSettings();
    const language = settings.general.language;
    const t = translations[language];

    return (
        <I18nContext.Provider value={{ t, language }}>
            {children}
        </I18nContext.Provider>
    );
}

export function useTranslation() {
    const context = useContext(I18nContext);
    if (!context) {
        throw new Error('useTranslation must be used within I18nProvider');
    }
    return context;
}
