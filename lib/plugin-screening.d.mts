// Type declarations for lib/plugin-screening.mjs (kept in sync with the .mjs source).

export const LIFECYCLE_SCRIPTS: string[];
export const LOCKFILES: Set<string>;

export type ScreeningCategoryId =
  | "ui" | "theme" | "model" | "session" | "memory"
  | "tools" | "skill" | "workflow" | "notify" | "dev" | "market" | "fun";

export interface ScreeningManifest {
  state: "verified" | "package-only" | "missing" | "invalid" | "error";
  branch: string | null;
  kinds: string[];
  packageName: string | null;
  version: string | null;
  lifecycleScripts: string[];
  runtimeDependencies: number;
  declaredPaths: string[];
  invalidDeclaredPaths: string[];
}

export interface ScreeningFacts {
  hasManifest: boolean;
  hasLockfile: boolean;
  hasLicense: boolean;
  hasReadme: boolean;
  lifecycleScripts: string[];
}

export const CATEGORY_RULES: Record<ScreeningCategoryId, RegExp>;

export function normalizeRepositoryPath(value: unknown): string | null;
export function manifestSummary(pkg: unknown, branch: string | null): ScreeningManifest;
export function deriveFacts(manifest: ScreeningManifest, meta?: unknown): ScreeningFacts;
export function installCommandFor(repo: string): string | null;
export function npmInstallCommandFor(packageName: string | null): string | null;
export function sanitizeRegistryInstallEvidence<T>(registry: T): T;
export function categoryFromText(value: unknown): ScreeningCategoryId;
