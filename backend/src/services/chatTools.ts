import { db } from "../db/index.js";
import type { AuthUser } from "../middleware/auth.js";
import {
  camembert,
  courbeCumulative,
  participationParEtablissement,
  participationTreeNational,
  scrutinsTab,
  type Scope,
} from "./stats.js";

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

const SCOPE_PROPERTY = {
  scope: {
    type: "string",
    enum: ["national", "academique"],
    description:
      "'national' = scrutin CCMMEP (national). 'academique' = scrutin local propre à l'académie (CCMI/CCMA/CCMD/CCML1D/CCML2D...).",
  },
};

function spelcAcademie(spelc: string): string | null {
  const row = db.prepare("SELECT academie FROM ref_spelc WHERE spelc = ?").get(spelc) as
    | { academie: string }
    | undefined;
  return row?.academie ?? null;
}

/**
 * Construit la liste des outils (function calling) disponibles pour un
 * rôle donné. C'est la première ligne de défense : un admin académique ou
 * Spelc n'a même pas la possibilité de désigner une autre académie/un
 * autre Spelc dans les paramètres exposés au modèle. `executeTool`
 * revérifie et force de toute façon le périmètre côté serveur.
 */
export function buildToolsForRole(role: AuthUser["role"]): ToolDef[] {
  const tools: ToolDef[] = [];

  const scopedParams: Record<string, unknown> =
    role === "admin_general"
      ? {
          ...SCOPE_PROPERTY,
          academie: { type: "string", description: "Code académie (laisser vide pour agréger toutes les académies)." },
          spelc: { type: "string", description: "Nom du Spelc (laisser vide pour ne pas filtrer par Spelc)." },
        }
      : { ...SCOPE_PROPERTY };

  tools.push({
    type: "function",
    function: {
      name: "resume_participation",
      description:
        "Résumé de la participation (nombre d'inscrits, de votants, de non-votants, taux de participation) pour un périmètre donné.",
      parameters: { type: "object", properties: scopedParams, required: ["scope"] },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "courbe_participation",
      description:
        "Courbe jour par jour de la participation cumulée (du 3 au 10 décembre 2026) pour un périmètre donné.",
      parameters: { type: "object", properties: scopedParams, required: ["scope"] },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "participation_par_etablissement",
      description: "Répartition de la participation par établissement (affectation) pour un périmètre donné, du plus au moins d'inscrits.",
      parameters: { type: "object", properties: scopedParams, required: ["scope"] },
    },
  });

  const scrutinsParams =
    role === "admin_general"
      ? {
          ...SCOPE_PROPERTY,
          academie: scopedParams.academie,
          spelc: scopedParams.spelc,
          votant: { type: "string", enum: ["votant", "non_votant"], description: "Filtrer sur les votants ou les non-votants uniquement." },
          adherent: {
            type: "string",
            enum: ["oui", "non"],
            description: "Filtrer sur les adhérents ou les non-adhérents (uniquement significatif si un Spelc est précisé).",
          },
        }
      : role === "admin_spelc"
        ? {
            ...SCOPE_PROPERTY,
            votant: { type: "string", enum: ["votant", "non_votant"] },
            adherent: { type: "string", enum: ["oui", "non"], description: "Filtrer sur les adhérents ou les non-adhérents du Spelc." },
          }
        : {
            ...SCOPE_PROPERTY,
            votant: { type: "string", enum: ["votant", "non_votant"] },
          };

  tools.push({
    type: "function",
    function: {
      name: "repartition_scrutins",
      description:
        "Répartition des émargements par type de scrutin (CCMMEP, CCMI, CCMA, CCMD, CCML1D, CCML2D...), avec le nombre de votants, pour un périmètre donné.",
      parameters: { type: "object", properties: scrutinsParams, required: ["scope"] },
    },
  });

  if (role === "admin_general") {
    tools.push({
      type: "function",
      function: {
        name: "repartition_nationale_par_academie",
        description:
          "Vue d'ensemble du scrutin national CCMMEP : participation détaillée par académie, puis par Spelc au sein de chaque académie.",
        parameters: { type: "object", properties: {} },
      },
    });
  }

  if (role === "admin_general" || role === "admin_spelc") {
    tools.push({
      type: "function",
      function: {
        name: "adherents_spelc",
        description:
          "Adhérents d'un Spelc : combien sont déclarés, combien ont voté au scrutin national CCMMEP, et la même chose pour les non-adhérents (total d'inscrits au scrutin moins les adhérents). Si le nombre de non-adhérents est nul ou très faible, c'est que la liste d'adhérents couvre déjà la quasi-totalité des inscrits — un taux à 0% chez les non-adhérents n'est alors pas une anomalie.",
        parameters:
          role === "admin_general"
            ? { type: "object", properties: { spelc: { type: "string", description: "Nom du Spelc." } }, required: ["spelc"] }
            : { type: "object", properties: {} },
      },
    });
  }

  return tools;
}

