import type { AppError } from "@/lib/contracts";

export function ErrorText({ error }: { error: AppError | null | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-coral/10 px-3 py-2 text-[13px] text-[#8c3b2c]">
      {error.message}
    </p>
  );
}
