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

/** Convertit une cellule d'en-tête de jour en "YYYY-MM-DD" — le fichier
 * observé mélange un format texte "JJ/MM/AAAA" (première colonne) et de
 * vraies dates Excel (colonnes suivantes, lues par ExcelJS comme des objets
 * Date) : les deux doivent être reconnus pour que les colonnes s'alignent.
 * `null` si la cellule n'est ni l'un ni l'autre (fin des colonnes de jour). */
function parseDayHeaderCell(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const [, d, mo, y] = m;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }
  return null;
}

/**
 * Plan de relance SMS par Spelc et par jour du scrutin ("Oui"/"Non"), saisi
 * manuellement par la fédération (feuille "Relances SMS" du fichier
 * uploadé, colonne Spelc puis une colonne par jour) — voir
 * ref_relance_sms_plan (db/index.ts) et son usage dans
 * /brevo/campaigns/simulate (mode simulation). La ligne d'en-tête ("Spelc")
 * n'est pas forcément la première ligne de la feuille (une étiquette libre,
 * ex. "CREDITS SMS RESTANTS", peut occuper une ligne au-dessus sur d'autres
 * colonnes) : on la cherche par son contenu plutôt que par sa position.
 * Une cellule vide (ni "Oui" ni "Non") pour un couple Spelc/jour n'est pas
 * enregistrée : l'absence de ligne reste alors non restrictive côté
 * simulation. Remplacement intégral à chaque chargement.
 */
export async function loadRelanceSmsPlanWorkbook(buffer: Buffer): Promise<{ count: number; quotasUpdated: number }> {
  const wb = await loadWorkbook(buffer);
  const sheet = wb.getWorksheet("Relances SMS");
  if (!sheet) throw new Error('Feuille "Relances SMS" introuvable dans le fichier.');

  let headerRowNumber = -1;
  sheet.eachRow((row, rowNumber) => {
    if (headerRowNumber !== -1) return;
    if (String(normalizeCellValue(row.getCell(1).value) ?? "").trim().toLowerCase() === "spelc") {
      headerRowNumber = rowNumber;
    }
  });
  if (headerRowNumber === -1) {
    throw new Error('Ligne d\'en-tête ("Spelc") introuvable dans la feuille "Relances SMS".');
  }

  const headerRow = sheet.getRow(headerRowNumber);
  const dayColumns: { col: number; jour: string }[] = [];
  for (let col = 2; ; col++) {
    const jour = parseDayHeaderCell(normalizeCellValue(headerRow.getCell(col).value));
    if (!jour) break;
    dayColumns.push({ col, jour });
  }
  if (dayColumns.length === 0) {
    throw new Error('Aucune colonne de date reconnue dans la feuille "Relances SMS".');
  }

  // Colonne "Crédits SMS" (quota alloué par Spelc) : optionnelle, cherchée
  // sur toute la ligne d'en-tête (pas seulement après les colonnes de jour,
  // une colonne "Nb adhérents" pouvant s'intercaler avant elle). Absente
  // d'anciennes versions du fichier : dans ce cas ref_sms_quota n'est pas
  // touché, seul le plan Oui/Non est chargé — voir carte "Crédits SMS par
  // Spelc" (onglet Référentiels) pour le charger séparément.
  let creditsCol = -1;
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (creditsCol !== -1) return;
    const label = stripAccents(String(normalizeCellValue(cell.value) ?? "").trim().toLowerCase());
    if (label === "credits sms") creditsCol = colNumber;
  });

  const insertPlan = db.prepare("INSERT INTO ref_relance_sms_plan (spelc, jour, planifie) VALUES (?, ?, ?)");
  const insertQuota = db.prepare(
    "INSERT INTO ref_sms_quota (spelc, credits, updated_at) VALUES (?, ?, datetime('now'))"
  );
  let count = 0;
  let quotasUpdated = 0;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM ref_relance_sms_plan").run();
    if (creditsCol !== -1) db.prepare("DELETE FROM ref_sms_quota").run();
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      const spelc = normalizeCellValue(row.getCell(1).value);
      if (spelc == null || String(spelc).trim() === "") return;
      const spelcName = String(spelc).trim();
      for (const { col, jour } of dayColumns) {
        const raw = String(normalizeCellValue(row.getCell(col).value) ?? "")
          .trim()
          .toLowerCase();
        if (raw !== "oui" && raw !== "non") continue;
        insertPlan.run(spelcName, jour, raw === "oui" ? 1 : 0);
        count++;
      }
      if (creditsCol !== -1) {
        const credits = normalizeCellValue(row.getCell(creditsCol).value);
        const creditsNum = Number(credits);
        if (credits != null && credits !== "" && Number.isFinite(creditsNum)) {
          insertQuota.run(spelcName, Math.round(creditsNum));
          quotasUpdated++;
        }
      }
    });
  });
  tx();
  return { count, quotasUpdated };
}

