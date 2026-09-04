import { db } from "../db/index.js";
import { loadWorkbook, rowsAsObjects } from "../lib/xlsx.js";

function normDept(value: unknown): string {
  return String(value).trim().padStart(2, "0");
}

/**
 * Fichier "Département - Spelc / Académie" : on utilise la feuille qui
 * contient les 3 colonnes (Département, Spelc de rattachement, Académie).
 * Une feuille annexe (accord du Spelc pour traiter les données) est
 * chargée dans ref_spelc si présente.
 */
export async function loadDepartementsWorkbook(buffer: Buffer): Promise<{ departements: number; spelcs: number }> {
  const wb = await loadWorkbook(buffer);

  const deptSheet =
    wb.worksheets.find((s) => /d[ée]partement/i.test(s.name) && /spelc/i.test(s.name)) ?? wb.worksheets[0];
  const deptRows = rowsAsObjects(deptSheet);

  const insertDept = db.prepare(
    `INSERT INTO ref_departements (departement, spelc, academie) VALUES (?, ?, ?)
     ON CONFLICT(departement) DO UPDATE SET spelc = excluded.spelc, academie = excluded.academie`
  );
  let deptCount = 0;
  const txDept = db.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const values = Object.values(row);
      const dept = values[0];
      const spelc = values[1];
      const academie = values[2];
      if (dept == null || spelc == null) continue;
      insertDept.run(normDept(dept), String(spelc).trim(), String(academie ?? "").trim());
      deptCount++;
    }
  });
  txDept(deptRows);

  let spelcCount = 0;
  const accordSheet = wb.worksheets.find((s) => /accord/i.test(s.name) || /feuil1/i.test(s.name));
  if (accordSheet) {
    const rows = rowsAsObjects(accordSheet);
    const insertSpelc = db.prepare(
      `INSERT INTO ref_spelc (spelc, accord, academie) VALUES (?, ?, ?)
       ON CONFLICT(spelc) DO UPDATE SET accord = excluded.accord, academie = excluded.academie`
    );
    const txSpelc = db.transaction((r: Record<string, unknown>[]) => {
      for (const row of r) {
        const values = Object.values(row);
        const spelc = values[0];
        const accord = values[1];
        const academie = values[2];
        if (spelc == null) continue;
        insertSpelc.run(String(spelc).trim(), String(accord ?? "").trim(), String(academie ?? "").trim());
        spelcCount++;
      }
    });
    txSpelc(rows);
  }

  return { departements: deptCount, spelcs: spelcCount };
}

export async function loadAcademieScrutinsWorkbook(buffer: Buffer): Promise<{ count: number }> {
  const wb = await loadWorkbook(buffer);
  const rows = rowsAsObjects(wb.worksheets[0]);

  const insert = db.prepare(
    `INSERT INTO ref_academie_scrutins (academie, type_1d, type_2d) VALUES (?, ?, ?)
     ON CONFLICT(academie) DO UPDATE SET type_1d = excluded.type_1d, type_2d = excluded.type_2d`
  );
  let count = 0;
  const tx = db.transaction((r: Record<string, unknown>[]) => {
    for (const row of r) {
      const values = Object.values(row);
      const academie = values[0];
      const type1d = values[1];
      const type2d = values[2];
      if (academie == null) continue;
      insert.run(String(academie).trim(), String(type1d ?? "").trim(), String(type2d ?? "").trim());
      count++;
    }
  });
  tx(rows);
  return { count };
}

export async function loadPsaWorkbook(buffer: Buffer): Promise<{ count: number }> {
  const wb = await loadWorkbook(buffer);
  const rows = rowsAsObjects(wb.worksheets[0]);

  db.prepare("DELETE FROM psa").run();
  const insert = db.prepare(
    `INSERT INTO psa (type_scrutin, nom, prenom, email, mobile) VALUES (?, ?, ?, ?, ?)`
  );
  let count = 0;
  const tx = db.transaction((r: Record<string, unknown>[]) => {
    for (const row of r) {
      const values = Object.values(row);
      const [typeScrutin, nom, prenom, email, mobile] = values;
      if (!nom || !prenom) continue;
      insert.run(
        String(typeScrutin ?? "").trim(),
        String(nom).trim(),
        String(prenom).trim(),
        email ? String(email).trim() : null,
        mobile ? String(mobile).trim() : null
      );
      count++;
    }
  });
  tx(rows);
  return { count };
}

export interface DeptLookup {
  spelc: string;
  academie: string;
}

const deptCache = new Map<string, DeptLookup | null>();

export function lookupDepartement(departement: string | null): DeptLookup | null {
  if (!departement) return null;
  if (deptCache.has(departement)) return deptCache.get(departement) ?? null;
  const row = db
    .prepare("SELECT spelc, academie FROM ref_departements WHERE departement = ?")
    .get(departement) as DeptLookup | undefined;
  deptCache.set(departement, row ?? null);
  return row ?? null;
}

export function clearDeptCache(): void {
  deptCache.clear();
}
