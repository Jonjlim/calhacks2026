/**
 * Moss's narration voice through ElevenLabs (D30). Pure helpers shared by the
 * server route and tests: which voice and model, how a line is cleaned, and the
 * exact request sent. Only the guide's own lines are ever spoken.
 */

/** "Sarah": a young, soft American female ElevenLabs default voice. Override with ELEVENLABS_VOICE_ID. */
export const DEFAULT_ELEVENLABS_VOICE = "EXAVITQu4vr4xnSDxMaL";
/** Expressive and real-time (about 100 ms). Override with ELEVENLABS_MODEL_ID, e.g. eleven_flash_v2_5 for the cheapest. */
export const DEFAULT_ELEVENLABS_MODEL = "eleven_v4_turbo";
/** Longest line Moss will speak in one request; guide lines are much shorter. */
export const SPEECH_MAX_CHARS = 400;

/** Warm and natural rather than flat: a little variation, close to the voice, a touch of style. */
export const MOSS_VOICE_SETTINGS = { stability: 0.42, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true, speed: 1.0 } as const;

/** One line of plain speech, or null when there's nothing worth saying. */
export function cleanSpeechText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > SPEECH_MAX_CHARS) return null;
  return clean;
}

export function speechRequest(text: string, cfg: { apiKey: string; voiceId?: string; modelId?: string }): { url: string; init: RequestInit } {
  const voice = encodeURIComponent(cfg.voiceId || DEFAULT_ELEVENLABS_VOICE);
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`,
    init: {
      method: "POST",
      headers: { "xi-api-key": cfg.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: cfg.modelId || DEFAULT_ELEVENLABS_MODEL, voice_settings: MOSS_VOICE_SETTINGS }),
    },
  };
}
