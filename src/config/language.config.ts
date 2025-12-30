export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  flag?: string;
}

export const LANGUAGE_CONFIG: LanguageOption[] = [
  { code: 'en-US', name: 'English (US)', nativeName: 'English (US)', flag: '🇺🇸' },
  { code: 'vi-VN', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en-GB', name: 'English (UK)', nativeName: 'English (UK)', flag: '🇬🇧' },
  { code: 'ja-JP', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko-KR', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文', flag: '🇹🇼' },
  { code: 'fr-FR', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de-DE', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'es-ES', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'it-IT', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', flag: '🇧🇷' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)', nativeName: 'Português (Portugal)', flag: '🇵🇹' },
  { code: 'ru-RU', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'th-TH', name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭' },
];

export function getLanguageName(code: string): string {
  const lang = LANGUAGE_CONFIG.find(l => l.code === code);
  return lang ? `${lang.flag} ${lang.nativeName}` : code;
}

export function getLanguageByCode(code: string): LanguageOption | undefined {
  return LANGUAGE_CONFIG.find(l => l.code === code);
}