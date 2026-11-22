# V2 Project Library UX Review

Evidence type: engineering browser review. This checks the Project library layout only; it does
not replace workflow-operator, product-owner, accessibility, or release acceptance.

## Execution

- Date: 2026-11-20 (Asia/Shanghai)
- Application: running Team Site at `http://127.0.0.1:4173/projects`
- Browser: Playwright Chromium, headless, device scale factor 1
- Viewports: desktop 1440x900, tablet 768x900, and mobile 390x900 and 375x900
- Data: 13 existing Collaboration Project cards; no project data was changed
- Actions: opened the Project library, checked every card's Open and Delete controls against its
  card bounds, checked document width against the viewport, and recorded page errors

## Results

- On the initial layout, card action buttons remained within their card bounds, but the 320px
  mobile minimum height left excessive whitespace and showed only one complete card in the first
  900px viewport.
- The mobile card minimum height is now 260px. At 375px and 390px, two complete cards fit in the
  first viewport; card content and action controls remain within each card.
- At 768px and 1440px, cards retain their 320px minimum height. Document width matched the
  viewport at all four widths; no horizontal page overflow was found.
- Search and Create Project controls remained visible and usable in the mobile layout.
- No browser page errors were observed.
- The original report of Project card buttons crossing card boundaries was not reproducible on
  this current build.
- This review does not test keyboard or screen-reader accessibility and does not change a UAT
  status to `Pass`.

## Captures

- Desktop: [`screenshots/v2-project-library-ux-desktop-2026-11-20.png`](screenshots/v2-project-library-ux-desktop-2026-11-20.png), SHA-256 `445499f0880c70d23a91424baa88f1d6ce8bbbde9404b9e70e608bea220f395e`
- Mobile: [`screenshots/v2-project-library-ux-mobile-2026-11-20.png`](screenshots/v2-project-library-ux-mobile-2026-11-20.png), SHA-256 `d35e61136095a4a141c26bb12ee7426f709362cc0ed4e6aeecd13d214f730d43`

## Current Runtime Recheck

- Date: 2026-11-20 (Asia/Shanghai)
- Application: running Team Site at `http://127.0.0.1:4175/projects`
- Browser: Orca embedded Chromium
- Viewports: desktop 1602x900 and mobile 390x844
- Data: one active Collaboration Project; no project data was changed
- Measured card bounds: desktop x=256..686.7, mobile x=12..378. Both Open and Delete controls
  stayed inside the card at both widths; document and body scroll widths matched the viewport.
- Browser console: no entries
- Mobile capture: [`screenshots/v2-project-library-current-mobile-2026-11-20.png`](screenshots/v2-project-library-current-mobile-2026-11-20.png), SHA-256 `1132323671ed2cea5b234c59bce1cd96a39827b63b12fbf516e24438683bb283`

This rechecks the previously reported button overflow against the live runtime. It is layout
evidence only and does not change a UAT status or replace operator acceptance.
