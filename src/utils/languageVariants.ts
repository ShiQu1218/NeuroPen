import type {
  CustomLanguageVariant,
  PreferredLanguage,
} from "../store/appStoreTypes";

export interface LanguageVariantDefinition extends CustomLanguageVariant {
  kind: "builtin" | "custom";
  aliases?: string[];
  regionCode?: string;
  scriptCode?: string;
}

export interface LanguageVariantGroup {
  languageCode: string;
  languageLabel: string;
  defaultVariantId: string;
  variants: LanguageVariantDefinition[];
}

const AUTO_LANGUAGE_VARIANT = "auto";

const BUILTIN_LANGUAGE_VARIANTS: LanguageVariantDefinition[] = [
  {
    id: "en-us",
    languageCode: "en",
    language: "English",
    variantLabel: "English (United States)",
    promptInstruction: "Use American English spelling, vocabulary, punctuation, and grammar.",
    kind: "builtin",
    aliases: ["en-US"],
    regionCode: "US",
  },
  {
    id: "en-gb",
    languageCode: "en",
    language: "English",
    variantLabel: "English (United Kingdom)",
    promptInstruction: "Use British English spelling, vocabulary, punctuation, and grammar.",
    kind: "builtin",
    aliases: ["en-GB"],
    regionCode: "GB",
  },
  {
    id: "zh-hant-tw",
    languageCode: "zh",
    language: "Chinese",
    variantLabel: "Traditional Chinese (Taiwan)",
    promptInstruction: "Use Traditional Chinese as commonly written in Taiwan, with Traditional characters and Taiwan-standard phrasing.",
    kind: "builtin",
    aliases: ["zh-TW"],
    regionCode: "TW",
    scriptCode: "Hant",
  },
  {
    id: "zh-hans-cn",
    languageCode: "zh",
    language: "Chinese",
    variantLabel: "Simplified Chinese (Mainland China)",
    promptInstruction: "Use Simplified Chinese as commonly written in Mainland China, with Simplified characters and Mainland-standard phrasing.",
    kind: "builtin",
    aliases: ["zh-CN"],
    regionCode: "CN",
    scriptCode: "Hans",
  },
  {
    id: "zh-hant-hk",
    languageCode: "zh",
    language: "Chinese",
    variantLabel: "Traditional Chinese (Hong Kong)",
    promptInstruction: "Use Traditional Chinese as commonly written in Hong Kong, with Traditional characters and Hong Kong-standard wording.",
    kind: "builtin",
    regionCode: "HK",
    scriptCode: "Hant",
  },
  {
    id: "es-mx",
    languageCode: "es",
    language: "Spanish",
    variantLabel: "Spanish (Mexico)",
    promptInstruction: "Use Spanish as commonly written in Mexico.",
    kind: "builtin",
    regionCode: "MX",
  },
  {
    id: "es-es",
    languageCode: "es",
    language: "Spanish",
    variantLabel: "Spanish (Spain)",
    promptInstruction: "Use Spanish as commonly written in Spain.",
    kind: "builtin",
    aliases: ["es-ES"],
    regionCode: "ES",
  },
  {
    id: "es-419",
    languageCode: "es",
    language: "Spanish",
    variantLabel: "Spanish (Latin America)",
    promptInstruction: "Use neutral Latin American Spanish.",
    kind: "builtin",
  },
  {
    id: "fr-fr",
    languageCode: "fr",
    language: "French",
    variantLabel: "French (France)",
    promptInstruction: "Use French as commonly written in France.",
    kind: "builtin",
    aliases: ["fr-FR"],
    regionCode: "FR",
  },
  {
    id: "fr-ca",
    languageCode: "fr",
    language: "French",
    variantLabel: "French (Canada)",
    promptInstruction: "Use French as commonly written in Canada.",
    kind: "builtin",
    regionCode: "CA",
  },
  {
    id: "pt-pt",
    languageCode: "pt",
    language: "Portuguese",
    variantLabel: "Portuguese (Portugal)",
    promptInstruction: "Use Portuguese as commonly written in Portugal.",
    kind: "builtin",
    aliases: ["pt-PT"],
    regionCode: "PT",
  },
  {
    id: "pt-br",
    languageCode: "pt",
    language: "Portuguese",
    variantLabel: "Portuguese (Brazil)",
    promptInstruction: "Use Portuguese as commonly written in Brazil.",
    kind: "builtin",
    regionCode: "BR",
  },
  {
    id: "de-de",
    languageCode: "de",
    language: "German",
    variantLabel: "German (Germany)",
    promptInstruction: "Use German as commonly written in Germany.",
    kind: "builtin",
    aliases: ["de-DE"],
    regionCode: "DE",
  },
  {
    id: "de-at",
    languageCode: "de",
    language: "German",
    variantLabel: "German (Austria)",
    promptInstruction: "Use German as commonly written in Austria.",
    kind: "builtin",
    regionCode: "AT",
  },
  {
    id: "de-ch",
    languageCode: "de",
    language: "German",
    variantLabel: "German (Switzerland)",
    promptInstruction: "Use German as commonly written in Switzerland.",
    kind: "builtin",
    regionCode: "CH",
  },
  {
    id: "it-it",
    languageCode: "it",
    language: "Italian",
    variantLabel: "Italian (Italy)",
    promptInstruction: "Use standard Italian as commonly written in Italy.",
    kind: "builtin",
    aliases: ["it-IT"],
    regionCode: "IT",
  },
  {
    id: "ja-jp",
    languageCode: "ja",
    language: "Japanese",
    variantLabel: "Japanese (Japan)",
    promptInstruction: "Use standard Japanese as commonly written in Japan.",
    kind: "builtin",
    aliases: ["ja-JP"],
    regionCode: "JP",
  },
  {
    id: "ko-kr",
    languageCode: "ko",
    language: "Korean",
    variantLabel: "Korean (South Korea)",
    promptInstruction: "Use standard Korean as commonly written in South Korea.",
    kind: "builtin",
    aliases: ["ko-KR"],
    regionCode: "KR",
  },
  {
    id: "ar-sa",
    languageCode: "ar",
    language: "Arabic",
    variantLabel: "Arabic (Modern Standard)",
    promptInstruction: "Use Modern Standard Arabic.",
    kind: "builtin",
    aliases: ["ar-SA"],
    regionCode: "SA",
  },
  {
    id: "ru-ru",
    languageCode: "ru",
    language: "Russian",
    variantLabel: "Russian (Russia)",
    promptInstruction: "Use standard Russian as commonly written in Russia.",
    kind: "builtin",
    aliases: ["ru-RU"],
    regionCode: "RU",
  },
];

