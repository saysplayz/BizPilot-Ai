// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
