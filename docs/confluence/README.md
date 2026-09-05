# Confluence space — page index

This file lists every page published to the DistributionOS Confluence space (space key `Distributi`, cloud id `b00e7c53-329a-452f-ae4a-c54b5c1748e7`) from this repository's `docs/confluence/` source files, as of the 2026-09-05 PM rewrite.

**The rule: edit the file, then republish; `docs/22-source-of-truth.md` wins.** Every page below is a mirror of its source markdown file in this directory, which is itself a mirror of the repository's single source of truth. Never edit a Confluence page directly in the browser as the permanent record — edit the `.md` file here, then republish it with `updateConfluencePage` (existing pages) so the two stay identical. Where a Confluence page and `docs/22-source-of-truth.md` disagree, the repository wins and the page must be corrected.

## Existing pages (updated in place, PM rewrite 2026-09-05)

| Title                             | Page ID | URL                                                                                                       | Source file                            |
| --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| DistributionOS Home               | 295181  | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/overview                                     | `docs/confluence/space-overview.md`    |
| Distribution OS — Product Home    | 1277953 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1277953/Distribution+OS+Product+Home   | `docs/confluence/home.md`              |
| Vision                            | 1048577 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1048577/Vision                         | `docs/confluence/vision.md`            |
| Mission                           | 1605635 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1605635/Mission                        | `docs/confluence/mission.md`           |
| Goals                             | 1212417 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1212417/Goals                          | `docs/confluence/goals.md`             |
| Problem Statement                 | 1081345 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1081345/Problem+Statement              | `docs/confluence/problem-statement.md` |
| Pain Point Analysis               | 2097154 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/2097154/Pain+Point+Analysis            | `docs/confluence/pain-points.md`       |
| Success Metrics (KPIs)            | 1802241 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1802241/Success+Metrics+KPIs           | `docs/confluence/kpis.md`              |
| Product Principles                | 1900545 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1900545/Product+Principles             | `docs/confluence/principles.md`        |
| Personas                          | 1966081 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1966081/Personas                       | `docs/confluence/personas.md`          |
| Target Market & Customer Segments | 786434  | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/786434/Target+Market+Customer+Segments | `docs/confluence/target-market.md`     |
| AS-IS Business Process            | 1736714 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1736714/AS-IS+Business+Process         | `docs/confluence/as-is.md`             |
| TO-BE Business Process            | 1441794 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1441794/TO-BE+Business+Process         | `docs/confluence/to-be.md`             |

Two titles were renamed in this pass: "Home 0.1" → "Distribution OS — Product Home" (id 1277953), and "Target Market & Customer Segments." (trailing period) → "Target Market & Customer Segments" (id 786434).

## New pages (created under the hub page, id 1277953)

| Title                          | Page ID  | URL                                                                                                     | Source file                                 |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Architecture & Technology      | 10518600 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10518600/Architecture+Technology     | `docs/confluence/architecture.md`           |
| Seven Apps & Workflows         | 10453020 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453020/Seven+Apps+Workflows        | `docs/confluence/apps-and-workflows.md`     |
| Decisions Log                  | 10518639 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10518639/Decisions+Log               | `docs/confluence/decisions-log.md`          |
| Build Status & Roadmap         | 10485781 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10485781/Build+Status+Roadmap        | `docs/confluence/build-status-roadmap.md`   |
| Data, Security & Multi-tenancy | 10321935 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10321935/Data+Security+Multi-tenancy | `docs/confluence/data-security-tenancy.md`  |
| Integrations & Data Migration  | 10453040 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453040/Integrations+Data+Migration | `docs/confluence/integrations-migration.md` |
| Design System & Brand          | 10453060 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453060/Design+System+Brand         | `docs/confluence/design-and-brand.md`       |
| Phase 2 & Future Enhancements  | 10420246 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10420246/Phase+2+Future+Enhancements | `docs/confluence/phase-2-enhancements.md`   |
| Open Questions & Risks         | 10321956 | https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10321956/Open+Questions+Risks        | `docs/confluence/open-questions-risks.md`   |

All 22 pages were verified after publishing: title, first heading and last line of the source file were confirmed present in the page body read back via `getConfluencePage`.

## Keeping this space true

1. `docs/22-source-of-truth.md` in the repository is the single source of truth for product shape and founder decisions. This Confluence space, and every file in `docs/confluence/`, mirrors it.
2. To change a page: edit the corresponding `.md` file in this directory first, then republish it — `updateConfluencePage` (with `contentFormat: "markdown"`) for one of the 13 existing pages above, keyed by its page ID, or `createConfluencePage` only for a page that has never been published.
3. After every publish, read the page back with `getConfluencePage` (`contentFormat: "markdown"`) and confirm the title, the first heading and the last line of the source file are all present in the returned body.
4. If a distributor-facing rule changes in the repository (a new "Decided" line in `docs/22-source-of-truth.md` §8, or a §9 non-negotiable), the matching Confluence page(s) — most often Decisions Log, Build Status & Roadmap, and whichever page states that rule — must be updated in the same pass, not left to drift.
5. `docs/18-build-log.md` changes hourly; any build-status number quoted on a Confluence page (module count, test count, endpoint-call count) is a snapshot and should be re-synced from that file rather than incremented by hand.
