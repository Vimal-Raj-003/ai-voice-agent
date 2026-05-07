"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type Slice = { name: string; value: number };

const palette = [
  "#34d399", // emerald — BOOKED
  "#22d3ee", // cyan — COMPLETED
  "#a78bfa", // violet — TRANSFERRED / CALLBACK
  "#f59e0b", // amber — NO_ANSWER / VOICEMAIL
  "#f472b6", // pink — NOT_INTERESTED / WRONG_NUMBER
  "#ef4444", // red — FAILED
  "#71717a", // gray — UNKNOWN
];

export default function OutcomeDonut({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <defs>
            {palette.map((c, i) => (
              <linearGradient
                key={c}
                id={`donut-${i}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={c} stopOpacity={0.95} />
                <stop offset="100%" stopColor={c} stopOpacity={0.7} />
              </linearGradient>
            ))}
          </defs>
          <Pie
            data={data}
            innerRadius={60}
            outerRadius={90}
            paddingAngle={3}
            dataKey="value"
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={`url(#donut-${i % palette.length})`} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "rgba(10, 12, 30, 0.92)",
              border: "1px solid rgba(167, 139, 250, 0.3)",
              borderRadius: 12,
              fontSize: 12,
            }}
            labelStyle={{ color: "#a78bfa" }}
            itemStyle={{ color: "#f0f4ff" }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-2xl font-bold text-gradient">{total}</div>
        <div className="text-[10px] uppercase tracking-widest text-gray-500">
          calls
        </div>
      </div>
    </div>
  );
}
