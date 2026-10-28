// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button variant="secondary" className="no-print" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> Print
    </Button>
  );
}
