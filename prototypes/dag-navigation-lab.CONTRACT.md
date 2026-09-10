# DAG navigator lab: minimal contract

> THROWAWAY contract for the isolated UI prototype. It records the smallest
> state/event boundary being tested; it is not a production API.

## Mount

```js
createDagNavigator(element, {
  fixture: {
    nodes: [{ id, name, tags }],
    items: [{ id, tags }],
  },
  initialState: {
    mode: 'nodes' | 'free',
    location: { kind, tags, nodeId },
    history: [{ kind, tags, nodeId, mode }],
    cloud: { width, height, tagScale },
  },
  onStateChange(state),
  onEvent(event),
})
```

The component owns navigation state in memory. The laboratory owns scenario
selection, reset, the inspector, and the event log. `onStateChange` and
`getState()` expose one serializable snapshot for those technical tools.

## State invariants

- `location.kind` is exactly one of `all`, `node`, or `temporary`.
- `all` is outside the DAG: it has `tags: []` and `nodeId: null`. It must not be
  confused with a possible saved node whose filter is empty.
- `node` has an existing `nodeId`; its normalized tag set equals that node's
  normalized tag set.
- `temporary` has `nodeId: null` and no saved node with exactly the same
  normalized tag set.
- Tags are trimmed, lowercased, deduplicated, and sorted before comparison.
- `history` contains actual previously visited locations. It is not inferred
  from parents in the DAG.
- `relevantCount` is derived from unique fixture items containing every tag in
  the current navigation set.
- Both modes allow `all`, user nodes and intermediate current locations.
  Removing tags does not change the mode or constrain the remaining tag set.
- `mode: nodes` restricts suggested destinations to user nodes. Its cloud
  contains nearest user-node supersets (roots at `all`); parent actions contain
  nearest user-node subsets, also when the current location is intermediate.
  Each button shows the tags added together, not a collection name. Its
  `targetTags` is the complete destination; `key` is independent of the label.
- `mode: free` visits user and intermediate nodes (`temporary` is the legacy
  wire name, not a denial that this is a conceptual DAG node). Its cloud adds
  one tag from matching items or user-node descendants. A solid/dashed border
  distinguishes user/intermediate destinations. Every such one-tag action is
  retained; scrolling handles overflow. No powerset is materialized.
- For every strict user descendant N, a retained target must be a subset of N.
  Repeating this invariant preserves a path to every user target, in place or
  through scrolling. It is not a claim to enumerate every intermediate node.
  Coverage is by node identity, independent of result count (including zero).
- The previous stable cover-pruning helper is retained, but these two modes
  have no removable shortcuts: each nearest user child is required to reach
  itself, and free mode deliberately keeps every known one-tag action. This
  stronger free-mode rule is an experimental choice, not a production decision.
- `cloud.width`, `cloud.height`, and `cloud.tagScale` are independent. Normally,
  resize requests stop at a feasible boundary and scale requests that would
  break in-place coverage are rejected without resizing the cloud.
- Width is a percentage of the host; height 35–100 maps from the smaller of
  172px and available height to the entire available height, excluding labels
  and the result action. The prototype keeps the existing width range 46–100.
- Initial mounting, navigation, and viewport changes can grow the rectangle
  up to available space to preserve coverage. They never change tag scale.
- If the covering set cannot fit even at full size at the chosen scale,
  vertical scrolling becomes available. All candidate tags are rendered in
  that fallback; off-screen tags remain reachable by scroll and keyboard.
  Only the tag region scrolls, leaving scale and resize controls fixed.
  In scroll mode, fixed strips above/below the tag region show `↑ Ещё выше`
  and `Ещё ниже ↓` whenever content remains in that direction, including before
  the first scroll gesture. They do not depend on native scrollbar visibility
  and do not cover tags. Both strips reserve space throughout scrolling so
  showing/hiding a cue does not move content. Fit/empty clouds have no strips.
  The user can combine a smaller scale with scrolling; scale never changes
  automatically. In fallback, resizing may also rely on scrolling for coverage.
- Each layout change rechecks in-place fit. When a covering set fits again
  in the current rectangle, scrolling is removed automatically. While fallback
  is active, scale changes remain available even if a larger rectangle could
  fit the new scale without scrolling. Ordinary shrink requests cannot bypass
  the coverage boundary by enabling scrolling when full-size fit is possible.
- Scaling and resizing preserve relative scroll progress while scrolling
  remains necessary. Navigation starts the new cloud at its top. Scrolling
  changes presentation only, with no route entry or navigation event.
- `insufficient-space` remains only for hosts too short to offer a usable
  tag region and fixed controls; scrolling cannot repair that geometry.
