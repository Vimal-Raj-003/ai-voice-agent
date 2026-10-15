"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { providerColor } from "@/lib/provider-colors";
import { type Currency, formatMoney } from "@/lib/currency";

type Row = { date: string } & Record<string, number | string>;

export default function CostStackedBar({
  data,
  providers,
  // Values are always USD; currency/fxRate convert for DISPLAY only. Omitted
  // by the Overview page, which stays in USD.
  currency = "USD",
  fxRate = null,
}: {
  data: Row[];
  providers: string[];
  currency?: Currency;
  fxRate?: number | null;
}) {
  const money = (v: number, d: number) => formatMoney(v, currency, fxRate, d);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
        <XAxis
          dataKey="date"
          stroke="var(--text-muted)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis
          stroke="var(--text-muted)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => money(v, 2)}
        />
        <Tooltip
          contentStyle={{
            background: "rgba(10, 12, 30, 0.92)",
            border: "1px solid rgba(167, 139, 250, 0.3)",
            borderRadius: 12,
            backdropFilter: "blur(8px)",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
          formatter={(value, name) => [money(Number(value), 4), String(name)]}
        />
        <Legend
          wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
          iconType="circle"
        />
        {providers.map((p) => (
          <Bar
            key={p}
            dataKey={p}
            name={p}
            stackId="a"
            fill={providerColor(p)}
            radius={[3, 3, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
