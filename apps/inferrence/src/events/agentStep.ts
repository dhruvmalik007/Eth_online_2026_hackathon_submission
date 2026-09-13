/**
 * The agent-step wire type.
 *
 * `AgentStep` is the render contract owned by `@ethonline2026/ux-workflow` — the
 * demo's `AgentTraceGroup` renders it. It is re-exported here so this service has
 * exactly one file that depends on the UI package, and the compiler catches
 * contract drift the moment `ux-workflow` adds a required field.
 *
 * Type-only: nothing from the React package is loaded at runtime.
 */
export type {
  AgentStep,
  AgentStepState,
  AgentStepResult,
  AgentStepEvidenceRow,
  AgentStepMetric,
  AgentStepCheck,
} from "@ethonline2026/ux-workflow";
