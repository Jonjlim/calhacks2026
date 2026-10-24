import qrcode from "qrcode-generator";
import type { QrModules } from "./mockQr";

/**
 * A scannable QR for a room's real invite URL, in the same module-grid shape
 * as the decorative mock, so any QR renderer can show either. Only ever
 * encode an invite link the server issued (rooms.getInvite); never a guessed
 * or demo URL.
 */
export function inviteQrModules(url: string): QrModules {
  // Type 0 picks the smallest version that fits; M keeps it readable from across a room.
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
