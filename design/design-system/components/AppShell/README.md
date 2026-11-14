The navigation shell of the web app: a top bar on desktop and tablet, bottom tabs on phones.

- Three destinations only: *Today*, *Progress*, *Settings*. Current page: `tonal` pill on desktop, `success` colour on mobile, plus `aria-current="page"`.
- Desktop/tablet (>760px): fixed-height 72px top bar, logo left, links centre, streak and notes chips right (minutes chip hides below 1080px).
- Phone (≤760px): the links move to a bottom tab bar (thumb reach) with `env(safe-area-inset-bottom)` padding; the chips move under the header.
- Recording, exercise and onboarding flows hide the shell and show a close/back button and a progress bar instead — one task, no distractions.
- Breakpoints are container queries on the page root, so layouts adapt to their container, not just the viewport.
