import { useCallback } from 'react';

import { useStore } from '../lib/store';
import { locales, translate, type LocaleKey } from '../locales';

/**
 * Translation bound to the language in settings.
 *
 * `t('nodes.imported', { count: 3 })` fills `{count}` in the template.
 */
export function useI18n() {
  const language = useStore((s) => s.data?.settings.general.language ?? 'ru');
  const key: LocaleKey = language === 'en' ? 'en' : 'ru';
  const dict = locales[key];

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>) => translate(dict, path, vars),
    [dict],
  );

  return { t, language: key, locale: key === 'en' ? 'en-US' : 'ru-RU' };
}
