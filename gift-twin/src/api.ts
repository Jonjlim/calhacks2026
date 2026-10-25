/**
 * Typed references to the Convex device functions. Kept independent of
 * convex/_generated so the companion can ship as its own package later.
 * Names must match convex/giftTwin/device.ts.
 */
import { makeFunctionReference } from "convex/server";
import type { Result } from "../../lib/contracts/index.ts";
import type { DeviceSession, UploadFinished, UploadStarted, VaultMessage } from "../../lib/agentCollaborators/contracts.ts";

type Token = { deviceToken: string };

export const deviceApi = {
  pair: makeFunctionReference<"mutation", { pairingCode: string; deviceToken: string; deviceLabel?: string }, Result<DeviceSession>>(
    "giftTwin/device:pair",
  ),
  session: makeFunctionReference<"query", Token, Result<DeviceSession>>("giftTwin/device:session"),
  startUpload: makeFunctionReference<"mutation", Token & { consent: boolean }, Result<UploadStarted>>("giftTwin/device:startUpload"),
  uploadMessages: makeFunctionReference<"mutation", Token & { uploadId: string; messages: VaultMessage[] }, Result<{ messageCount: number }>>(
    "giftTwin/device:uploadMessages",
  ),
  finishUpload: makeFunctionReference<"mutation", Token & { uploadId: string }, Result<UploadFinished>>("giftTwin/device:finishUpload"),
  forget: makeFunctionReference<"mutation", Token, Result<null>>("giftTwin/device:forget"),
  disconnect: makeFunctionReference<"mutation", Token, Result<null>>("giftTwin/device:disconnect"),
};