const BUILTIN_LANGUAGE_ORDER = ["en", "zh", "es", "fr", "pt", "de", "it", "ja", "ko", "ar", "ru"];

const BUILTIN_DEFAULT_VARIANT_IDS: Record<string, string> = {
  en: "en-us",
  zh: "zh-hant-tw",
  es: "es-mx",
  fr: "fr-fr",
  pt: "pt-pt",
  de: "de-de",
  it: "it-it",
  ja: "ja-jp",
  ko: "ko-kr",
  ar: "ar-sa",
  ru: "ru-ru",
};

const DEFAULT_LANGUAGE_VARIANT_PREFERENCES: PreferredLanguage = Object.freeze(
  BUILTIN_LANGUAGE_ORDER.reduce<PreferredLanguage>((accumulator, languageCode) => {
    accumulator[languageCode] = BUILTIN_DEFAULT_VARIANT_IDS[languageCode];
    return accumulator;
  }, {})
);

const BUILTIN_VARIANT_ALIAS_MAP = new Map(
  BUILTIN_LANGUAGE_VARIANTS.flatMap((variant) => {
    const aliases = variant.aliases ?? [];
    return [
      [variant.id.toLowerCase(), variant.id] as const,
      ...aliases.map((alias) => [alias.toLowerCase(), variant.id] as const),
    ];
  })
);

const BUILTIN_LANGUAGE_NAME_MAP = new Map(
  BUILTIN_LANGUAGE_VARIANTS.map((variant) => [variant.languageCode, variant.language])
);

