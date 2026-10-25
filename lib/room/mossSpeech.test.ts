import { describe, expect, it } from "vitest";
import { cleanSpeechText, DEFAULT_ELEVENLABS_MODEL, DEFAULT_ELEVENLABS_VOICE, SPEECH_MAX_CHARS, speechRequest } from "./mossSpeech";

describe("Moss's ElevenLabs voice", () => {
  it("speaks one clean line and refuses empty or long text", () => {
    expect(cleanSpeechText("  This little island\n is yours. ")).toBe("This little island is yours.");
    expect(cleanSpeechText("   ")).toBeNull();
    expect(cleanSpeechText(42)).toBeNull();
    expect(cleanSpeechText("x".repeat(SPEECH_MAX_CHARS + 1))).toBeNull();
  });

  it("asks for Sarah on eleven_v4 by default, with only the settings v4 accepts", () => {
    const { voiceId, request } = speechRequest("Hi, I'm Moss.", {});
    expect(voiceId).toBe(DEFAULT_ELEVENLABS_VOICE);
    expect(request).toMatchObject({ text: "Hi, I'm Moss.", modelId: DEFAULT_ELEVENLABS_MODEL, outputFormat: "mp3_44100_64" });
    expect(Object.keys(request.voiceSettings).sort()).toEqual(["similarityBoost", "stability"]);
    expect(request.voiceSettings.stability).toBeLessThan(0.5);
  });

  it("uses a configured voice and model", () => {
    const { voiceId, request } = speechRequest("Hi", { voiceId: "voice-x", modelId: "eleven_flash_v2_5" });
    expect(voiceId).toBe("voice-x");
    expect(request.modelId).toBe("eleven_flash_v2_5");
  });
});
