import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

/**
 * Messages are split per functional area (messages/<locale>/<area>.json) so
 * each area can be translated and extended independently; they are deep
 * merged, so several files may add keys to the same namespace (e.g. "nav").
 */
const AREAS = ['core', 'finance', 'operations', 'people'] as const;

type Messages = Record<string, unknown>;

function deepMerge(target: Messages, source: Messages): Messages {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    target[key] =
      value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object'
        ? deepMerge({ ...(current as Messages) }, value as Messages)
        : value;
  }
  return target;
}

export async function loadMessages(locale: string): Promise<Messages> {
  const parts = await Promise.all(
    AREAS.map(async (area) => (await import(`./messages/${locale}/${area}.json`)).default as Messages),
  );
  return parts.reduce((all, part) => deepMerge(all, part), {} as Messages);
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }
  return {
    locale,
    messages: await loadMessages(locale),
  };
});
