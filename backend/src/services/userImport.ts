import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { loadWorkbook, rowsAsObjects } from "../lib/xlsx.js";
import { parseCsvBuffer } from "../lib/csv.js";

/** Mot de passe attribué à tout compte créé par import en masse, à changer à la première connexion. */
export const DEFAULT_IMPORTED_PASSWORD = "ElectionsCCM2026";

export interface ImportUsersResult {
  created: number;
  errors: { row: number; message: string }[];
}

function normKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, "");
}

function getField(row: Record<string, unknown>, ...names: string[]): string {
  const normalized = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) normalized.set(normKey(k), v);
  for (const name of names) {
    const v = normalized.get(normKey(name));
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/**
 * Import en masse de comptes admin Spelc / admin académique depuis un
 * fichier CSV ou Excel. Colonnes attendues (insensibles à la casse/accents) :
 * type_admin (spelc|academique), nom, prenom, email, spelc, academie
 * (spelc requis si type_admin=spelc, academie requis si type_admin=academique).
 * Mot de passe fixe DEFAULT_IMPORTED_PASSWORD, à changer à la 1re connexion.
 */
export async function importUsersFromFile(buffer: Buffer, filename: string): Promise<ImportUsersResult> {
  const isCsv = /\.csv$/i.test(filename);
  const rows = isCsv ? parseCsvBuffer(buffer) : rowsAsObjects((await loadWorkbook(buffer)).worksheets[0]);

  const knownAcademies = new Set(
    (
      db
        .prepare(
          "SELECT DISTINCT academie FROM ref_academie_scrutins UNION SELECT DISTINCT academie FROM ref_departements"
        )
        .all() as { academie: string }[]
    ).map((r) => r.academie)
  );
  const knownSpelcs = new Set(
    (db.prepare("SELECT spelc FROM ref_spelc").all() as { spelc: string }[]).map((r) => r.spelc)
  );

  const insert = db.prepare(
    `INSERT INTO users (email, password_hash, role, academie, spelc, nom, prenom, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  );
  const passwordHash = bcrypt.hashSync(DEFAULT_IMPORTED_PASSWORD, 10);

  let created = 0;
  const errors: { row: number; message: string }[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +1 pour l'en-tête, +1 pour un index base 1
    const typeAdmin = getField(row, "type_admin", "type admin", "type").toLowerCase();
    const nom = getField(row, "nom");
    const prenom = getField(row, "prenom", "prénom");
    const email = getField(row, "email", "mail").toLowerCase();
    const spelc = getField(row, "spelc");
    const academie = getField(row, "academie", "académie");

    if (!typeAdmin && !nom && !prenom && !email) return; // ligne vide

    let role: "admin_spelc" | "admin_academique";
    if (typeAdmin === "spelc") {
      role = "admin_spelc";
    } else if (typeAdmin === "academique" || typeAdmin === "académique") {
      role = "admin_academique";
    } else {
      errors.push({ row: rowNum, message: `type_admin invalide ("${typeAdmin}") : attendu "spelc" ou "academique".` });
      return;
    }
    if (!nom || !prenom || !email) {
      errors.push({ row: rowNum, message: "nom, prenom et email sont requis." });
      return;
    }
    if (role === "admin_spelc") {
      if (!spelc) {
        errors.push({ row: rowNum, message: "spelc requis pour type_admin=spelc." });
        return;
      }
      if (!knownSpelcs.has(spelc)) {
        errors.push({ row: rowNum, message: `Spelc inconnu : "${spelc}" (charger le référentiel avant l'import).` });
        return;
      }
    } else {
      if (!academie) {
        errors.push({ row: rowNum, message: "academie requise pour type_admin=academique." });
        return;
      }
      if (!knownAcademies.has(academie)) {
        errors.push({ row: rowNum, message: `Académie inconnue : "${academie}" (charger le référentiel avant l'import).` });
        return;
      }
    }

    try {
      insert.run(
        email,
        passwordHash,
        role,
        role === "admin_academique" ? academie : null,
        role === "admin_spelc" ? spelc : null,
        nom,
        prenom
      );
      created++;
    } catch {
      errors.push({ row: rowNum, message: `Un compte existe déjà avec l'email "${email}".` });
    }
  });

  return { created, errors };
}