- An empty-filter user node is explicitly represented as `∅ Пустой фильтр` in
  node mode, separate from `all`. In free mode, tag addition still cannot reach
  it: such a fixture reports `unrepresentable` instead of false full coverage.

The cloud snapshot includes:

```js
{
  width, height, tagScale,
  actualPixels: { width, height },
  mode: 'fit' | 'scroll' | 'blocked',
  visibleDirectionCount, availableDirectionCount, totalDirectionCount,
  scroll: { top, max },
  coverage: {
    scope: 'user-nodes' | 'one-tag-refinements-and-user-nodes',
    status: 'complete' | 'insufficient-space' | 'unrepresentable',
    totalNodeCount, coveredNodeIds, uncoveredNodeIds, retainedTags, retainedDirectionKeys,
  },
  limit: null | { kind: 'size' | 'scale', requested },
}
```

Each direction exposes `coveredNodeIds`, `available` (rendered and reachable),
and `visible` (fully inside the current tag viewport) for the inspector.
`retainedDirectionKeys` records available actions (or the failed plan in a
blocked layout); `retainedTags` is their flattened tag delta.
`coverage.coveredNodeIds` includes coverage reachable through
scrolling, not just the currently visible tags. The UI counter shows available
directions out of all candidates. Scroll changes update `onStateChange` only.

## Two-mode experiment and manual input — updated 2026-09-10

- Default is `nodes`; the intermediate and manual-input scenarios default to
  `free`. A shareable `?mode=free|nodes` overrides either default, including
  at an intermediate location.
  URL preserves scenario/mode, not the in-memory query or route.
- Switching modes at any location preserves tags, node identity, count and
  history. It immediately changes the available actions, without a dialog
  or an automatic transition to a user node.
- History entries carry their mode. Back restores the actual visited location
  and its mode, including intermediate states; no history is silently skipped.
- Every selected tag is removable in both modes, including the last tag.
  The resulting set may be intermediate, while `nodes` continues to offer
  only user-node destinations. Removing the last tag visits `all` in the same
  mode. Broader node buttons can still remove a bundle.
- Manual input belongs to `free`: a space separates tags;
  an underscore remains inside one tag and stands for a word boundary
  (`короткий_метр`). Enter/button appends the normalized batch atomically.
  Empty/duplicate-only input adds no history or navigation event.
  Unknown tags are allowed as zero-result queries; no tag or collection is saved.
  Suggestions use the existing fixture vocabulary, including item-only tags,
  but only retain tags with a positive result count after addition. The context
  includes selected tags plus complete space-separated draft tokens;
  the last token is a case-insensitive substring to complete, not a requirement.
  Selected/completed tags are excluded. Suggestions carry the count, sorted by
  descending count then label. The native suggestion value displays the count
  in parentheses on the first line (`тег (3)`); selecting one preserves the
  preceding batch and strips that display metadata before insertion.
  Zero-result user nodes remain navigable in the cloud: this restriction is
  only for input suggestions, not DAG coverage or arbitrary manual queries.
- `tagInput: { draft, feedback, suggestions: [{tag, value, relevantCount}] }`
  is observable UI state. The former `pendingMode` state and `modeEntry` event
  are removed along with the entry chooser.
  Typing updates the inspector but not navigation/results. Submission updates
  location, count, cloud and node kind immediately; results remain an outgoing
  event only, without cards or an application results screen.

## Events

Every event contains `type`, an action-specific payload, and serializable
`before` / `after` snapshots.

| Event | Trigger and meaning |
| --- | --- |
| `refine` | Add `addedTags` through a one-tag action or a user-node bundle. |
| `broaden` | Remove `removedTags` through selected tags in either mode or a broader user-node transition. |
| `filterInput` | Append a manually entered tag batch; payload includes `addedTags`. |
| `modeChange` | Change mode without changing the current location or route. |
| `back` | Restore the most recent location from actual history. It does not choose a DAG parent. |
| `all` | Visit the explicit top-level state outside the DAG from any state. |
| `requestResults` | Emit `{ tags, nodeId, relevantCount }`; do not open or render application results. |
| `scaleChange` | Request a scale; emit `from`, `requested`, actual `to`, and `limited`. A rejected request leaves state unchanged except the limit hint. |
| `cloudResize` | Request dimensions; emit `from`, `requested`, actual `to`, and `limited`. Pointer cancellation additionally emits `cancelled`. No route entry is added. |

`back`, `broaden`, and `all` deliberately have different event types and can
produce different locations from the same starting state. In either mode every
selected tag can be removed, including the final one. Removing the final tag visits `all`
with an empty set and no node ID; it still emits `broaden` with `removedTag`,
not an explicit `all` action. The previous location remains in actual history
and can be restored with `back`. No saved filter is modified, and no
empty-filter saved node is implicitly opened or created.
