export interface TemplateFields {
  nom: string;
  prenom: string;
  /** Type du scrutin local pour la personne (CCMI/CCMA/CCMD/CCML1D/CCML2D…). */
  scrutin_local: string;
  CCMMEP_non_votant: boolean;
  scrutin_local_non_votant: boolean;
  /** Alias conservés pour compatibilité avec d'anciens modèles. */
  scrutin: string;
  votant: boolean;
  [key: string]: unknown;
}

type Token = string;

function tokenize(expr: string): Token[] {
  return expr.match(/\(|\)|[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
}

/**
 * Évalue une expression booléenne simple : identifiants (vérité selon la
 * valeur du champ), `and`, `or`, `not(...)`, parenthèses. Suffisant pour des
 * conditions comme "CCMMEP_non_votant and not(scrutin_local_non_votant)".
 */
function evaluateExpression(expr: string, fields: Record<string, unknown>): boolean {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token | undefined => tokens[pos++];

  function parseOr(): boolean {
    let value = parseAnd();
    while (peek() === "or") {
      next();
      const rhs = parseAnd();
      value = value || rhs;
    }
    return value;
  }
  function parseAnd(): boolean {
    let value = parseNot();
    while (peek() === "and") {
      next();
      const rhs = parseNot();
      value = value && rhs;
    }
    return value;
  }
  function parseNot(): boolean {
    if (peek() === "not") {
      next();
      return !parseAtom();
    }
    return parseAtom();
  }
  function parseAtom(): boolean {
    if (peek() === "(") {
      next();
      const value = parseOr();
      if (peek() === ")") next();
      return value;
    }
    const token = next();
    if (token === undefined) return false;
    return Boolean(fields[token]);
  }

  return parseOr();
}

/**
 * Moteur de template minimal : substitution {{champ}} et conditions
 * {{#if expression}}...{{else}}...{{/if}}, l'expression pouvant combiner
 * plusieurs champs avec and/or/not(...) et des parenthèses. Suffisant pour
 * les contenus de mail/SMS de relance décrits dans la spécification.
 */
export function renderTemplate(source: string, fields: TemplateFields): string {
  let out = source.replace(
    /{{#if\s+([^{}]+?)\s*}}([\s\S]*?)(?:{{else}}([\s\S]*?))?{{\/if}}/g,
    (_m, expr, truthy, falsy) => {
      return evaluateExpression(expr, fields) ? truthy : falsy ?? "";
    }
  );
  out = out.replace(/{{\s*(\w+)\s*}}/g, (_m, key) => {
    const value = fields[key];
    return value === undefined || value === null ? "" : String(value);
  });
  return out;
}
