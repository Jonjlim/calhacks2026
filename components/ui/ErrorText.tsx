import type { AppError } from "@/lib/contracts";

export function ErrorText({ error, onDismiss }: { error: AppError | null | undefined; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg bg-coral/10 px-3 py-2 text-[13px] text-[#8c3b2c]">
      <span className="flex-1">{error.message}</span>
      {onDismiss && (
        <button type="button" aria-label="Dismiss" className="-mr-1 shrink-0 px-1 text-[15px] leading-none opacity-70 hover:opacity-100" onClick={onDismiss}>×</button>
      )}
    </p>
  );
}
