// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatMoneyShort } from "@/core/money";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface TrendPoint {
  month: string; // YYYY-MM-01
  netSales: number;
  grossProfit: number;
  netOperatingProfit: number;
}

export function TrendChart({ data, height = 260 }: { data: TrendPoint[]; height?: number }) {
  const rows = data.map((d) => ({ ...d, label: `${MONTHS[Number(d.month.slice(5, 7)) - 1]} ${d.month.slice(2, 4)}` }));
  return (
    <figure style={{ height }} className="w-full">
      <figcaption className="sr-only">Monthly sales, gross profit and net operating profit.</figcaption>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
          <YAxis tickFormatter={(v: number) => formatMoneyShort(v)} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={64} />
          <Tooltip formatter={(v) => formatMoney(Number(v))} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 13 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="netSales" name="Sales" fill="#94a3b8" radius={[4, 4, 0, 0]} />
          <Bar dataKey="grossProfit" name="Gross profit" fill="#0f766e" radius={[4, 4, 0, 0]} />
          <Bar dataKey="netOperatingProfit" name="Net operating profit" fill="#0f1b2d" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
