"""Bloomberg persona: screen-recording demo of a Bloomberg Trading EMS."""

from __future__ import annotations

from reactor_video.spec import Persona, Task, TaskKind

GCS_URI = "gs://meghdoot-artifacts/video_analysis/Bloomberg_trading_EMS.mov"

SUMMARIZATION_PROMPT = """
    You are an expert financial technology analyst and quantitative trading systems architect evaluating a screen recording demo of a Bloomberg Trading Execution Management System (EMS).

    Perform an in-depth, rigorous video-to-summarization analysis of the video. Structure your output clearly into the following detailed sections:

    1. EXECUTIVE SUMMARY & OVERVIEW
       - Primary objective and context of the recording.
       - High-level overview of the Bloomberg EMS workflow shown.

    2. STEP-BY-STEP TIMELINE & ACTION BREAKDOWN
       - Chronological breakdown of events/actions occurring in the video with approximate timestamps.
       - Key user interactions, mouse navigations, menu selections, and order actions.

    3. KEY EMS FEATURES & CAPABILITIES DEMONSTRATED
       - Execution Management System features (e.g. Order Routing, Blotter Management, Market Data Feeds, Algorithmic Execution, Multi-Asset Trading, Compliance & Risk checks).
       - Specific Bloomberg EMS tools, dialogs, and workspace configurations visible.

    4. USER INTERFACE & DATA COMPONENT ANALYSIS
       - Detailed breakdown of visible UI windows, ticker tickers, price feeds, order tickets, execution status monitors, and analytics widgets.
       - Data metrics, order details, financial instruments, and prices shown.

    5. TECHNICAL & STRATEGIC OBSERVATIONS
       - Assessment of system speed, UI layout efficiency, and trading workflow integration.
       - Key takeaways and practical applications for financial trading workflows.
    """

PERSONA = Persona(
    key="bloomberg",
    title="Bloomberg Trading EMS",
    description=(
        "Screen-recording demo of a Bloomberg Trading Execution Management "
        "System (EMS): order routing, blotter, market data, and execution "
        "workflow. Produces a full video-to-summarization analysis."
    ),
    gcs_uri=GCS_URI,
    mime_type="video/quicktime",
    models=("gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash"),
    tasks=(
        Task(
            name="Video Summarization Analysis",
            prompt=SUMMARIZATION_PROMPT,
            output_filename="video_summarization_analysis.md",
            kind=TaskKind.MARKDOWN,
            temperature=0.2,
            max_output_tokens=8192,
        ),
    ),
)
