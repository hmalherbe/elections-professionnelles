// Regroupements dérivés (département, Spelc) des résultats CCM 2022, construits
// à partir du référentiel département/académie officiel (post-réforme 2020, le
// même que celui utilisé pour dessiner la carte) et du référentiel interne
// Spelc <-> département de l'application (seed-data/departements-spelcs-academies.xlsx).
//
// Les sièges ne sont attribués QUE par académie dans ce scrutin : un département
// affiche donc les résultats de son académie de rattachement (plusieurs
// départements d'une même académie affichent les mêmes chiffres, ce n'est pas
// une décomposition plus fine, seulement un autre regroupement). Un Spelc dont
// tous les départements appartiennent à la même académie affiche cette académie
// directement ; le Spelc "Centre-Poitou-Charente" chevauche réellement deux
// académies (Poitiers et Orléans-Tours) et affiche donc les deux séparément.

export interface CcmDepartement {
  code: string | null;
  name: string;
  academies: string[];
}

export interface CcmSpelc {
  name: string;
  academies: string[];
}

export const CCM_2022_DEPARTEMENTS: CcmDepartement[] = [
  {
    "code": "01",
    "name": "Ain",
    "academies": [
      "Lyon"
    ]
  },
  {
    "code": "02",
    "name": "Aisne",
    "academies": [
      "Amiens"
    ]
  },
  {
    "code": "03",
    "name": "Allier",
    "academies": [
      "Clermont-Ferrand"
    ]
  },
  {
    "code": "04",
    "name": "Alpes-de-Haute-Provence",
    "academies": [
      "Aix-Marseille"
    ]
  },
  {
    "code": "05",
    "name": "Hautes-Alpes",
    "academies": [
      "Aix-Marseille"
    ]
  },
  {
    "code": "06",
    "name": "Alpes-Maritimes",
    "academies": [
      "Nice"
    ]
  },
  {
    "code": "07",
    "name": "Ardèche",
    "academies": [
      "Grenoble"
    ]
  },
  {
    "code": "08",
    "name": "Ardennes",
    "academies": [
      "Reims"
    ]
  },
  {
    "code": "09",
    "name": "Ariège",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "code": "10",
    "name": "Aube",
    "academies": [
      "Reims"
    ]
  },
  {
    "code": "11",
    "name": "Aude",
    "academies": [
      "Montpellier"
    ]
  },
  {
    "code": "12",
    "name": "Aveyron",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "code": "13",
    "name": "Bouches-du-Rhône",
    "academies": [
      "Aix-Marseille"
    ]
  },
  {
    "code": "14",
    "name": "Calvados",
    "academies": [
      "Normandie"
    ]
  },
  {
    "code": "15",
    "name": "Cantal",
    "academies": [
      "Clermont-Ferrand"
    ]
  },
  {
    "code": "16",
    "name": "Charente",
    "academies": [
      "Poitiers"
    ]
  },
  {
    "code": "17",
    "name": "Charente-Maritime",
    "academies": [
      "Poitiers"
    ]
  },
  {
    "code": "18",
    "name": "Cher",
    "academies": [
      "Orléans-Tours"
    ]
  },
  {
    "code": "19",
    "name": "Corrèze",
    "academies": [
      "Limoges"
    ]
  },
  {
    "code": "20",
    "name": "Corse",
    "academies": [
      "Corse"
    ]
  },
  {
    "code": "21",
    "name": "Côte-d'Or",
    "academies": [
      "Dijon"
    ]
  },
  {
    "code": "22",
    "name": "Côtes d'Armor",
    "academies": [
      "Rennes"
    ]
  },
  {
    "code": "23",
    "name": "Creuse",
    "academies": [
      "Limoges"
    ]
  },
  {
    "code": "24",
    "name": "Dordogne",
    "academies": [
      "Bordeaux"
    ]
  },
  {
    "code": "25",
    "name": "Doubs",
    "academies": [
      "Besançon"
    ]
  },
  {
    "code": "26",
    "name": "Drôme",
    "academies": [
      "Grenoble"
    ]
  },
  {
    "code": "27",
    "name": "Eure",
    "academies": [
      "Normandie"
    ]
  },
  {
    "code": "28",
    "name": "Eure-et-Loir",
    "academies": [
      "Orléans-Tours"
    ]
  },
  {
    "code": "29",
    "name": "Finistère",
    "academies": [
      "Rennes"
    ]
  },
  {
    "code": "30",
    "name": "Gard",
    "academies": [
      "Montpellier"
    ]
  },
  {
    "code": "31",
    "name": "Haute-Garonne",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "code": "32",
    "name": "Gers",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "code": "33",
    "name": "Gironde",
    "academies": [
      "Bordeaux"
    ]
  },
  {
    "code": "34",
    "name": "Hérault",
    "academies": [
      "Montpellier"
    ]
  },
  {
    "code": "35",
    "name": "Ille-et-Vilaine",
    "academies": [
      "Rennes"
    ]
  },
  {
    "code": "36",
    "name": "Indre",
    "academies": [
      "Orléans-Tours"
    ]
  },
  {
    "code": "37",
    "name": "Indre-et-Loire",
    "academies": [
      "Orléans-Tours"
    ]
  },
  {
    "code": "38",
    "name": "Isère",
    "academies": [
      "Grenoble"
    ]
  },
  {
    "code": "39",
    "name": "Jura",
    "academies": [
      "Besançon"
    ]
  },
  {
    "code": "40",
    "name": "Landes",
    "academies": [
      "Bordeaux"
    ]
  },
  {
    "code": "41",
    "name": "Loir-et-Cher",
    "academies": [
      "Orléans-Tours"
    ]
  },
  {
    "code": "42",
    "name": "Loire",
    "academies": [
      "Lyon"
    ]
  },
  {
    "code": "43",
    "name": "Haute-Loire",
    "academies": [
      "Clermont-Ferrand"
    ]
  },
  {
    "code": "44",
    "name": "Loire-Atlantique",
    "academies": [
      "Nantes"
    ]
  },
  {
    "code": "45",
    "name": "Loiret",
    "academies": [
      "Orléans-Tours"
    ]
  },
  {
    "code": "46",
    "name": "Lot",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "code": "47",
    "name": "Lot-et-Garonne",
    "academies": [
      "Bordeaux"
    ]
  },
  {
    "code": "48",
    "name": "Lozère",
    "academies": [
      "Montpellier"
    ]
  },
  {
    "code": "49",
    "name": "Maine-et-Loire",
    "academies": [
      "Nantes"
    ]
  },
  {
    "code": "50",
    "name": "Manche",
    "academies": [
      "Normandie"
    ]
  },
  {
    "code": "51",
    "name": "Marne",
    "academies": [
      "Reims"
    ]
  },
  {
    "code": "52",
    "name": "Haute-Marne",
    "academies": [
      "Reims"
    ]
  },
  {
    "code": "53",
    "name": "Mayenne",
    "academies": [
      "Nantes"
    ]
  },
  {
    "code": "54",
    "name": "Meurthe-et-Moselle",
    "academies": [
      "Nancy-Metz"
    ]
  },
  {
    "code": "55",
    "name": "Meuse",
    "academies": [
      "Nancy-Metz"
    ]
  },
  {
    "code": "56",
    "name": "Morbihan",
    "academies": [
      "Rennes"
    ]
  },
  {
    "code": "57",
    "name": "Moselle",
    "academies": [
      "Nancy-Metz"
    ]
  },
  {
    "code": "58",
    "name": "Nièvre",
    "academies": [
      "Dijon"
    ]
  },
  {
    "code": "59",
    "name": "Nord",
    "academies": [
      "Lille"
    ]
  },
  {
    "code": "60",
    "name": "Oise",
    "academies": [
      "Amiens"
    ]
  },
  {
    "code": "61",
    "name": "Orne",
    "academies": [
      "Normandie"
    ]
  },
  {
    "code": "62",
    "name": "Pas-de-Calais",
    "academies": [
      "Lille"
    ]
  },
  {
    "code": "63",
    "name": "Puy-de-Dôme",
    "academies": [
      "Clermont-Ferrand"
    ]
  },
  {
    "code": "64",
    "name": "Pyrénées-Atlantiques",
    "academies": [
      "Bordeaux"
    ]
  },
  {
    "code": "65",
    "name": "Hautes-Pyrénées",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "code": "66",
    "name": "Pyrénées-Orientales",
    "academies": [
      "Montpellier"
    ]
  },
  {
    "code": "67",
    "name": "Bas-Rhin",
    "academies": [
      "Strasbourg"
    ]
  },
  {
    "code": "68",
    "name": "Haut-Rhin",
    "academies": [
      "Strasbourg"
    ]
  },
  {
    "code": "69",
    "name": "Rhône",
    "academies": [
      "Lyon"
    ]
  },
  {
    "code": "70",
    "name": "Haute-Saône",
    "academies": [
      "Besançon"
    ]
  },
  {
    "code": "71",
    "name": "Saône-et-Loire",
    "academies": [
      "Dijon"
    ]
  },
  {
    "code": "72",
    "name": "Sarthe",
    "academies": [
      "Nantes"
    ]
  },
  {
    "code": "73",
    "name": "Savoie",
    "academies": [
      "Grenoble"
    ]
  },
  {
    "code": "74",
    "name": "Haute-Savoie",
    "academies": [
      "Grenoble"
    ]
  },
  {
    "code": "75",
    "name": "Paris",
    "academies": [
      "Paris"
    ]
  },
  {
    "code": "76",
    "name": "Seine-Maritime",
    "academies": [
      "Normandie"
    ]
  },
  {
    "code": "77",
    "name": "Seine-et-Marne",
    "academies": [
      "Créteil"
    ]
  },
  {
    "code": "78",
    "name": "Yvelines",
    "academies": [
      "Versailles"
    ]
  },
  {
    "code": "79",
    "name": "Deux-Sèvres",
    "academies": [
      "Poitiers"
    ]
  },
  {
    "code": "80",
    "name": "Somme",
    "academies": [
      "Amiens"
    ]
  },
  {
    "code": "81",
    "name": "Tarn",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "code": "82",
    "name": "Tarn-et-Garonne",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "code": "83",
    "name": "Var",
    "academies": [
      "Nice"
    ]
  },
  {
    "code": "84",
    "name": "Vaucluse",
    "academies": [
      "Aix-Marseille"
    ]
  },
  {
    "code": "85",
    "name": "Vendée",
    "academies": [
      "Nantes"
    ]
  },
  {
    "code": "86",
    "name": "Vienne",
    "academies": [
      "Poitiers"
    ]
  },
  {
    "code": "87",
    "name": "Haute-Vienne",
    "academies": [
      "Limoges"
    ]
  },
  {
    "code": "88",
    "name": "Vosges",
    "academies": [
      "Nancy-Metz"
    ]
  },
  {
    "code": "89",
    "name": "Yonne",
    "academies": [
      "Dijon"
    ]
  },
  {
    "code": "90",
    "name": "Territoire-de-Belfort",
    "academies": [
      "Besançon"
    ]
  },
  {
    "code": "91",
    "name": "Essonne",
    "academies": [
      "Versailles"
    ]
  },
  {
    "code": "92",
    "name": "Hauts-de-Seine",
    "academies": [
      "Versailles"
    ]
  },
  {
    "code": "93",
    "name": "Seine-Saint-Denis",
    "academies": [
      "Créteil"
    ]
  },
  {
    "code": "94",
    "name": "Val-de-Marne",
    "academies": [
      "Créteil"
    ]
  },
  {
    "code": "95",
    "name": "Val-D'Oise",
    "academies": [
      "Versailles"
    ]
  },
  {
    "code": null,
    "name": "Guadeloupe",
    "academies": [
      "Guadeloupe"
    ]
  },
  {
    "code": null,
    "name": "Guyane",
    "academies": [
      "Guyane"
    ]
  },
  {
    "code": null,
    "name": "La Réunion",
    "academies": [
      "La Réunion"
    ]
  },
  {
    "code": null,
    "name": "Martinique",
    "academies": [
      "Martinique"
    ]
  },
  {
    "code": null,
    "name": "Mayotte",
    "academies": [
      "Mayotte"
    ]
  },
  {
    "code": null,
    "name": "Nouvelle Calédonie",
    "academies": [
      "Nouvelle Calédonie"
    ]
  },
  {
    "code": null,
    "name": "Polynésie française",
    "academies": [
      "Polynésie française"
    ]
  },
  {
    "code": null,
    "name": "St-Pierre-et-Miquelon",
    "academies": [
      "St-Pierre-et-Miquelon"
    ]
  }
];

