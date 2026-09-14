import { serverEnv } from "@/lib/env";
import type { Metadata } from "next";
import { FastH3App } from "../FastH3App";
import { SetupRequired } from "../SetupRequired";

export const metadata: Metadata = {
  title: "Video Studio — Agentic EMS",
  description:
    "FastH3 episode studio: compose the Agentic EMS pitch video as chained, continuous scenes.",
};

export const dynamic = "force-dynamic";

export default function StudioPage() {
  return serverEnv().REACTOR_API_KEY ? <FastH3App /> : <SetupRequired />;
}
