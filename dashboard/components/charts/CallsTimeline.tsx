"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { date: string; calls: number; booked: number };

export default function CallsTimeline({ data }: { data: Point[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart
        data={data}
        margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
      >
        <defs>
          <linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.55} />
            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="bookedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity={0.55} />
            <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
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
          allowDecimals={false}
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
          itemStyle={{ color: "#f0f4ff" }}
        />
        <Area
          type="monotone"
          dataKey="calls"
          name="Calls"
          stroke="#22d3ee"
          strokeWidth={2}
          fill="url(#callsFill)"
        />
        <Area
          type="monotone"
          dataKey="booked"
          name="Booked"
          stroke="#34d399"
          strokeWidth={2}
          fill="url(#bookedFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
