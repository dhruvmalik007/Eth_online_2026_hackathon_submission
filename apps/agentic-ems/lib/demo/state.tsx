"use client";

import * as React from "react";
import type { ExecutionRecord } from "../execution/types";
import type { DemoState, QuestionnaireAnswers } from "./data";
import type { AgentMandate } from "../execution/mandates";

const STORAGE_KEY = "ems-demo-state-v1";

const initialState: DemoState = {
  stage: "sso",
  email: "",
  answers: null,
  wallet: null,
  approved: [],
  mandates: {},
  executions: [],
  simulated: false,
};

type Action =
  | { type: "set-stage"; stage: DemoState["stage"] }
  | { type: "set-email"; email: string }
  | { type: "set-answers"; answers: QuestionnaireAnswers }
  | { type: "set-wallet"; wallet: NonNullable<DemoState["wallet"]> }
  | { type: "approve"; id: string }
  | { type: "set-mandate"; agent: string; mandate: AgentMandate }
  | { type: "record-execution"; record: ExecutionRecord }
  | { type: "set-simulated"; simulated: boolean }
  | { type: "sign-out" }
  | { type: "restart" };

function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case "set-stage":
      return { ...state, stage: action.stage };
    case "set-email":
      return { ...state, email: action.email };
    case "set-answers":
      return { ...state, answers: action.answers };
    case "set-wallet":
      return { ...state, wallet: action.wallet };
    case "approve":
      return state.approved.includes(action.id)
        ? state
        : { ...state, approved: [...state.approved, action.id] };
    case "set-mandate":
      // Replace rather than merge: a partial write could leave an old limit beside a new approval flag.
      return { ...state, mandates: { ...state.mandates, [action.agent]: action.mandate } };
    case "set-simulated":
      return { ...state, simulated: action.simulated };
    case "record-execution":
      // Dedupe by plan id: a re-rendered execution must not append twice.
      return state.executions.some((record) => record.id === action.record.id)
        ? state
        : { ...state, executions: [action.record, ...state.executions] };
    case "sign-out":
      // Clears the authenticated session's local state but keeps the trader's
      // questionnaire answers, so signing back in resumes at the desk.
      return { ...state, stage: "sso", email: "", wallet: null, approved: [] };
    case "restart":
      return { ...initialState };
  }
}

interface DemoContextValue {
  state: DemoState;
  dispatch: React.Dispatch<Action>;
}

const DemoContext = React.createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, initialState, (init) => {
    if (typeof window === "undefined") return init;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return { ...init, ...JSON.parse(raw) } as DemoState;
    } catch {}
    return init;
  });

  React.useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  const value = React.useMemo(() => ({ state, dispatch }), [state]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoContextValue {
  const ctx = React.useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used within DemoProvider");
  return ctx;
}
