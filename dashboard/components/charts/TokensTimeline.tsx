"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { date: string; input: number; output: number };

const fmtTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

export default function TokensTimeline({ data }: { data: Point[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="tokInFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.55} />
            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="tokOutFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.55} />
            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
          </linearGradient>
        </defs>
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
          tickFormatter={fmtTokens}
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
          formatter={(v) => fmtTokens(Number(v))}
        />
        <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconType="circle" />
        <Area
          type="monotone"
          dataKey="input"
          name="Input tokens"
          stackId="1"
          stroke="#22d3ee"
          strokeWidth={2}
          fill="url(#tokInFill)"
        />
        <Area
          type="monotone"
          dataKey="output"
          name="Output tokens"
          stackId="1"
          stroke="#a78bfa"
          strokeWidth={2}
          fill="url(#tokOutFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