export const CCM_2022_SPELCS: CcmSpelc[] = [
  {
    "name": "Ain-Loire-Rhône",
    "academies": [
      "Lyon"
    ]
  },
  {
    "name": "Antilles",
    "academies": [
      "Guadeloupe"
    ]
  },
  {
    "name": "Auvergne",
    "academies": [
      "Clermont-Ferrand"
    ]
  },
  {
    "name": "Bas-Rhin",
    "academies": [
      "Strasbourg"
    ]
  },
  {
    "name": "Basse-Normandie",
    "academies": [
      "Normandie"
    ]
  },
  {
    "name": "Bourgogne",
    "academies": [
      "Dijon"
    ]
  },
  {
    "name": "Centre-Poitou-Charente",
    "academies": [
      "Orléans-Tours",
      "Poitiers"
    ]
  },
  {
    "name": "Champagne-Ardenne",
    "academies": [
      "Reims"
    ]
  },
  {
    "name": "Créteil",
    "academies": [
      "Créteil"
    ]
  },
  {
    "name": "Côte d'Azur",
    "academies": [
      "Nice"
    ]
  },
  {
    "name": "Côtes-d'Armor",
    "academies": [
      "Rennes"
    ]
  },
  {
    "name": "Dordogne",
    "academies": [
      "Bordeaux"
    ]
  },
  {
    "name": "Finistère",
    "academies": [
      "Rennes"
    ]
  },
  {
    "name": "Franche-Comté",
    "academies": [
      "Besançon"
    ]
  },
  {
    "name": "Gironde",
    "academies": [
      "Bordeaux"
    ]
  },
  {
    "name": "Guadeloupe",
    "academies": [
      "Guadeloupe"
    ]
  },
  {
    "name": "Guyane",
    "academies": [
      "Guyane"
    ]
  },
  {
    "name": "Haut-Rhin",
    "academies": [
      "Strasbourg"
    ]
  },
  {
    "name": "Haute-Garonne Ariège Gers",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "name": "Haute-Normandie",
    "academies": [
      "Normandie"
    ]
  },
  {
    "name": "Haute-Savoie",
    "academies": [
      "Grenoble"
    ]
  },
  {
    "name": "Hautes-Pyrénées",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "name": "Ille-et-Vilaine",
    "academies": [
      "Rennes"
    ]
  },
  {
    "name": "La Réunion",
    "academies": [
      "La Réunion"
    ]
  },
  {
    "name": "Landes",
    "academies": [
      "Bordeaux"
    ]
  },
  {
    "name": "Languedoc-Roussillon",
    "academies": [
      "Montpellier"
    ]
  },
  {
    "name": "Limousin",
    "academies": [
      "Limoges"
    ]
  },
  {
    "name": "Lorraine",
    "academies": [
      "Nancy-Metz"
    ]
  },
  {
    "name": "Lot-et-Garonne",
    "academies": [
      "Bordeaux"
    ]
  },
  {
    "name": "Martinique",
    "academies": [
      "Martinique"
    ]
  },
  {
    "name": "Morbihan",
    "academies": [
      "Rennes"
    ]
  },
  {
    "name": "Nord et Pas-de-Calais",
    "academies": [
      "Lille"
    ]
  },
  {
    "name": "Paris",
    "academies": [
      "Paris"
    ]
  },
  {
    "name": "Pays-de-la-Loire",
    "academies": [
      "Nantes"
    ]
  },
  {
    "name": "Picardie",
    "academies": [
      "Amiens"
    ]
  },
  {
    "name": "Provence-Alpes",
    "academies": [
      "Aix-Marseille"
    ]
  },
  {
    "name": "Pyrénées-Atlantiques",
    "academies": [
      "Bordeaux"
    ]
  },
  {
    "name": "Quercy-Rouergue",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "name": "Tarn",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "name": "Tarn-et-Garonne",
    "academies": [
      "Toulouse"
    ]
  },
  {
    "name": "Versailles",
    "academies": [
      "Versailles"
    ]
  }
];
