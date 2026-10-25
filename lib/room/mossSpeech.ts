/**
 * Moss's narration voice through ElevenLabs (D30). Pure helpers shared by the
 * server route and tests: which voice and model, how a line is cleaned, and the
 * request sent through the ElevenLabs SDK. Only the guide's own lines are spoken.
 */

/** "Sarah": a young, soft American female ElevenLabs default voice. Override with ELEVENLABS_VOICE_ID. */
export const DEFAULT_ELEVENLABS_VOICE = "EXAVITQu4vr4xnSDxMaL";
/**
 * ElevenLabs' default and most natural model for a single request. Override with
 * ELEVENLABS_MODEL_ID (eleven_flash_v2_5 is the fastest and cheapest).
 * eleven_v4_turbo is for their real-time WebSocket, not single requests.
 */
export const DEFAULT_ELEVENLABS_MODEL = "eleven_v4";
/** Longest line Moss will speak in one request; guide lines are much shorter. */
export const SPEECH_MAX_CHARS = 400;

/**
 * Warm rather than flat: a little below the default stability for more
 * expression, and close to the voice. Eleven v4 accepts only these two settings.
 */
export const MOSS_VOICE_SETTINGS = { stability: 0.42, similarityBoost: 0.8 } as const;

/** One line of plain speech, or null when there's nothing worth saying. */
export function cleanSpeechText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > SPEECH_MAX_CHARS) return null;
  return clean;
}

/** The SDK request for one line: `client.textToSpeech.convert(voiceId, request)`. */
export function speechRequest(text: string, cfg: { voiceId?: string; modelId?: string }) {
  return {
    voiceId: cfg.voiceId || DEFAULT_ELEVENLABS_VOICE,
    request: {
      text,
      modelId: cfg.modelId || DEFAULT_ELEVENLABS_MODEL,
      outputFormat: "mp3_44100_64" as const,
      voiceSettings: { ...MOSS_VOICE_SETTINGS },
    },
  };
}
