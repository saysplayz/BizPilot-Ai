// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { cn } from "./cn";

/**
 * Button class names. Kept in a plain module (no "use client") so both Server
 * and Client Components can call buttonClass() — e.g. to style a <Link>.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap";
const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong shadow-sm",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-canvas",
  ghost: "text-ink-soft hover:bg-canvas hover:text-ink",
  danger: "bg-danger text-white hover:bg-red-800",
};
const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}