export interface RelanceSmsPlanRow {
  spelc: string;
  jour: string;
  planifie: boolean;
}

/** Plan de relance SMS actuellement chargé, pour affichage (carte "Relances
 * SMS des Spelc", onglet Référentiels) — voir loadRelanceSmsPlanWorkbook. */
export function listRelanceSmsPlan(): RelanceSmsPlanRow[] {
  const rows = db
    .prepare("SELECT spelc, jour, planifie FROM ref_relance_sms_plan ORDER BY spelc, jour")
    .all() as { spelc: string; jour: string; planifie: number }[];
  return rows.map((r) => ({ spelc: r.spelc, jour: r.jour, planifie: Boolean(r.planifie) }));
}

/**
 * Un Spelc est-il planifié pour relancer par SMS ce jour-là ? `true` par
 * défaut si ce couple Spelc/jour n'a pas de ligne dans le plan (pas de plan
 * saisi = pas de restriction, voir loadRelanceSmsPlanWorkbook) — seule une
 * ligne explicite "Non" bloque.
 */
export function isSmsPlannedFor(spelc: string, jour: string): boolean {
  const row = db
    .prepare("SELECT planifie FROM ref_relance_sms_plan WHERE spelc = ? AND jour = ?")
    .get(spelc, jour) as { planifie: number } | undefined;
  return row ? Boolean(row.planifie) : true;
}

/**
 * Taux de participation simulé par jour du scrutin ("Date" / "participation"
 * en colonnes A/B, une ligne par jour) — "taux de votants parmi les
 * restants à voter" ce jour-là (taux de hasard : à ne pas confondre avec un
 * taux cumulé ou une part fixe du corps électoral total). Sert de référence
 * pour générer un scénario de test des relances (voir carte "Simulation
 * taux de participation", onglet Référentiels). Remplacement intégral à
 * chaque chargement, voir loadDepartementsWorkbook.
 */
export async function loadParticipationSimulWorkbook(buffer: Buffer): Promise<{ count: number }> {
  const wb = await loadWorkbook(buffer);
  const sheet = wb.worksheets[0];

  const insert = db.prepare("INSERT INTO ref_participation_simul (jour, taux) VALUES (?, ?)");
  let count = 0;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM ref_participation_simul").run();
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // en-tête
      const jour = parseDayHeaderCell(normalizeCellValue(row.getCell(1).value));
      const taux = normalizeCellValue(row.getCell(2).value);
      if (!jour || taux == null || taux === "") return;
      const tauxNum = Number(taux);
      if (!Number.isFinite(tauxNum)) return;
      insert.run(jour, tauxNum);
      count++;
    });
  });
  tx();
  return { count };
}

export interface ParticipationSimulRow {
  jour: string;
  taux: number;
}

/** Taux de participation simulé actuellement chargé, pour affichage (carte
 * "Simulation taux de participation", onglet Référentiels) et pour générer
 * un scénario de test — voir loadParticipationSimulWorkbook. */
export function listParticipationSimul(): ParticipationSimulRow[] {
  return db.prepare("SELECT jour, taux FROM ref_participation_simul ORDER BY jour").all() as ParticipationSimulRow[];
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
