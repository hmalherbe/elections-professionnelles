import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requiredSecret } from "../lib/secrets.js";

/**
 * Pas d'académie ni de Spelc (pas de hiérarchie territoriale pour ce suivi
 * national agricole) — contrairement à l'application éducation nationale,
 * tout compte authentifié a accès à l'ensemble des données. Deux rôles
 * seulement, sans périmètre fin par onglet : "admin_complet" (tous les
 * onglets) et "admin_restreint" (tous les onglets sauf Imports et Comptes
 * administrateurs — voir requireFullAdmin).
 */
export type UserRole = "admin_complet" | "admin_restreint";

export interface AuthUser {
  id: number;
  email: string;
  nom: string | null;
  prenom: string | null;
  role: UserRole;
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = requiredSecret(["JWT_SECRET"], "dev-secret-change-me");

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "12h" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentification requise." });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as AuthUser;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Session invalide ou expirée." });
  }
}

/** Réservé aux onglets Imports et Comptes administrateurs — à monter après
 * requireAuth (voir routes/imports.ts, routes/admin.ts). */
export function requireFullAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin_complet") {
    res.status(403).json({ error: "Réservé à l'administration complète." });
    return;
  }
  next();
}
