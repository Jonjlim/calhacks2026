"use client";

import { ConvexHttpClient } from "convex/browser";
import { useEffect, useRef, useState } from "react";
import { deviceApi } from "@/gift-twin/src/api";
import { normalizePairingCode, splitIntoUploadBatches, type DeviceSession, type VaultMessage } from "@/lib/agentCollaborators/contracts";
import { planUpload } from "@/gift-twin/src/upload";
import { sampleChat } from "@/lib/agentCollaborators/fixture";
import type { Result } from "@/lib/contracts";

const TOKEN_KEY = "unwrap.twin.device";
const INVITE_KEY = "unwrap.twin.invite";
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function RecipientTwin() {
  const [client] = useState(() => process.env.NEXT_PUBLIC_CONVEX_URL ? new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL) : null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [invite, setInvite] = useState("");
  const [token, setToken] = useState("");
  const [session, setSession] = useState<DeviceSession | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<string | null>("Opening your invitation…");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    async function restore() {
      try {
        const code = new URLSearchParams(window.location.hash.slice(1)).get("invite");
        if (code) {
          sessionStorage.setItem(INVITE_KEY, normalizePairingCode(code));
          history.replaceState(null, "", window.location.pathname);
        }
        setInvite(sessionStorage.getItem(INVITE_KEY) ?? "");
        const saved = sessionStorage.getItem(TOKEN_KEY);
        if (saved && client) {
          const res = await client.query(deviceApi.session, { deviceToken: saved });
          if (res.ok) { setToken(saved); setSession(res.value); }
          else sessionStorage.removeItem(TOKEN_KEY);
        }
      } catch { setError("Could not restore this session. Enable session storage and reload, or reopen your invitation."); }
      finally { setBusy(null); }
    }
    void restore();
  }, [client]);

  useEffect(() => {
    if (!token || !client) return;
    let active = true;
    const timer = setInterval(() => {
      void client.query(deviceApi.session, { deviceToken: token }).then((res) => {
        if (!active) return;
        if (res.ok) setSession(res.value);
        else { setSession(null); setToken(""); setError(res.error.message); }
      }).catch(() => { if (active) setError("Status could not refresh. Check your connection; the vault may still be active."); });
    }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [client, token]);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label); setError(""); setNotice("");
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong. Try again."); }
    finally { setBusy(null); }
  }

  async function connect() {
    if (!accepted || !client) return;
    await run("Connecting your twin…", async () => {
      // Save before sending: if the response is lost, reload can recover the binding.
      const saved = sessionStorage.getItem(TOKEN_KEY);
      if (saved) {
        const existing = await client.query(deviceApi.session, { deviceToken: saved });
        if (existing.ok) { setToken(saved); setSession(existing.value); return; }
      }
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      sessionStorage.setItem(TOKEN_KEY, secret);
      const connected = value(await client.mutation(deviceApi.pair, { pairingCode: invite, deviceToken: secret, deviceLabel: "Recipient browser" }));
      setToken(secret); setSession(connected);
      sessionStorage.removeItem(INVITE_KEY); setInvite("");
    });
  }

  async function selectFile(file: File) {
    if (!accepted) return;
    await run("Reading and uploading your recent messages…", async () => {
      const { DATABASE_MAX_BYTES, loadBrowserSqlite, readBrowserMessages } = await import("@/lib/agentCollaborators/browserMessages");
      if (file.size > DATABASE_MAX_BYTES) throw new Error("This database is larger than the browser's 512 MB limit. Use the Mac companion for this history.");
      const SQL = await loadBrowserSqlite();
      let read: ReturnType<typeof readBrowserMessages>;
      try { read = readBrowserMessages(SQL, new Uint8Array(await file.arrayBuffer())); }
      catch { throw new Error("Could not read this Messages database. Select chat.db from your Mac's Messages folder. A protected or incomplete copy may not work."); }
      if (!read.messages.length) {
        setNotice("No sent messages were found in the latest 1 MB. Nothing was uploaded. Recent messages may still be in Messages' separate journal file; try the Mac companion if needed.");
        return;
      }
      await upload(read.messages);
    });
  }

  async function upload(messages: VaultMessage[], sample = false) {
    if (!client || !token || !accepted || !messages.length) return;
    const started = value(await client.mutation(deviceApi.startUpload, { deviceToken: token, consent: true }));
    try {
      for (const batch of splitIntoUploadBatches(messages)) {
        value(await client.mutation(deviceApi.uploadMessages, { deviceToken: token, uploadId: started.uploadId, messages: batch }));
      }
      value(await client.mutation(deviceApi.finishUpload, { deviceToken: token, uploadId: started.uploadId }));
    } catch {
      throw new Error("The upload did not finish reliably. Some messages may be in the vault. Use Delete uploaded messages now, or choose the file again to replace that attempt. Messages still expire after 24 hours.");
    }
    setSession(value(await client.query(deviceApi.session, { deviceToken: token })));
    setNotice(`${sample ? "Sample data uploaded. " : "Upload received. "}Your twin is processing it; this does not mean its notes are ready yet.`);
  }

  async function manage(disconnect: boolean) {
    if (!client || !token) return;
    await run(disconnect ? "Disconnecting…" : "Deleting uploaded messages…", async () => {
      value(await client.mutation(disconnect ? deviceApi.disconnect : deviceApi.forget, { deviceToken: token }));
      if (disconnect) {
        sessionStorage.removeItem(TOKEN_KEY); setToken(""); setSession(null); setAccepted(false);
        setNotice("Disconnected and deleted the vault. Notes already shared with the room remain.");
      } else {
        setSession(value(await client.query(deviceApi.session, { deviceToken: token })));
        setNotice("Uploaded messages deleted. Notes already shared with the room remain.");
      }
    });
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-5 py-12 text-dusk">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-dusk/60">Unwrap · A gift of knowing you</p>
        <h1 className="mt-3 font-display text-4xl">{session ? `${session.recipientDisplayName}'s Gift Twin` : "Meet your Gift Twin"}</h1>
        <p className="mt-3 text-dusk/75">An AI companion that helps your friends choose a thoughtful gift, using only what you choose to share.</p>
      </header>
      <section className="paper-card space-y-4 rounded-[22px] p-6" aria-labelledby="privacy-title">
        <h2 id="privacy-title" className="font-display text-2xl">Before you share</h2>
        <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed">
          <li>You choose a Messages database from your own Mac. It is read in this browser; the database file is never uploaded. The latest 1 MB of message content is read, just like the Mac companion; only sent message text and send times are uploaded. Incoming messages, contact tables and attachments are excluded.</li>
          <li>Your recent sent text is uploaded to Unwrap's private server vault and processed by its configured AI model provider. Sent text can still contain secrets or information about other people. Selecting the database after accepting these terms immediately uploads your recent sent messages. There is no additional message review before upload. Emojis are removed on the server before storage; emoji-only messages are skipped.</li>
          <li>Your twin automatically shares screened gift insights and advisory votes with the gift room for up to 24 hours. AI can make mistakes or reveal preferences you would rather keep private. You do not approve each note before it appears.</li>
          <li>Uploaded messages are deleted after 24 hours, when you delete them here, or when the twin disconnects. Notes already shared in the room remain. Closing this tab does not delete the vault.</li>
          <li>This is a hackathon prototype, not end-to-end encrypted. Only use your own data. Keep this tab open for deletion controls; closing it loses this tab's access. The invitation is single-use and expires in 15 minutes.</li>
        </ul>
        <label className="flex items-start gap-3 rounded-xl bg-white/60 p-4 text-sm">
          <input type="checkbox" checked={accepted} disabled={!!busy} onChange={(event) => setAccepted(event.target.checked)} className="mt-1 size-4 shrink-0" />
          <span>I am the recipient. I have read these privacy terms and warnings, and agree to this one-time processing and automatic sharing of screened insights and votes.</span>
        </label>
        {!session && <div className="flex flex-wrap gap-3">
          <button className="btn-primary" disabled={!client || !invite || !accepted || !!busy} onClick={() => void connect()}>Accept and connect my twin</button>
          <button className="btn-secondary" disabled={!!busy} onClick={() => { setAccepted(false); setInvite(""); sessionStorage.removeItem(INVITE_KEY); setNotice("Invitation declined. No Messages data was read or uploaded."); }}>Decline</button>
        </div>}
      </section>
      {!client && <p role="alert">Gift Twin is unavailable: this site needs a Convex deployment.</p>}
      {!session && !invite && !busy && <p className="text-sm text-dusk/70">Open the invitation your friends created in their room's Gift Twin area. If it has expired, ask them for a new link.</p>}
      {session && <>
        <section className="paper-card space-y-4 rounded-[22px] p-6">
          <h2 className="font-display text-2xl">Share your recent messages</h2>
          <p className="text-sm">On your Mac, choose a file and press <kbd>⌘⇧G</kbd>, then enter <code>~/Library/Messages</code> and select <code>chat.db</code>. This site cannot open iMessage automatically. macOS may block file selection; do not weaken privacy settings unless you understand the access you grant. iPhone and iPad cannot select this Mac database.</p>
          <input ref={fileInput} type="file" accept=".db" disabled={!accepted || !!busy} className="hidden" aria-label="Messages database file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void selectFile(file); }} />
          <button type="button" className="btn-primary" disabled={!accepted || !!busy} onClick={() => fileInput.current?.click()}>Choose Messages file</button>
          <p className="text-sm">Choosing the file starts a one-time upload to your private 24-hour vault. This replaces any previous upload. Your twin interprets the messages in the cloud after upload, using the same pipeline as the CLI.</p>
          <button className="btn-secondary" disabled={!accepted || !!busy} onClick={() => void run("Uploading sample data…", async () => {
            const sample = sampleChat().map((message, index) => ({ ...message, id: index + 1, chatId: 0 }));
            await upload(planUpload(sample).messages, true);
          })}>Upload sample data instead</button>
        </section>
        <section className="paper-card space-y-3 rounded-[22px] p-6">
          <h2 className="font-display text-2xl">Your twin's status</h2>
          <p role="status">{!session.vault ? "Connected. No messages uploaded." : session.vault.status === "expired" ? "Vault closed. Uploaded messages deleted." : session.vault.status === "uploading" ? `Upload incomplete or in progress · ${session.vault.messageCount} messages received.` : session.vault.status === "processing" ? `Processing ${session.vault.messageCount} messages. Notes are not confirmed ready yet.` : `Twin active · ${session.vault.messageCount} messages · considering gift ideas.`}</p>
          {session.vault?.expiresAt && session.vault.status !== "expired" && <p className="text-sm">Vault expires: {new Date(session.vault.expiresAt).toLocaleString()}</p>}
          <div className="flex flex-wrap gap-3"><button className="btn-secondary" disabled={!!busy} onClick={() => void manage(false)}>Delete uploaded messages now</button><button className="text-sm underline" disabled={!!busy} onClick={() => void manage(true)}>Disconnect and delete vault</button></div>
        </section>
      </>}
      {busy && <p role="status">{busy}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-white/70 p-4 text-sm">{notice}</p>}
    </main>
  );
}
