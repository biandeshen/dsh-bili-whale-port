import type { ConfigGroup } from '../../core/types.ts';
import type { Language } from '../../core/language.ts';
import type { SafeSearch } from './brave-client.ts';
import { text } from './strings.ts';

export type SearchProvider = 'brave' | 'deepseek';
export const SEARCH_PROVIDERS: readonly SearchProvider[] = ['brave', 'deepseek'];

/** World 自有配置的默认值;启用状态由部署装配配置决定。 */
export const WEBSEARCH_DEFAULTS = {
  enabled: false,
  provider: 'brave' as SearchProvider,
  /** 结果地区(ISO 2位);中文场景默认CN */
  country: 'CN',
  searchLang: 'zh-hans',
  uiLang: 'zh-CN',
  safesearch: 'moderate' as SafeSearch,
  timeoutMs: 20000,
} as const;

/** 各搜索服务的密钥环境变量名(core 不认识这些名字)。DeepSeek 不用 DEEPSEEK_API_KEY:那是模型端点的,两边写同一变量会互相覆盖。 */
export const WEBSEARCH_SECRETS: Record<SearchProvider, string> = {
  brave: 'BRAVE_API_KEY',
  deepseek: 'DEEPSEEK_SEARCH_API_KEY',
};

/** 本 World 声明的可调项:用哪家搜索、搜哪个地区、用什么语言、多久超时。文案按界面语言给。 */
export function webSearchConfigGroup(language: Language): ConfigGroup {
  const t = text(language);
  return {
    id: 'world:websearch',
    owner: 'world:websearch',
    schema: {
      type: 'object',
      title: t.configTitle,
      description: t.configDescription,
      properties: {
        'worlds.websearch.provider': {
          type: 'string',
          title: t.providerTitle,
          enum: [...SEARCH_PROVIDERS],
          'x-hot': true,
          description: t.providerDescription,
        },
        'worlds.websearch.country': {
          type: 'string',
          title: t.countryTitle,
          'x-hot': true,
          description: t.countryDescription,
        },
        'worlds.websearch.searchLang': {
          type: 'string',
          title: t.searchLangTitle,
          'x-hot': true,
          description: t.searchLangDescription,
        },
        'worlds.websearch.uiLang': {
          type: 'string',
          title: t.uiLangTitle,
          'x-hot': true,
          description: t.uiLangDescription,
        },
        'worlds.websearch.safesearch': {
          type: 'string',
          title: t.safesearchTitle,
          enum: ['off', 'moderate', 'strict'],
          'x-hot': true,
          description: t.safesearchDescription,
        },
        'worlds.websearch.timeoutMs': {
          type: 'integer',
          title: t.timeoutTitle,
          minimum: 1000,
          maximum: 120_000,
          multipleOf: 1000,
          'x-scale': 1000,
          'x-suffix': 's',
          'x-hot': true,
          description: t.timeoutDescription,
        },
      },
    },
  };
}

/** config.json 的 `worlds.websearch` 节。每次搜索时读，改完立即生效。 */
export interface WebSearchConfigSection {
  enabled: boolean;
  provider: SearchProvider;
  country: string;
  searchLang: string;
  uiLang: string;
  safesearch: SafeSearch;
  timeoutMs: number;
}

/** 「快速配置」页签 `state` 的返回形状;密钥只给打码后的样子。 */
export interface WebSearchPanelState {
  provider: SearchProvider;
  keys: Record<SearchProvider, string | null>;
}
