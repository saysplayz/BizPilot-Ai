// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate } from "@/core/dates";
import { formatMoney, formatMoneyShort } from "@/core/money";

export interface ForecastPoint {
  date: string;
  baseline: number;
  scenario?: number;
}

/**
 * Projected cash balance by day. Baseline in teal; a scenario (if any) as a
 * dashed navy line on the same axes so the difference is obvious. Zero and the
 * owner's reserve are drawn as reference lines.
 */
export function ForecastChart({
  data,
  reserve,
  height = 260,
  scenarioLabel = "With your change",
}: {
  data: ForecastPoint[];
  reserve?: number | null;
  height?: number;
  scenarioLabel?: string;
}) {
  const hasScenario = data.some((d) => d.scenario !== undefined);
  const values = data.flatMap((d) => [d.baseline, d.scenario ?? d.baseline, 0, reserve ?? 0]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.1, 10_000);

  return (
    <figure className="w-full" style={{ height }}>
      <figcaption className="sr-only">
        Projected cash from {data[0] ? formatDate(data[0].date) : ""} to {data.at(-1) ? formatDate(data.at(-1)!.date) : ""}. Lowest projected balance{" "}
        {formatMoney(Math.min(...data.map((d) => d.scenario ?? d.baseline)))}.
      </figcaption>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="baselineFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f766e" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => formatDate(d, { year: false })}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v: number) => formatMoneyShort(v)}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickLine={false}
            axisLine={false}
            width={64}
            domain={[Math.floor(min - pad), Math.ceil(max + pad)]}
          />
          <Tooltip
            formatter={(value, name) => [formatMoney(Number(value)), name === "baseline" ? "Current forecast" : scenarioLabel]}
            labelFormatter={(d) => formatDate(String(d), { weekday: true })}
            contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 13 }}
          />
          <ReferenceLine y={0} stroke="#b91c1c" strokeWidth={1} label={{ value: "GH₵0", position: "insideTopLeft", fontSize: 10, fill: "#b91c1c" }} />
          {reserve ? <ReferenceLine y={reserve} stroke="#b45309" strokeDasharray="4 4" label={{ value: "Reserve", position: "insideTopRight", fontSize: 10, fill: "#b45309" }} /> : null}
          <Area type="stepAfter" dataKey="baseline" name="baseline" stroke="#0f766e" strokeWidth={2} fill="url(#baselineFill)" isAnimationActive={false} />
          {hasScenario && <Line type="stepAfter" dataKey="scenario" name="scenario" stroke="#0f1b2d" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}