const BUILTIN_LANGUAGE_ALIASES: Record<string, string[]> = {
  en: ["English", "英文", "英語", "英语", "英式英文", "美式英文"],
  zh: ["Chinese", "中文", "漢語", "汉语", "華語", "华语", "繁體中文", "繁体中文", "簡體中文", "简体中文"],
  es: ["Spanish", "Español", "西班牙語", "西班牙文", "西班牙语"],
  fr: ["French", "Français", "法語", "法文", "法语"],
  pt: ["Portuguese", "Português", "葡萄牙語", "葡萄牙文", "葡萄牙语"],
  de: ["German", "Deutsch", "德語", "德文", "德语"],
  it: ["Italian", "Italiano", "義大利語", "義大利文", "意大利語", "意大利文", "意大利语"],
  ja: ["Japanese", "日本語", "日語", "日文", "日语"],
  ko: ["Korean", "한국어", "韓語", "韓文", "韩语", "韩文"],
  ar: ["Arabic", "العربية", "阿拉伯語", "阿拉伯文", "阿拉伯语"],
  ru: ["Russian", "Русский", "俄語", "俄文", "俄语"],
};

const LEGACY_LANGUAGE_CODE_MAP = new Map(
  [
    ...BUILTIN_LANGUAGE_VARIANTS.flatMap((variant) => {
      const keys = [
        variant.languageCode,
        variant.languageCode.toUpperCase(),
        variant.language.toLowerCase(),
        variant.language,
        ...(variant.aliases ?? []),
      ];
      return keys.map((key) => [key.toLowerCase(), variant.languageCode] as const);
    }),
    ...Object.entries(BUILTIN_LANGUAGE_ALIASES).flatMap(([languageCode, aliases]) =>
      aliases.map((alias) => [alias.toLowerCase(), languageCode] as const)
    ),
  ]
);

const sanitizeVariantText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const slugifyLanguageCode = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  const asciiSlug = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (asciiSlug) {
    return asciiSlug;
  }
  const encodedSlug = encodeURIComponent(trimmed)
    .replace(/%/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
  return encodedSlug ? `lang-${encodedSlug}` : "custom-language";
};

const normalizeLanguageCode = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const lower = trimmed.toLowerCase();
  if (LEGACY_LANGUAGE_CODE_MAP.has(lower)) {
    return LEGACY_LANGUAGE_CODE_MAP.get(lower)!;
  }
  if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})+$/i.test(trimmed)) {
    return trimmed.split("-")[0].toLowerCase();
  }
  return slugifyLanguageCode(trimmed);
};

const getAllVariantMaps = (customVariants: CustomLanguageVariant[]) => {
  const normalizedCustomVariants = normalizeCustomLanguageVariants(customVariants);
  const allVariants = [
    ...BUILTIN_LANGUAGE_VARIANTS,
    ...normalizedCustomVariants.map((variant) => ({
      ...variant,
      kind: "custom" as const,
    })),
  ];

  const variantMap = new Map(allVariants.map((variant) => [variant.id, variant]));
  const aliasMap = new Map(BUILTIN_VARIANT_ALIAS_MAP);

  for (const customVariant of normalizedCustomVariants) {
    aliasMap.set(customVariant.id.toLowerCase(), customVariant.id);
  }

  return {
    allVariants,
    aliasMap,
    variantMap,
  };
};

const resolveVariantId = (
  rawSelection: string,
  customVariants: CustomLanguageVariant[]
) => {
  const selection = sanitizeVariantText(rawSelection);
  if (!selection || selection.toLowerCase() === AUTO_LANGUAGE_VARIANT) {
    return "";
  }
  const { aliasMap, variantMap } = getAllVariantMaps(customVariants);
  const normalizedSelection = aliasMap.get(selection.toLowerCase()) ?? selection;
  return variantMap.has(normalizedSelection) ? normalizedSelection : "";
};

const resolveVariantFromSelection = (
  rawSelection: string,
  customVariants: CustomLanguageVariant[]
) => {
  const variantId = resolveVariantId(rawSelection, customVariants);
  if (!variantId) {
    return null;
  }
  return getAllVariantMaps(customVariants).variantMap.get(variantId) ?? null;
};

const normalizePreferencesObject = (
  value: unknown,
  customVariants: CustomLanguageVariant[],
  mode: "global" | "profile"
): PreferredLanguage => {
  const nextPreferences: PreferredLanguage =
    mode === "global" ? { ...DEFAULT_LANGUAGE_VARIANT_PREFERENCES } : {};

  if (typeof value === "string") {
    const legacyVariant = resolveVariantFromSelection(value, customVariants);
    if (legacyVariant) {
      nextPreferences[legacyVariant.languageCode] = legacyVariant.id;
    }
    return nextPreferences;
  }

  if (!isPlainObject(value)) {
    return nextPreferences;
  }

  for (const [rawLanguageCode, rawSelection] of Object.entries(value)) {
    const variant = resolveVariantFromSelection(String(rawSelection ?? ""), customVariants);
    if (!variant) {
      continue;
    }
    const normalizedLanguageCode = normalizeLanguageCode(rawLanguageCode) || variant.languageCode;
    nextPreferences[normalizedLanguageCode] = variant.id;
  }

  return nextPreferences;
};

