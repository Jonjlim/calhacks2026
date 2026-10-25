import { describe, expect, it } from "vitest";
import { cleanSpeechText, DEFAULT_ELEVENLABS_MODEL, DEFAULT_ELEVENLABS_VOICE, SPEECH_MAX_CHARS, speechRequest } from "./mossSpeech";

describe("Moss's ElevenLabs voice", () => {
  it("speaks one clean line and refuses empty or long text", () => {
    expect(cleanSpeechText("  This little island\n is yours. ")).toBe("This little island is yours.");
    expect(cleanSpeechText("   ")).toBeNull();
    expect(cleanSpeechText(42)).toBeNull();
    expect(cleanSpeechText("x".repeat(SPEECH_MAX_CHARS + 1))).toBeNull();
  });

  it("asks ElevenLabs for Sarah on the expressive turbo model by default, key in a header only", () => {
    const { url, init } = speechRequest("Hi, I'm Moss.", { apiKey: "secret-key" });
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_ELEVENLABS_VOICE}?output_format=mp3_44100_64`);
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("secret-key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ text: "Hi, I'm Moss.", model_id: DEFAULT_ELEVENLABS_MODEL });
    expect(body.voice_settings.stability).toBeLessThan(0.5);
  });

  it("uses a configured voice and model", () => {
    const { url, init } = speechRequest("Hi", { apiKey: "k", voiceId: "voice/x", modelId: "eleven_flash_v2_5" });
    expect(url).toContain("/text-to-speech/voice%2Fx?");
    expect(JSON.parse(init.body as string).model_id).toBe("eleven_flash_v2_5");
  });
});
