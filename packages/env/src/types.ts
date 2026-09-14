/**
 * The vocabulary of the environment catalog.
 *
 * An environment is one of three lanes — there is deliberately no `test` or `preview` lane. CI runs
 * with {@link Environment} `local` against a containerised database, and a pull request is exercised
 * on `staging`. Fewer lanes means fewer places for a value to be wrong.
 */
export const ENVIRONMENTS = ["local", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Every deployable unit that reads configuration. `shared` is read by all of them. */
export const SERVICES = [
  "shared",
  "execution",
  "inference",
  "indexer",
  "agentic-ems",
  "langchain",
  "custody",
  "the-graph",
  "timeseries",
  "bridges",
  "arc",
  "oneinch",
  "risk",
  "fork-execution",
] as const;
export type Service = (typeof SERVICES)[number];

/** How a value is checked once it is present. `string` means "any non-empty value". */
export const FORMATS = [
  "string",
  "url",
  "dsn",
  "port",
  "flag",
  "number",
  "csv",
  "enum",
  "json",
  "path",
] as const;
export type EnvFormat = (typeof FORMATS)[number];

/** One variable, described once and reused for validation, docs and CI. */
export interface EnvVarSpec {
  readonly name: string;
  readonly description: string;
  /** Services that read it. A variable is only checked for a service that lists it. */
  readonly services: readonly Service[];
  /** Environments in which it must be present. Empty means optional everywhere. */
  readonly requiredIn: readonly Environment[];
  /** True when the value must never be printed or committed. */
  readonly secret: boolean;
  readonly format: EnvFormat;
  /** Permitted values, for `format: "enum"`. */
  readonly allowed?: readonly string[];
  readonly default?: string;
  /** A safe, non-secret sample value for `.env.example`. */
  readonly example?: string;
}
