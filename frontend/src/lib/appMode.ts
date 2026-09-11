import { useEffect, useState } from "react";
import { api } from "./api";

export type AppMode = "full" | "psa-only";

/** Mode d'affichage de cette instance (voir backend GET /api/config) : "full"
 * partout par défaut, "psa-only" uniquement sur l'environnement dédié aux
 * relances PSA (port 8081), sans rien changer au code partagé. */
export function useAppMode(): AppMode {
  const [mode, setMode] = useState<AppMode>("full");
  useEffect(() => {
    api.get<{ mode: AppMode }>("/config").then((r) => setMode(r.mode));
  }, []);
  return mode;
}
