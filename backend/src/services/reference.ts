import { db } from "../db/index.js";
import { loadWorkbook, rowsAsObjects, normalizeCellValue } from "../lib/xlsx.js";
import { stripAccents } from "../lib/normalize.js";

function normDept(value: unknown): string {
  return String(value).trim().padStart(2, "0");
}

/**
 * Fichier "Département - Spelc / Académie" : on utilise la feuille qui
 * contient les 3 colonnes (Département, Spelc de rattachement, Académie).
 * Une feuille annexe ("Feuil1"/"Accord"), si présente, alimente ref_spelc —
 * mais UNIQUEMENT la liste des noms de Spelc connus (utilisée pour valider
 * les imports groupés d'adhérents/comptes, voir routes/adherents.ts et
 * services/userImport.ts) : ses éventuelles colonnes "Académie"/"Accord" ne
 * sont plus lues. L'académie d'un Spelc est déterminée à partir de
 * ref_departements (spelcAcademies(), ci-dessous), qui représente
 * correctement un Spelc à cheval sur plusieurs académies — une seule valeur
 * par Spelc (l'ancienne colonne "Académie" de cette feuille annexe) ne le
 * pouvait pas. "Accord" n'est affiché ni utilisé nulle part dans
 * l'application.
 *
 * Remplacement intégral à chaque chargement (table vidée avant réinsertion,
 * dans la même transaction) : ce fichier est la source de vérité unique, et
 * un simple upsert laisserait vivre indéfiniment une ligne retirée du
 * fichier (ou saisie par erreur lors d'un test).
 */
export async function loadDepartementsWorkbook(buffer: Buffer): Promise<{ departements: number; spelcs: number }> {
  const wb = await loadWorkbook(buffer);

  const deptSheet =
    wb.worksheets.find((s) => /d[ée]partement/i.test(s.name) && /spelc/i.test(s.name)) ?? wb.worksheets[0];
  const deptRows = rowsAsObjects(deptSheet);

  const insertDept = db.prepare("INSERT INTO ref_departements (departement, spelc, academie) VALUES (?, ?, ?)");
  let deptCount = 0;
  const txDept = db.transaction((rows: Record<string, unknown>[]) => {
    db.prepare("DELETE FROM ref_departements").run();
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
  const spelcSheet = wb.worksheets.find((s) => /accord/i.test(s.name) || /feuil1/i.test(s.name));
  if (spelcSheet) {
    const rows = rowsAsObjects(spelcSheet);
    // accord/academie restent NOT NULL en base (voir db/index.ts) mais ne
    // sont plus renseignés : placeholders vides, jamais lus ailleurs.
    const insertSpelc = db.prepare("INSERT INTO ref_spelc (spelc, accord, academie) VALUES (?, '', '')");
    const txSpelc = db.transaction((r: Record<string, unknown>[]) => {
      db.prepare("DELETE FROM ref_spelc").run();
      for (const row of r) {
        // Colonne retrouvée par son en-tête (pas par position) : robuste à
        // l'ordre/au retrait d'autres colonnes dans le fichier.
        const keys = Object.keys(row).reduce<Record<string, unknown>>((acc, k) => {
          acc[stripAccents(k).toLowerCase().trim()] = row[k];
          return acc;
        }, {});
        const spelcKey = Object.keys(keys).find((k) => k.includes("spelc") && !k.includes("accord"));
        const spelc = spelcKey ? keys[spelcKey] : null;
        if (spelc == null || String(spelc).trim() === "") continue;
        insertSpelc.run(String(spelc).trim());
        spelcCount++;
      }
    });
    txSpelc(rows);
  }

  return { departements: deptCount, spelcs: spelcCount };
}

/**
 * Plafond de crédits SMS par Spelc : nom du Spelc en colonne B, crédits
 * alloués en colonne D (format fourni par la fédération — colonnes A/C
 * (départements, nombre de cotisations) et le reste de la feuille, dont le
 * récapitulatif des crédits totaux achetés, ne sont pas utilisés ici).
 *
 * Lecture par position de colonne directe (row.getCell), PAS via
 * rowsAsObjects()/Object.values() : le fichier réel fourni contient des
 * valeurs numériques résiduelles dans la ligne d'en-tête (au-delà des 4
 * colonnes utiles), ce qui décale l'accès positionnel par Object.values()
 * sur certaines lignes (voir le commentaire de rowsAsObjects dans lib/xlsx.ts).
 *
 * Remplacement intégral à chaque chargement, voir loadDepartementsWorkbook.
 */
export async function loadSmsQuotaWorkbook(buffer: Buffer): Promise<{ count: number }> {
  const wb = await loadWorkbook(buffer);
  const sheet = wb.worksheets[0];

  const insert = db.prepare("INSERT INTO ref_sms_quota (spelc, credits, updated_at) VALUES (?, ?, datetime('now'))");
  let count = 0;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM ref_sms_quota").run();
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // en-tête
      const spelc = normalizeCellValue(row.getCell(2).value); // colonne B
      const credits = normalizeCellValue(row.getCell(4).value); // colonne D
      if (spelc == null || String(spelc).trim() === "" || credits == null || credits === "") return;
      const creditsNum = Number(credits);
      if (!Number.isFinite(creditsNum)) return;
      insert.run(String(spelc).trim(), Math.round(creditsNum));
      count++;
    });
  });
  tx();
  return { count };
}

