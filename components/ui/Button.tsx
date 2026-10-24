import type { ButtonHTMLAttributes } from "react";

const VARIANTS = {
  primary: "bg-plum text-ivory hover:bg-plum-soft",
  secondary: "border border-plum/20 bg-white/60 text-plum hover:border-plum/40",
  ghost: "text-plum-soft hover:text-plum hover:underline underline-offset-4",
  danger: "text-[#8c3b2c] hover:underline underline-offset-4",
} as const;

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }) {
  const shape = variant === "ghost" || variant === "danger" ? "px-1" : "rounded-full px-3 py-1.5";
  return (
    <button
      type={type}
      className={`${shape} text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}
