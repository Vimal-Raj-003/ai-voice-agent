"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { providerColor } from "@/lib/provider-colors";

export default function CostByProvider({
  data,
}: {
  data: Array<{ provider: string; costUsd: number }>;
}) {
  const total = data.reduce((s, d) => s + d.costUsd, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            innerRadius={60}
            outerRadius={90}
            paddingAngle={3}
            dataKey="costUsd"
            nameKey="provider"
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={2}
          >
            {data.map((d) => (
              <Cell key={d.provider} fill={providerColor(d.provider)} />
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
            formatter={(v) => `$${Number(v).toFixed(4)}`}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-2xl font-bold text-gradient">
          ${total.toFixed(2)}
        </div>
        <div className="text-[10px] uppercase tracking-widest text-gray-500">
          last 14 days
        </div>
      </div>
    </div>
  );
}
