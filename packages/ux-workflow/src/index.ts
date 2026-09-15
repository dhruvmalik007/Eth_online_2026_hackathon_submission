// Design tokens
export { colors, typography, spacing, motion } from "./tokens/colors.js";

// Utilities
export { cn } from "./lib/utils.js";

// Primitives (real shadcn/ui, re-themed to Terminal Noir)
export { Button, buttonVariants } from "./primitives/button.js";
export { Badge, badgeVariants } from "./primitives/badge.js";
export { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from "./primitives/card.js";
export { Separator } from "./primitives/separator.js";
export { Skeleton } from "./primitives/skeleton.js";
export { Input } from "./primitives/input.js";
export { Label, labelVariants } from "./primitives/label.js";
export { Textarea } from "./primitives/textarea.js";
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./primitives/tooltip.js";
export { HoverCard, HoverCardTrigger, HoverCardContent } from "./primitives/hover-card.js";
export { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./primitives/accordion.js";
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./primitives/collapsible.js";
export { ScrollArea, ScrollBar } from "./primitives/scroll-area.js";
export { Progress } from "./primitives/progress.js";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./primitives/tabs.js";
export { Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "./primitives/dialog.js";
export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton } from "./primitives/select.js";
export { Switch } from "./primitives/switch.js";
export { Slider } from "./primitives/slider.js";
export { Avatar, AvatarImage, AvatarFallback } from "./primitives/avatar.js";
export { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption } from "./primitives/table.js";

// Chart (shadcn/ui Chart wrapping Recharts, Terminal Noir themed)
export {
  ChartContainer,
  ChartTooltip,
  ChartLegend,
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  RechartsTooltip,
  XAxis,
  YAxis,
  ComposedChart,
  type ChartConfig,
} from "./primitives/chart.js";

// AI components (Vercel AI SDK patterns)
export { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "./ai/conversation.js";
export { Message, MessageContent, MessageResponse } from "./ai/message.js";
export { Reasoning } from "./ai/reasoning.js";
export { ToolCall, ToolResult } from "./ai/tool-call.js";
export { Citation } from "./ai/citation.js";
export { PromptInput, PromptInputTextarea, PromptInputSubmit } from "./ai/prompt-input.js";
export { TypingIndicator } from "./ai/typing-indicator.js";
export { CodeBlock } from "./ai/code-block.js";

// AI Forecasting components (TimesFM-3, built on shadcn Chart)
export {
  ForecastChart,
  type ForecastPoint,
  type ForecastTarget,
  type ForecastChartProps,
} from "./ai/forecast-chart.js";
export { BacktestResult } from "./ai/backtest-result.js";
export { MacroVariableCard } from "./ai/macro-variable-card.js";
export { CovariateTimeline } from "./ai/covariate-timeline.js";

// AI Fine-Tuning components (hf-llm-trainer black-box pattern)
export { FineTuningPanel } from "./ai/fine-tuning-panel.js";
export { FineTuningProgress } from "./ai/fine-tuning-progress.js";
export { ModelComparison } from "./ai/model-comparison.js";
export { ModelRegistry } from "./ai/model-registry.js";

// AI Observability components (LangSmith + TimescaleDB)
export { ObservabilityDashboard } from "./ai/observability-dashboard.js";
export { TraceViewer } from "./ai/trace-viewer.js";
export { MetricsTimeline } from "./ai/metrics-timeline.js";
export { AlertFeed } from "./ai/alert-feed.js";

// Flow diagram — the generic node/edge canvas the desk's income Sankey is built on
export {
  FlowDiagram,
  assignColumns,
  accentOf,
  formatValue,
  ACCENT_BADGE,
  type FlowDiagramProps,
  type FlowNode,
  type FlowEdge,
  type FlowTone,
  type FlowAccent,
  type FlowMetric,
  type FlowLegendItem,
} from "./data/flow-diagram.js";

// Data visualization primitives
export { Sparkline } from "./data/sparkline.js";
export { BarTick } from "./data/bar-tick.js";
export { HeatCell } from "./data/heat-cell.js";
export { StatTile } from "./data/stat-tile.js";

// Trading desk components (built on shadcn Card, Table, Progress, Badge)
export { SessionClock } from "./desk/session-clock.js";
export { PositionCard } from "./desk/position-card.js";
export { AllocationBar } from "./desk/allocation-bar.js";
export { ConstraintMeter } from "./desk/constraint-meter.js";
export { RiskGate } from "./desk/risk-gate.js";
export { LiquidityFlowRoadmap } from "./desk/liquidity-flow.js";
export type {
  LiquidityFlowRoadmapProps,
  LiquidityFlowNode,
  LiquidityFlowEdge,
  LiquidityFlowTone,
  LiquidityFlowAccent,
  LiquidityFlowMetric,
  LiquidityFlowLegendItem,
} from "./desk/liquidity-flow.js";

// Execution (intent → clear-signed batch → live multi-leg progress)
export {
  StepPill,
  stepStateLabel,
  isTerminal,
  STATE_DOT,
} from "./execution/step-pill.js";
export type { ExecutionStepState, StepPillProps } from "./execution/step-pill.js";
export { FeeWaterfall } from "./execution/fee-waterfall.js";
export type { FeeWaterfallProps, FeeLegView, FeeLineView } from "./execution/fee-waterfall.js";
export { ExecutionTimeline } from "./execution/execution-timeline.js";
export type {
  ExecutionTimelineProps,
  ExecutionStepView,
  ExecutionTracking,
} from "./execution/execution-timeline.js";
export { IntentReview } from "./execution/intent-review.js";
export type { IntentReviewProps, ReviewLeg, ReviewConstraint } from "./execution/intent-review.js";
export { ExecutionReceipt } from "./execution/execution-receipt.js";
export type {
  ExecutionReceiptProps,
  ReceiptLegResult,
} from "./execution/execution-receipt.js";

// Agent traces (what the agents did: why, what they ingested, what they produced)
export { AgentTraceGroup } from "./agent/agent-trace.js";
export type { AgentTraceGroupProps } from "./agent/agent-trace.js";
export { AgentStepDetail } from "./agent/agent-step-detail.js";
export type {
  AgentStep,
  AgentStepResult,
  AgentStepEvidenceRow,
  AgentStepMetric,
  AgentStepCheck,
} from "./agent/agent-step-detail.js";
export { SeriesPreview, SeriesSpark } from "./agent/series-preview.js";
export type { SeriesPreviewProps } from "./agent/series-preview.js";
export { StepGlyph, agentStepStateLabel } from "./agent/step-glyph.js";
export type { AgentStepState, StepGlyphProps } from "./agent/step-glyph.js";
export {
  AquaFlightPanel,
  formatEfficiency,
  type AquaEnablementAssessment,
  type AquaFlightPanelProps,
  type AquaFlightStep,
  type AquaRecommendation,
} from "./execution/aqua-flight-panel.js";
export {
  RiskNoticeCard,
  formatMetric,
  type RiskFactorView,
  type RiskMetricView,
  type RiskNoticeCardProps,
  type RiskNoticeLevel,
  type RiskNoticeView,
} from "./execution/risk-notice-card.js";
