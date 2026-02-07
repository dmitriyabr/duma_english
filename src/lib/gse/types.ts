export type GseNodeType = "GSE_LO" | "GSE_VOCAB" | "GSE_GRAMMAR";

export type GseAudience = "YL" | "AL" | "AE" | "PE";

export type GseSkill =
  | "speaking"
  | "listening"
  | "reading"
  | "writing"
  | "grammar"
  | "vocabulary";

export type GseSource = "official" | "github_derived" | "bootstrap";

export type GseRawNode = {
  type: GseNodeType;
  catalog: string;
  sourceKey: string;
  descriptor: string;
  gseMin?: number | null;
  gseMax?: number | null;
  gseCenter?: number | null;
  cefrBand?: string | null;
  audience?: GseAudience | null;
  skill?: GseSkill | null;
  source: GseSource;
  sourceVersion?: string | null;
  licenseTag?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type GithubDerivedVocabRow = {
  word: string;
  gse: number;
  cefr?: string | null;
  topics?: string[] | null;
  categories?: string[] | null;
};

export type GithubCatalogSource = {
  repo: string;
  ref?: string;
  includeToolkitBootstrap?: boolean;
  maxFiles?: number;
};

export type GseCatalogRefreshInput = {
  version?: string;
  description?: string;
  sourceVersion?: string;
  officialRows?: GseRawNode[];
  githubVocabRows?: GithubDerivedVocabRow[];
  githubSources?: GithubCatalogSource[];
  officialCsv?: string;
  officialXlsxBase64?: string;
  officialPdfBase64?: string;
};

export type GseNodeCandidate = {
  nodeId: string;
  sourceKey: string;
  descriptor: string;
  type: GseNodeType;
  skill: string | null;
  audience: string | null;
  gseCenter: number | null;
};
