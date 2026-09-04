import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "./Card";
import { COLOR_NON_VOTANT, COLOR_VOTANT, formatPercent } from "../lib/colors";

export function CamembertCard({
  title,
  votants,
  nonVotants,
}: {
  title: string;
  votants: number;
  nonVotants: number;
}) {
  const total = votants + nonVotants;
  const data = [
    { name: "Votants", value: votants },
    { name: "Non votants", value: nonVotants },
  ];
  const taux = total ? votants / total : 0;

  return (
    <Card title={title} subtitle={`${total.toLocaleString("fr-FR")} inscrits · participation ${formatPercent(taux)}`}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
              <Cell fill={COLOR_VOTANT} />
              <Cell fill={COLOR_NON_VOTANT} />
            </Pie>
            <Tooltip formatter={(value) => Number(value).toLocaleString("fr-FR")} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
