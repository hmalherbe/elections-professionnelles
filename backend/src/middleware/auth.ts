import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

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

export function canAccessSpelc(user: AuthUser, spelcAcademie: string | null, spelc: string): boolean {
  if (user.role === "admin_general") return true;
  if (user.role === "admin_academique") return user.academie === spelcAcademie;
  if (user.role === "admin_spelc") return user.spelc === spelc;
  return false;
}