/** Remplacement intégral à chaque chargement, voir loadDepartementsWorkbook. */
export async function loadAcademieScrutinsWorkbook(buffer: Buffer): Promise<{ count: number }> {
  const wb = await loadWorkbook(buffer);
  const rows = rowsAsObjects(wb.worksheets[0]);

  const insert = db.prepare("INSERT INTO ref_academie_scrutins (academie, type_1d, type_2d) VALUES (?, ?, ?)");
  let count = 0;
  const tx = db.transaction((r: Record<string, unknown>[]) => {
    db.prepare("DELETE FROM ref_academie_scrutins").run();
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

const academieSoleSpelcCache = new Map<string, string | null>();

/**
 * Le Spelc unique d'une académie, si tous ses départements pointent vers le
 * même Spelc (cas de la majorité des académies — Nice/Côte d'Azur, Lyon,
 * Guadeloupe/Antilles isolément, etc.). Sert de repli dans buildEmargementRow
 * quand le code postal d'un émargement n'a pas pu être extrait/reconnu mais
 * que l'académie, elle, est connue (import académique : toujours forcée) —
 * évite de perdre silencieusement la personne de la vue par Spelc (qui
 * filtre sur `spelc`, pas `academie`) alors que son Spelc n'est pourtant pas
 * ambigu. Retourne null si l'académie a plusieurs Spelcs (ex. Rennes,
 * Bordeaux, Toulouse, Strasbourg, Normandie) : dans ce cas, sans département
 * on ne peut pas deviner lequel, donc on ne tente pas.
 */
export function soleSpelcForAcademie(academie: string | null): string | null {
  if (!academie) return null;
  if (academieSoleSpelcCache.has(academie)) return academieSoleSpelcCache.get(academie) ?? null;
  const rows = db.prepare("SELECT DISTINCT spelc FROM ref_departements WHERE academie = ?").all(academie) as { spelc: string }[];
  const result = rows.length === 1 ? rows[0].spelc : null;
  academieSoleSpelcCache.set(academie, result);
  return result;
}

const spelcAcademiesCache = new Map<string, string[]>();

/**
 * La ou les académies d'un Spelc — dérivée de ref_departements (source
 * unique de vérité, département par département), PAS de ref_spelc.academie
 * (une seule valeur, qui ne peut pas représenter un Spelc à cheval sur
 * plusieurs académies, ex. "Centre-Poitou-Charente" sur Orléans-Tours ET
 * Poitiers). Remplace partout l'ancien repli "une seule académie par Spelc" :
 * voir middleware/auth.ts canAccessSpelc (accès de l'admin académique d'une
 * QUELCONQUE de ces académies) et routes/brevo.ts matchedAdherents (un
 * adhérent peut être électeur dans n'importe laquelle).
 */
export function spelcAcademies(spelc: string): string[] {
  if (spelcAcademiesCache.has(spelc)) return spelcAcademiesCache.get(spelc)!;
  const rows = db
    .prepare("SELECT DISTINCT academie FROM ref_departements WHERE spelc = ? ORDER BY academie")
    .all(spelc) as { academie: string }[];
  const result = rows.map((r) => r.academie);
  spelcAcademiesCache.set(spelc, result);
  return result;
}

export function clearDeptCache(): void {
  deptCache.clear();
  academieSoleSpelcCache.clear();
  spelcAcademiesCache.clear();
}
