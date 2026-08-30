# Issue tracker: Local Markdown

Issues and Wayfinder maps live under `.scratch/`.

## Wayfinding operations

- Map: `.scratch/<effort>/map.md`.
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md` with `Type:` and, when claimed or resolved, `Status:`.
- Blocking: `Blocked by: NN, NN`; a ticket is unblocked when every listed ticket is `resolved`.
- Frontier: scan issue files in numeric order and choose the first open, unblocked, unclaimed ticket.
- Claim: set `Status: claimed` before work.
- Resolve: add `## Answer`, set `Status: resolved`, and append a named context pointer to the map's Decisions-so-far.
