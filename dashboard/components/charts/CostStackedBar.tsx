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

type Row = { date: string } & Record<string, number | string>;

export default function CostStackedBar({
  data,
  providers,
}: {
  data: Row[];
  providers: string[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="date"
          stroke="rgba(255,255,255,0.4)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis
          stroke="rgba(255,255,255,0.4)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
        />
        <Tooltip
          contentStyle={{
            background: "rgba(10, 12, 30, 0.92)",
            border: "1px solid rgba(167, 139, 250, 0.3)",
            borderRadius: 12,
            backdropFilter: "blur(8px)",
            fontSize: 12,
          }}
          labelStyle={{ color: "#a78bfa", fontWeight: 600 }}
          formatter={(value, name) => [`$${Number(value).toFixed(4)}`, String(name)]}
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
