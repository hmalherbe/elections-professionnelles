import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requiredSecret } from "../lib/secrets.js";

export type Role = "admin_general" | "admin_academique" | "admin_spelc";

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  academie: string | null;
  spelc: string | null;
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

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Accès non autorisé pour ce rôle." });
      return;
    }
    next();
  };
}

export function canAccessAcademie(user: AuthUser, academie: string): boolean {
  if (user.role === "admin_general") return true;
  if (user.role === "admin_academique") return user.academie === academie;
  return false;
}

/**
 * spelcAcademies : la ou les académies de ce Spelc (voir
 * services/reference.ts spelcAcademies()) — un Spelc peut être à cheval sur
 * plusieurs académies (ses départements ne pointent pas tous vers la même),
 * auquel cas l'admin académique de N'IMPORTE LAQUELLE de ces académies peut y
 * accéder.
 */
export function canAccessSpelc(user: AuthUser, spelcAcademies: string[], spelc: string): boolean {
  if (user.role === "admin_general") return true;
  if (user.role === "admin_academique") return user.academie !== null && spelcAcademies.includes(user.academie);
  if (user.role === "admin_spelc") return user.spelc === spelc;
  return false;
}
