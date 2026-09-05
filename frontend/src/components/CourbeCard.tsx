import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "./Card";
import { COLOR_VOTANT, formatPercent } from "../lib/colors";
import type { CourbePoint } from "../lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderPointLabel(props: any) {
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const value = Number(props.value ?? 0);
  return (
    <text x={x} y={y - 10} textAnchor="middle" fontSize={12} fill="#334155">
      {formatPercent(value)}
    </text>
  );
}

export function CourbeCard({ title, points }: { title: string; points: CourbePoint[] }) {
  return (
    <Card title={title} subtitle="Taux de participation cumulé par jour">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)}
            />
            <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fontSize: 12 }} domain={[0, 1]} />
            <Tooltip
              formatter={(value) => formatPercent(Number(value))}
              labelFormatter={(label) => `Jour du ${label}`}
            />
            <Line
              type="monotone"
              dataKey="taux"
              stroke={COLOR_VOTANT}
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
              label={renderPointLabel}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {points.length === 0 && <p className="text-sm text-slate-400">Aucun import quotidien pour le moment.</p>}
    </Card>
  );
}