/**
 * Résout le (scope, académie, spelc) réellement utilisé pour la requête,
 * en forçant le périmètre de l'utilisateur quel que soit ce que le modèle
 * a demandé — c'est ici, et non dans les instructions du prompt, que la
 * cloison entre académies/Spelcs est garantie.
 */
function resolveScope(
  user: AuthUser,
  requested: { scope?: string; academie?: string; spelc?: string }
): { scope: Scope; academie: string | null; spelc: string | null } {
  const scope: Scope = requested.scope === "academique" ? "academique" : "national";
  if (user.role === "admin_general") {
    return { scope, academie: requested.academie || null, spelc: requested.spelc || null };
  }
  if (user.role === "admin_academique") {
    return { scope, academie: user.academie, spelc: null };
  }
  // admin_spelc
  return { scope, academie: null, spelc: user.spelc };
}

export function executeTool(name: string, args: Record<string, unknown>, user: AuthUser): unknown {
  const requested = {
    scope: typeof args.scope === "string" ? args.scope : undefined,
    academie: typeof args.academie === "string" ? args.academie : undefined,
    spelc: typeof args.spelc === "string" ? args.spelc : undefined,
  };

  switch (name) {
    case "resume_participation": {
      const filter = resolveScope(user, requested);
      const { votants, nonVotants } = camembert(filter);
      const inscrits = votants + nonVotants;
      return { ...filter, inscrits, votants, nonVotants, taux: inscrits ? votants / inscrits : 0 };
    }
    case "courbe_participation": {
      const filter = resolveScope(user, requested);
      return { ...filter, points: courbeCumulative(filter) };
    }
    case "participation_par_etablissement": {
      const filter = resolveScope(user, requested);
      const rows = participationParEtablissement(filter);
      // Limite la taille renvoyée au modèle : les questions portent presque
      // toujours sur les établissements les plus/moins engagés, pas sur la
      // liste exhaustive (qui peut compter plusieurs centaines de lignes).
      return { ...filter, etablissements: rows.slice(0, 25), totalEtablissements: rows.length };
    }
    case "repartition_scrutins": {
      const filter = resolveScope(user, requested);
      const votant = args.votant === "votant" || args.votant === "non_votant" ? args.votant : null;
      const adherent = args.adherent === "oui" || args.adherent === "non" ? args.adherent : null;
      const result = scrutinsTab({ ...filter, votant, adherent }, 1, 0);
      return { ...filter, votant, adherent, groups: result.groups, totalRows: result.totalRows };
    }
    case "repartition_nationale_par_academie": {
      if (user.role !== "admin_general") throw new Error("Accès non autorisé.");
      return { tree: participationTreeNational() };
    }
    case "adherents_spelc": {
      if (user.role !== "admin_general" && user.role !== "admin_spelc") {
        throw new Error("Accès non autorisé.");
      }
      const spelc = user.role === "admin_spelc" ? user.spelc! : String(args.spelc ?? "").trim();
      if (!spelc) throw new Error("Spelc requis.");
      const academie = spelcAcademie(spelc);
      const totalAdherents = (
        db.prepare("SELECT COUNT(*) AS c FROM adherents WHERE spelc = ?").get(spelc) as { c: number }
      ).c;
      const votantsAdherents = scrutinsTab(
        { scope: "national", academie, spelc, votant: "votant", adherent: "oui" },
        1,
        0
      ).totalRows;
      // On renvoie systématiquement le total d'inscrits au scrutin à côté du
      // nombre d'adhérents : sans ça, un taux de 0% chez les non-adhérents
      // (légitime si la liste d'adhérents couvre déjà tous les inscrits,
      // comme c'est le cas sur des jeux de test dérivés du même fichier)
      // semble être une erreur de calcul alors que ce n'en est pas une.
      const { votants: totalVotants, nonVotants: totalNonVotants } = camembert({ scope: "national", academie, spelc });
      const totalInscrits = totalVotants + totalNonVotants;
      const totalNonAdherents = Math.max(totalInscrits - totalAdherents, 0);
      const votantsNonAdherents = Math.max(totalVotants - votantsAdherents, 0);
      return {
        spelc,
        totalAdherents,
        votantsAdherents,
        totalInscritsScrutinNational: totalInscrits,
        totalNonAdherents,
        votantsNonAdherents,
      };
    }
    default:
      throw new Error(`Outil inconnu : ${name}`);
  }
}
