"use client";

import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
} from "recharts";

export default function BookingGauge({ pct }: { pct: number }) {
  const data = [{ name: "rate", value: Math.max(0, Math.min(100, pct)) }];
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <RadialBarChart
          innerRadius="70%"
          outerRadius="100%"
          data={data}
          startAngle={210}
          endAngle={-30}
        >
          <defs>
            <linearGradient id="gaugeFill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="50%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#f472b6" />
            </linearGradient>
          </defs>
          <PolarAngleAxis
            type="number"
            domain={[0, 100]}
            angleAxisId={0}
            tick={false}
          />
          <RadialBar
            background={{ fill: "rgba(255,255,255,0.05)" }}
            dataKey="value"
            cornerRadius={20}
            fill="url(#gaugeFill)"
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-3xl font-bold text-gradient">
          {pct.toFixed(1)}
          <span className="text-base font-normal text-gray-400">%</span>
        </div>
        <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-1">
          booking rate
        </div>
      </div>
    </div>
  );
}
