/**
 * Quick 260524-olt — i18n 初始化。
 *
 * - 框架：react-i18next + i18next（无 backend / 无 LanguageDetector 包）
 * - 资源：三套 translation.json 同步 import，直接 bundle 进主 chunk
 * - 检测顺序：persisted prefs → navigator.language 前缀 → fallback "zh-CN"
 *
 * 单向依赖契约：
 *   - i18n.ts 只 import lib/preferences（读 persisted lng），不 import store
 *   - store/preferences.ts import i18n（写 lng）
 *   - lib/preferences.ts 不 import i18n
 *
 * 切换语言用 store.setLanguage(...)；它会调 i18n.changeLanguage() 触发
 * useTranslation() 订阅者全部 re-render，无需 React Provider。
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN/translation.json";
import jaJP from "./locales/ja-JP/translation.json";
import enUS from "./locales/en-US/translation.json";
import { loadPreferences } from "./lib/preferences";

export type SupportedLng = "zh-CN" | "ja-JP" | "en-US";
export const SUPPORTED_LNGS: SupportedLng[] = ["zh-CN", "ja-JP", "en-US"];

const DEFAULT_LNG: SupportedLng = "zh-CN";

/** Decide initial language: persisted > navigator > default. */
export function detectInitialLng(): SupportedLng {
  // loadPreferences() 已有 fallback 到 DEFAULT_PREFS,language 字段始终存在。
  try {
    const persisted = loadPreferences().language;
    if (persisted) return persisted;
  } catch {
    // 极端情况(localStorage 抛错)继续走 navigator 探测
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  if (nav.startsWith("zh")) return "zh-CN";
  if (nav.startsWith("ja")) return "ja-JP";
  if (nav.startsWith("en")) return "en-US";
  return DEFAULT_LNG;
}

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "ja-JP": { translation: jaJP },
    "en-US": { translation: enUS },
  },
  lng: detectInitialLng(),
  fallbackLng: DEFAULT_LNG,
  // 平坦 key（"a.b.c"）— 我们的资源就是这样组织的，禁用 nsSeparator/keySeparator
  // 以避免 dot 被当作命名空间分隔。
  nsSeparator: false,
  keySeparator: false,
  interpolation: { escapeValue: false }, // React 已转义
  returnNull: false,
});

export default i18n;
