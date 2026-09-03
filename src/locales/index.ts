import { ru } from './ru';
import { en } from './en';

export type Dictionary = typeof ru;
export type LocaleKey = 'ru' | 'en';

export const locales: Record<LocaleKey, Dictionary> = { ru, en };

/**
 * Resolve a dotted key against a dictionary.
 *
 * Falls back to Russian and then to the key itself, so a missing translation
 * shows up as a visible key rather than an empty label.
 */
export function translate(
  dict: Dictionary,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const lookup = (source: unknown): string | undefined => {
    const value = key
      .split('.')
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], source);
    return typeof value === 'string' ? value : undefined;
  };

  const template = lookup(dict) ?? lookup(ru) ?? key;
  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
