---
name: No CSS uppercase
description: Never use CSS or Tailwind to force text to uppercase
type: feedback
---

Never use CSS (`text-transform: uppercase`) or Tailwind (`uppercase` class) to make text uppercase anywhere in the client UI.

**Why:** User explicitly prohibited this. If a label needs to appear uppercase, write it uppercase directly in the source HTML/JSX.

**How to apply:** Any time writing class names — remove `uppercase`, `text-uppercase`, `text-transform: uppercase`, and avoid pairing `tracking-widest` with auto-uppercased labels. Write the actual text in the desired case instead.
