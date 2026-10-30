import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

/**
 * Un seul profil d'administrateur, sans académie ni Spelc (pas de
 * hiérarchie territoriale pour ce suivi national agricole) — contrairement
 * à l'application éducation nationale, tout compte authentifié a accès à
 * l'ensemble des données. Plusieurs comptes peuvent coexister (voir
 * routes/admin.ts), mais tous avec les mêmes droits.
 */
export interface AuthUser {
  id: number;
  email: string;
  nom: string | null;
  prenom: string | null;
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

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

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
