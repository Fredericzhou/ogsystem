# OGSystem Visualizer Product Usability Gate Follow-up

Date: 2026-05-05

## Scope

This follow-up records the small, user-visible Visualizer usability pass described in the next-step plan:

- keep browser smoke as a release gate;
- localize controllable flash/error copy;
- make Project Wizard path selection explicit;
- improve role catalog usability without changing runtime semantics.

## Completed Changes

- `pnpm run test:visualizer-browser` remains the browser smoke gate, and CI now runs it explicitly.
- Browser smoke failures are wrapped so environment startup failures can be separated from app assertion failures.
- Project Wizard now keeps current and target workdir context visible in the open/create flow.
- Project Wizard default creation path keeps model/profile details framed as advanced guidance.
- Role catalog now supports health filtering and a clearer selected-summary view.
- Visualizer i18n includes the new controllable path, health, and summary strings in both `en` and `zh-CN`.

## Verification

- Build and visualizer test coverage should be rerun after this pass:
  - `pnpm run build`
  - `pnpm run test:visualizer`
  - `pnpm run test:visualizer-browser`

## Notes

- No runtime/parser/compiler semantics were changed.
- This record intentionally stays narrow and does not reopen the larger backlog items deferred to the next round.
