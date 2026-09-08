---
description: Run one Distribution OS QA phase
argument-hint: "[phase number, or blank to resume]"
---

You are working the Distribution OS QA programme.

1. Read QA/CHARTER.md in full. Follow it for this entire session.
2. Read QA/STATE.md.
3. Phase = $ARGUMENTS if given, else the Current phase in STATE.md.
4. Grep to that phase's heading in QA/PHASES.md and read only that section.
5. If Stage is 1, never run a Stage 2 phase. If an open P0 from an earlier
   phase would invalidate this phase's results, say so and stop.
6. Run the phase. Stage 1 phases mean operating the running app and
   screenshotting, not reading code. Use subagents for broad codebase
   search. Findings to QA/findings/, evidence to QA/evidence/.
7. Before ending the turn: update QA/STATE.md, then output the status block
   from Charter A.9 and nothing longer.
8. If the phase is complete, end with:
   "Phase N complete. Run /clear, then /qa to continue."

Do not change product behaviour without approval. Do not skip ahead.
Do not report anything you did not execute.
