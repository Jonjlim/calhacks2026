import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

/**
 * The project's one ElevenLabs client (D30), for server code only: the SDK reads
 * ELEVENLABS_API_KEY from the environment (.env.local locally); the key is
 * never passed in code and never reaches the browser. Null when no key is set.
 */
let client: ElevenLabsClient | null = null;

export function elevenLabs(): ElevenLabsClient | null {
  if (!process.env.ELEVENLABS_API_KEY) return null;
  client ??= new ElevenLabsClient();
  return client;
}
