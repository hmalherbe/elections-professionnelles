import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "./Card";
import { CATEGORICAL, COLOR_VOTANT, formatPercent } from "../lib/colors";
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

interface MergedPoint {
  date: string;
  taux: number;
  tauxSecondaire?: number;
}

/**
 * Fusionne deux courbes cumulatives par date pour un tracé à deux lignes sur
 * un même graphique (ex. territoire du Spelc vs ses seuls adhérents). Chaque
 * courbe ne contient que les jours où au moins un nouvel émargement a été
 * enregistré (voir courbeCumulative côté backend) : les jours absents d'une
 * courbe gardent son dernier taux connu (report en avant), puisqu'un taux
 * cumulé ne peut que rester stable entre deux jours sans nouveau vote.
 */
function mergeCourbes(principale: CourbePoint[], secondaire: CourbePoint[]): MergedPoint[] {
  const dates = [...new Set([...principale.map((p) => p.date), ...secondaire.map((p) => p.date)])].sort();
  const tauxParDate = (points: CourbePoint[]) => new Map(points.map((p) => [p.date, p.taux]));
  const mapPrincipale = tauxParDate(principale);
  const mapSecondaire = tauxParDate(secondaire);
  let dernierPrincipal = 0;
  let dernierSecondaire = 0;
  return dates.map((date) => {
    if (mapPrincipale.has(date)) dernierPrincipal = mapPrincipale.get(date)!;
    if (mapSecondaire.has(date)) dernierSecondaire = mapSecondaire.get(date)!;
    return { date, taux: dernierPrincipal, tauxSecondaire: dernierSecondaire };
  });
}

export function CourbeCard({
  title,
  points,
  pointsSecondaire,
  labelPrincipale,
  labelSecondaire,
}: {
  title: string;
  points: CourbePoint[];
  /** Seconde courbe optionnelle, tracée sur le même graphique (ex. adhérents seuls). */
  pointsSecondaire?: CourbePoint[];
  labelPrincipale?: string;
  labelSecondaire?: string;
}) {
  const aDeuxCourbes = Boolean(pointsSecondaire);
  const data = mergeCourbes(points, pointsSecondaire ?? []);

  return (
    <Card title={title} subtitle="Taux de participation cumulé par jour">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
            {aDeuxCourbes && <Legend />}
            <Line
              type="monotone"
              dataKey="taux"
              name={labelPrincipale ?? "Territoire"}
              stroke={COLOR_VOTANT}
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
              label={aDeuxCourbes ? undefined : renderPointLabel}
            />
            {aDeuxCourbes && (
              <Line
                type="monotone"
                dataKey="tauxSecondaire"
                name={labelSecondaire ?? "Adhérents"}
                stroke={CATEGORICAL[1]}
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {data.length === 0 && <p className="text-sm text-slate-400">Aucun import quotidien pour le moment.</p>}
    </Card>
  );
}
