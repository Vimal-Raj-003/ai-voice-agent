// Mirror of voice-service/language_presets.py LANGUAGE_PRESETS — keep in sync
// when adding new languages on the agent side.

export const LANGUAGE_PRESETS = [
  { id: "hinglish", label: "Hinglish (default)" },
  { id: "hindi", label: "Hindi" },
  { id: "english", label: "English" },
  { id: "tamil", label: "Tamil" },
  { id: "telugu", label: "Telugu" },
  { id: "gujarati", label: "Gujarati" },
  { id: "bengali", label: "Bengali" },
  { id: "marathi", label: "Marathi" },
  { id: "kannada", label: "Kannada" },
  { id: "malayalam", label: "Malayalam" },
  { id: "multilingual", label: "Multilingual" },
] as const;

export type LanguagePresetId = (typeof LANGUAGE_PRESETS)[number]["id"];
