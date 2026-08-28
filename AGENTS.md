# Repository Guidelines

## Subagent Defaults
- When using subagents, default the delegated model to `gpt-5.4-mini` unless a stronger model is explicitly required by the task.

## Project Structure & Source of Truth
This repository is a static mock development workspace for SPEED AD. The main working areas are `02_dashboard/` for user-facing screens, `03_admin/` for admin screens, `04_first-login/` for the first-login tutorial flow, `data/` for mock JSON, and `docs/` for project documentation.

- Start dashboard work from `02_dashboard/index.html`.
- Start admin work from `03_admin/index.html`.
- Start first-login flow checks from `04_first-login/index.html`.
- Treat `docs/` as the canonical location for specifications, process notes, and templates.
- Treat `docs/legacy-要件定義/` as an externalized legacy index only; new or revised specs should go to `docs/画面設計/仕様/` (admin-screen specs: `docs/リライト版仕様書/admin/`).
- Use `docs/リファレンス/共有規約/02_SHARED_DOC_BOUNDARY_RULES.md` as the source of truth for whether a document belongs in the shared repo or private management.

## Implementation Boundaries
- Put dashboard business logic in `02_dashboard/src/services/`.
- Put dashboard DOM rendering and interaction helpers in `02_dashboard/src/ui/`.
- Share dashboard cross-cutting helpers through `02_dashboard/src/utils.js`.
- Put admin page scripts in `03_admin/src/` and admin shared HTML fragments in `03_admin/common/`.
- Keep reusable dashboard HTML fragments in `02_dashboard/common/`.
- Keep mock datasets under the repository-root `data/` directory as the source of truth.

## Shared Frontend Rules
- Common headers, sidebars, and footers should be loaded from `02_dashboard/common/` or `03_admin/common/` via `loadCommonHtml(...)`.
- When a page lives in a nested directory, verify relative common asset resolution and use `window.__COMMON_BASE_PATH` only when the standard structure is not enough.
- Dashboard-side JSON access should use `resolveDashboardDataPath(...)` instead of hard-coded relative paths.
- Follow the existing standard choices for interactive controls: `flatpickr` for date inputs and `Sortable.js` for drag-and-drop ordering.
- Keep business logic out of HTML files when a screen already has a script module.

## Build, Run, and Verification
- `python -m http.server 8000` serves the repository root. Main checks are `http://localhost:8000/02_dashboard/index.html`, `http://localhost:8000/03_admin/index.html`, and `http://localhost:8000/04_first-login/index.html`.
- `npx serve .` is an acceptable alternative for static serving.
- There is no root build pipeline or required npm script flow. Refreshing the browser reflects file changes directly.
- Before starting implementation, review `docs/README.md`, the relevant spec under `docs/画面設計/仕様/` (or `docs/リライト版仕様書/admin/` for admin screens), and any shared handbook/reference docs needed for the task.

## Coding Style & Documentation Expectations
- Use ES modules, 2-space indentation, trailing semicolons, and single quotes.
- Use camelCase for variables and functions, PascalCase for classes, and lowerCamelCase for filenames such as `tableManager.js`.
- Keep service-layer concerns separate from UI-layer concerns.
- Align new UI patterns and interaction behavior with `docs/リファレンス/共有規約/01_SHARED_CODING_STANDARDS.md`.
- For AI-facing responsibility boundaries, use `docs/リファレンス/共有規約/04_AI_RESPONSIBILITY_BOUNDARY.md` as the shared reference.
- If implementation changes behavior, update the corresponding documentation in `docs/` within the same workstream.
- For new or revised specifications, prefer `docs/画面設計/仕様/` (admin screens: `docs/リライト版仕様書/admin/`). Internal product policy and business planning docs are managed outside the shared repo.

## AI Responsibility Notes
- Treat `docs/画面設計/仕様/` (service screens) and `docs/リライト版仕様書/admin/` (admin screens) as the source of truth for UI experience, copy, display conditions, and user guidance.
- Treat save, API, authz, and data-integrity rules as server-side concerns that must stand independently of UI gating.
- When an operation flow requires assignment, reassignment, status transitions, or operator handling, capture the implementation-ready rule in shared docs instead of relying on private notes.
- Do not store raw organization structure, personnel details, or meeting rationale in this repo.
- Use this file only as a navigation aid; responsibility-boundary details live in `docs/リファレンス/共有規約/04_AI_RESPONSIBILITY_BOUNDARY.md`.

## Testing Guidelines
- Automated tests are not yet the primary workflow; manual verification is required.
- Minimum browser coverage is Chrome, Firefox, and Edge. Safari should be checked when a macOS environment is available or the change is browser-sensitive.
- Confirm that data loads correctly from `data/*.json` through services into the rendered UI.
- Keep the browser console free of errors and verify that network requests for mock JSON resolve successfully.
- Check the main user flow affected by the change, including screen transitions and modal behavior where relevant.
- Verify responsive behavior at representative desktop, tablet, and mobile widths.
- Use `docs/ハンドブック/テスト/03_TESTING_GUIDELINES.md` as the detailed manual test baseline.

## Commit, PR, and Change Hygiene
- Use Conventional Commit prefixes such as `feat:`, `fix:`, and `chore:`.
- Keep commit subjects concise and describe notable changes in the body when needed.
- Pull requests should list affected areas, link the related spec or issue, and note any updated documentation.
- UI changes should include screenshots or equivalent visual evidence.
- PR descriptions should record the manual tests performed, including browsers checked and major scenarios covered.

## Security & Configuration
- Never commit secrets or real production credentials.
- Treat `data/*.json` as mock fixtures, not production data.
- Keep future production endpoints configurable rather than hard-coded.
- Document any new third-party dependency and the reason it was introduced in the PR summary.
