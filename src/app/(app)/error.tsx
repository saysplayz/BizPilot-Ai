// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <CardBody className="py-10 text-center">
        <h1 className="text-lg font-semibold">This page could not load</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
          Your records are safe — nothing was changed. Check your connection and try again.
          {error.digest && <span className="mt-2 block text-xs">Reference: {error.digest}</span>}
        </p>
        <Button className="mt-4" onClick={reset}>
          <RefreshCw className="size-4" aria-hidden /> Try again
        </Button>
      </CardBody>
    </Card>
  );
}
