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

const IF_EXPR_REGEX = /{{#if\s+([^{}]+?)\s*}}/g;

/** Identifiants réellement testés dans une expression (`and`/`or`/`not` et
 * parenthèses exclus) — mêmes tokens que ceux lus par evaluateExpression. */
function expressionIdentifiers(expr: string): string[] {
  return tokenize(expr).filter((t) => t !== "and" && t !== "or" && t !== "not" && t !== "(" && t !== ")");
}

export interface TemplateTestCase {
  /** Description du cas, affichée au-dessus de l'aperçu (ex. "Cas 2/3 : CCMMEP_non_votant and not(scrutin_local_non_votant)"). */
  label: string;
  /** Valeurs booléennes à substituer aux champs habituels (voir TemplateFields) pour que ce cas précis s'affiche. */
  overrides: Record<string, boolean>;
}

/**
 * Construit un jeu de cas de test couvrant chaque condition {{#if ...}}
 * distincte trouvée dans le texte (objet + corps réunis) : un cas par
 * expression, avec la combinaison de valeurs booléennes — parmi tous les
 * identifiants utilisés dans le texte — qui comporte le moins de valeurs
 * vraies possible tout en rendant CETTE expression vraie (pour isoler au
 * mieux la branche testée des autres conditions du même modèle). Un modèle
 * sans aucun {{#if}} produit un seul cas sans aucun override, pour un rendu
 * identique à l'ancien aperçu à cas unique.
 */
export function buildIfTestCases(text: string): TemplateTestCase[] {
  const expressions: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(IF_EXPR_REGEX)) {
    const expr = match[1].trim().replace(/\s+/g, " ");
    if (!seen.has(expr)) {
      seen.add(expr);
      expressions.push(expr);
    }
  }
  if (expressions.length === 0) return [{ label: "Aperçu", overrides: {} }];

  const identifiers = Array.from(new Set(expressions.flatMap(expressionIdentifiers)));
  const combos: Record<string, boolean>[] = [];
  for (let mask = 0; mask < 1 << identifiers.length; mask++) {
    const combo: Record<string, boolean> = {};
    identifiers.forEach((id, i) => {
      combo[id] = Boolean(mask & (1 << i));
    });
    combos.push(combo);
  }
  combos.sort((a, b) => Object.values(a).filter(Boolean).length - Object.values(b).filter(Boolean).length);

  return expressions.map((expr, i) => ({
    label: `Cas ${i + 1}/${expressions.length} : ${expr}`,
    overrides: combos.find((combo) => evaluateExpression(expr, combo)) ?? {},
  }));
}

/** Champs dont la valeur est du HTML construit par l'application elle-même
 * (logos/bannière en pièce jointe fixe, liens sociaux configurés par
 * l'admin) — jamais issus d'un fichier importé. Seuls ceux-ci échappent à
 * l'échappement HTML du mode "html" ci-dessous. */
const RAW_HTML_FIELDS = new Set(["logo_spelc", "logo_rugby", "reseaux_sociaux"]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Moteur de template minimal : substitution {{champ}} et conditions
 * {{#if expression}}...{{else}}...{{/if}}, l'expression pouvant combiner
 * plusieurs champs avec and/or/not(...) et des parenthèses. Suffisant pour
 * les contenus de mail/SMS de relance décrits dans la spécification.
 *
 * `format` ("text" par défaut) : "html" échappe chaque valeur substituée
 * (hors RAW_HTML_FIELDS) avant insertion — indispensable pour un corps de
 * mail affiché ensuite tel quel via dangerouslySetInnerHTML
 * (AdminSpelcDashboard.tsx, aperçu du modèle) : {{nom}}/{{prenom}}
 * viennent d'un fichier importé (Excel/JSON) et ne sont jamais du texte de
 * confiance — sans cet échappement, un nom/prénom contenant une balise
 * HTML (fichier corrompu ou malveillant) s'exécuterait tel quel dans le
 * navigateur de quiconque prévisualie ensuite ce modèle (XSS stocké,
 * potentiellement contre un compte admin plus privilégié que celui ayant
 * importé le fichier). "text" (objet du mail, contenu SMS) ne doit jamais
 * échapper : ni un en-tête "Objet" ni un SMS ne sont interprétés comme du
 * HTML, un "&" littéral doit y rester "&".
 */
export function renderTemplate(source: string, fields: TemplateFields, format: "html" | "text" = "text"): string {
  let out = source.replace(
    /{{#if\s+([^{}]+?)\s*}}([\s\S]*?)(?:{{else}}([\s\S]*?))?{{\/if}}/g,
    (_m, expr, truthy, falsy) => {
      return evaluateExpression(expr, fields) ? truthy : falsy ?? "";
    }
  );
  out = out.replace(/{{\s*(\w+)\s*}}/g, (_m, key) => {
    const value = fields[key];
    if (value === undefined || value === null) return "";
    const text = String(value);
    return format === "html" && !RAW_HTML_FIELDS.has(key) ? escapeHtml(text) : text;
  });
  return out;
}