export const createCustomLanguageVariantId = () =>
  `custom-language-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const getDefaultLanguageVariantPreferences = () => ({
  ...DEFAULT_LANGUAGE_VARIANT_PREFERENCES,
});

export const normalizeCustomLanguageVariants = (variants: unknown): CustomLanguageVariant[] => {
  if (!Array.isArray(variants)) {
    return [];
  }

  const seenIds = new Set<string>();
  const normalized: CustomLanguageVariant[] = [];

  for (const entry of variants) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Partial<CustomLanguageVariant>;
    const id = sanitizeVariantText(record.id);
    const language = sanitizeVariantText(record.language);
    const variantLabel = sanitizeVariantText(record.variantLabel);
    const promptInstruction = sanitizeVariantText(record.promptInstruction);
    const languageCode = normalizeLanguageCode(
      sanitizeVariantText(record.languageCode) || language
    );

    if (!id || !language || !languageCode || !variantLabel || !promptInstruction || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    normalized.push({
      id,
      languageCode,
      language,
      variantLabel,
      promptInstruction,
    });
  }

  return normalized.sort((left, right) => {
    if (left.languageCode !== right.languageCode) {
      return left.languageCode.localeCompare(right.languageCode);
    }
    return left.variantLabel.localeCompare(right.variantLabel);
  });
};

export const normalizePreferredLanguageSelection = (
  value: unknown,
  customVariants: CustomLanguageVariant[] = []
): PreferredLanguage => normalizePreferencesObject(value, customVariants, "global");

export const normalizeProfilePreferredLanguageSelection = (
  value: unknown,
  customVariants: CustomLanguageVariant[] = []
): PreferredLanguage | "" => {
  if (typeof value === "string" && !value.trim()) {
    return "";
  }
  const normalized = normalizePreferencesObject(value, customVariants, "profile");
  return Object.keys(normalized).length > 0 ? normalized : "";
};

export const mergeLanguageVariantPreferences = (
  globalPreferences: PreferredLanguage,
  profilePreferences: PreferredLanguage | "",
  customVariants: CustomLanguageVariant[] = []
) => {
  const normalizedGlobal = normalizePreferredLanguageSelection(globalPreferences, customVariants);
  if (!profilePreferences || Object.keys(profilePreferences).length === 0) {
    return normalizedGlobal;
  }
  return {
    ...normalizedGlobal,
    ...normalizeProfilePreferredLanguageSelection(profilePreferences, customVariants),
  };
};

export const diffLanguageVariantPreferences = (
  basePreferences: PreferredLanguage,
  nextPreferences: PreferredLanguage,
  customVariants: CustomLanguageVariant[] = []
) => {
  const normalizedBase = normalizePreferredLanguageSelection(basePreferences, customVariants);
  const normalizedNext = normalizePreferredLanguageSelection(nextPreferences, customVariants);
  const diff: PreferredLanguage = {};

  for (const [languageCode, variantId] of Object.entries(normalizedNext)) {
    if (normalizedBase[languageCode] !== variantId) {
      diff[languageCode] = variantId;
    }
  }

  return diff;
};

const getAllLanguageVariants = (customVariants: CustomLanguageVariant[]) =>
  getAllVariantMaps(customVariants).allVariants;

const findLanguageVariant = (
  selection: string,
  customVariants: CustomLanguageVariant[]
): LanguageVariantDefinition | null =>
  resolveVariantFromSelection(selection, customVariants);

const getIntlDisplayName = (
  uiLocale: string | undefined,
  type: "language" | "region" | "script",
  code: string
) => {
  try {
    return new Intl.DisplayNames(
      uiLocale ? [uiLocale] : undefined,
      { type }
    ).of(code) ?? "";
  } catch {
    return "";
  }
};

const getLanguageDisplayLabel = (
  languageCode: string,
  fallbackLanguage: string,
  uiLocale?: string
) =>
  getIntlDisplayName(uiLocale, "language", languageCode) || fallbackLanguage;

export const getLanguageVariantOptionLabel = (
  variant: LanguageVariantDefinition,
  uiLocale?: string
) => {
  if (variant.kind === "custom") {
    return variant.variantLabel;
  }

  const languageLabel = getLanguageDisplayLabel(
    variant.languageCode,
    variant.language,
    uiLocale
  );
  const regionLabel = variant.regionCode
    ? getIntlDisplayName(uiLocale, "region", variant.regionCode)
    : "";
  const scriptLabel = variant.scriptCode
    ? getIntlDisplayName(uiLocale, "script", variant.scriptCode)
    : "";

  if (variant.languageCode === "zh" && scriptLabel && regionLabel) {
    if (uiLocale?.toLowerCase().startsWith("zh")) {
      return `${scriptLabel}${languageLabel}（${regionLabel}）`;
    }
    return `${scriptLabel} ${languageLabel} (${regionLabel})`;
  }

  if (regionLabel) {
    return `${languageLabel} (${regionLabel})`;
  }
  if (scriptLabel) {
    return `${languageLabel} (${scriptLabel})`;
  }
  return variant.variantLabel;
};

export const getLanguageVariantSelectionForLanguage = (
  preferences: PreferredLanguage,
  languageCode: string,
  customVariants: CustomLanguageVariant[]
) => {
  const normalizedPreferences = normalizePreferredLanguageSelection(preferences, customVariants);
  const normalizedLanguageCode = normalizeLanguageCode(languageCode);
  const firstVariantForLanguage = getAllLanguageVariants(customVariants).find(
    (variant) => variant.languageCode === normalizedLanguageCode
  );
  return (
    normalizedPreferences[normalizedLanguageCode] ??
    BUILTIN_DEFAULT_VARIANT_IDS[normalizedLanguageCode] ??
    firstVariantForLanguage?.id ??
    ""
  );
};

export const getLanguageVariantGroups = (
  customVariants: CustomLanguageVariant[],
  uiLocale?: string
): LanguageVariantGroup[] => {
  const groups = new Map<string, LanguageVariantDefinition[]>();

  for (const variant of getAllLanguageVariants(customVariants)) {
    const variants = groups.get(variant.languageCode) ?? [];
    variants.push(variant);
    groups.set(variant.languageCode, variants);
  }

  const customLanguageCodes = Array.from(groups.keys()).filter(
    (languageCode) => !BUILTIN_DEFAULT_VARIANT_IDS[languageCode]
  );

  const orderedLanguageCodes = [
    ...BUILTIN_LANGUAGE_ORDER.filter((languageCode) => groups.has(languageCode)),
    ...customLanguageCodes.sort((left, right) => {
      const leftLabel = groups.get(left)?.[0]?.language ?? left;
      const rightLabel = groups.get(right)?.[0]?.language ?? right;
      return leftLabel.localeCompare(rightLabel);
    }),
  ];

  return orderedLanguageCodes.map((languageCode) => {
    const variants = (groups.get(languageCode) ?? []).slice().sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "builtin" ? -1 : 1;
      }
      return getLanguageVariantOptionLabel(left, uiLocale).localeCompare(
        getLanguageVariantOptionLabel(right, uiLocale)
      );
    });

    const fallbackLanguage = variants[0]?.language ?? BUILTIN_LANGUAGE_NAME_MAP.get(languageCode) ?? languageCode;

    return {
      languageCode,
      languageLabel: getLanguageDisplayLabel(languageCode, fallbackLanguage, uiLocale),
      defaultVariantId:
        BUILTIN_DEFAULT_VARIANT_IDS[languageCode] ??
        variants[0]?.id ??
        "",
      variants,
    };
  });
};

const buildLanguageVariantPreferencePrompt = (
  preferences: PreferredLanguage,
  customVariants: CustomLanguageVariant[]
) => {
  const normalizedPreferences = normalizePreferredLanguageSelection(preferences, customVariants);
  const lines = BUILTIN_LANGUAGE_ORDER
    .concat(
      Object.keys(normalizedPreferences).filter(
        (languageCode) => !BUILTIN_LANGUAGE_ORDER.includes(languageCode)
      )
    )
    .filter((languageCode, index, array) => array.indexOf(languageCode) === index)
    .map((languageCode) => {
      const variantId = normalizedPreferences[languageCode];
      if (!variantId) {
        return "";
      }
      const variant = findLanguageVariant(variantId, customVariants);
      if (!variant) {
        return "";
      }
      return `- ${variant.language}: ${variant.promptInstruction}`;
    })
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  return [
    "Apply these language-variant preferences whenever you respond in the relevant language:",
    ...lines,
  ].join("\n");
};

export const resolveLanguageVariantPromptInstruction = (
  selection: PreferredLanguage,
  customVariants: CustomLanguageVariant[]
) => buildLanguageVariantPreferencePrompt(selection, customVariants);

export const resolveLanguageVariantPromptInstructionForLanguage = (
  languageHint: string,
  preferences: PreferredLanguage,
  customVariants: CustomLanguageVariant[]
) => {
  const trimmedHint = sanitizeVariantText(languageHint);
  if (!trimmedHint || trimmedHint.toLowerCase() === AUTO_LANGUAGE_VARIANT) {
    return buildLanguageVariantPreferencePrompt(preferences, customVariants);
  }

  const normalizedPreferences = normalizePreferredLanguageSelection(preferences, customVariants);
  const directVariant = findLanguageVariant(trimmedHint, customVariants);
  if (directVariant) {
    return directVariant.promptInstruction;
  }

  const languageCode = normalizeLanguageCode(trimmedHint);
  const preferredVariantId = normalizedPreferences[languageCode];
  const preferredVariant = preferredVariantId
    ? findLanguageVariant(preferredVariantId, customVariants)
    : null;

  if (preferredVariant) {
    return preferredVariant.promptInstruction;
  }

  return trimmedHint;
};

const JAPANESE_SCRIPT_RE = /[\u3040-\u30ff]/;
const KOREAN_SCRIPT_RE = /[\uac00-\ud7af]/;
const ARABIC_SCRIPT_RE = /[\u0600-\u06ff]/;
const CYRILLIC_SCRIPT_RE = /[\u0400-\u04ff]/;
const HAN_SCRIPT_RE = /[\u3400-\u9fff]/;

const inferLanguageCodeFromText = (
  text: string,
  explicitLanguageHint = ""
) => {
  const normalizedExplicitHint = sanitizeVariantText(explicitLanguageHint);
  if (
    normalizedExplicitHint &&
    normalizedExplicitHint.toLowerCase() !== AUTO_LANGUAGE_VARIANT
  ) {
    const normalizedLanguageCode = normalizeLanguageCode(normalizedExplicitHint);
    if (normalizedLanguageCode) {
      return normalizedLanguageCode;
    }
  }

  const sample = sanitizeVariantText(text);
  if (!sample) {
    return "";
  }
  if (JAPANESE_SCRIPT_RE.test(sample)) {
    return "ja";
  }
  if (KOREAN_SCRIPT_RE.test(sample)) {
    return "ko";
  }
  if (ARABIC_SCRIPT_RE.test(sample)) {
    return "ar";
  }
  if (CYRILLIC_SCRIPT_RE.test(sample)) {
    return "ru";
  }
  if (HAN_SCRIPT_RE.test(sample)) {
    return "zh";
  }
  return "";
};

export const resolveLanguageVariantPromptInstructionForText = (
  text: string,
  preferences: PreferredLanguage,
  customVariants: CustomLanguageVariant[],
  explicitLanguageHint = ""
) => {
  const inferredLanguageCode = inferLanguageCodeFromText(text, explicitLanguageHint);
  if (inferredLanguageCode) {
    return resolveLanguageVariantPromptInstructionForLanguage(
      inferredLanguageCode,
      preferences,
      customVariants
    );
  }
  return buildLanguageVariantPreferencePrompt(preferences, customVariants);
};

export const getLanguageVariantSelectionSummary = (
  preferences: PreferredLanguage | "",
  customVariants: CustomLanguageVariant[],
  options: {
    emptyLabel: string;
    globalLabel?: string;
    countLabel?: (count: number) => string;
  }
) => {
  if (preferences === "") {
    return options.globalLabel ?? options.emptyLabel;
  }
  const normalized = normalizePreferredLanguageSelection(preferences, customVariants);
  const count = Object.keys(normalized).length;
  if (count === 0) {
    return options.emptyLabel;
  }
  if (options.countLabel) {
    return options.countLabel(count);
  }
  return `${count}`;
};
