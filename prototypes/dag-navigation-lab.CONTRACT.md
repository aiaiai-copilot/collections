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
    location: { kind, tags, nodeId },
    history: [{ kind, tags, nodeId }],
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
- Tags are trimmed, deduplicated, and sorted before comparison.
- `history` contains actual previously visited locations. It is not inferred
  from parents in the DAG.
- `relevantCount` is derived from unique fixture items containing every tag in
  the current navigation set.
- Downward `directions` are derived from every strict saved-node superset,
  across the full remaining depth. Already selected tags are excluded.
- Each cloud button represents one tag to add, not a saved node or its name.
  The destination is the whole resulting set: an exact saved-node match shows
  its name and ID above the selected tags; otherwise it is `temporary`.
- For a current set F and each strict descendant N, at least one retained
  direction t must belong to tags(N) minus F. Repeating this invariant at each
  step preserves a path to every target, either in place or through scrolling.
  Coverage is by node identity, independent of result count (including zero).
- A shortcut may be hidden only if the remaining directions still cover every
  target. The lab uses stable removal in reverse weight order, checking actual
  button geometry after each removal. This is an inclusion-minimal cover when
  fully reduced, not a claim of globally minimum tag count or rectangle area.
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
- An empty-filter saved node at `all` cannot be reached by adding a tag. If
  supplied in a fixture, the prototype reports `unrepresentable`; it never
  silently excludes that node when calculating coverage. A separate entry
  affordance for such nodes is still outside this iteration.

The cloud snapshot includes:

```js
{
  width, height, tagScale,
  actualPixels: { width, height },
  mode: 'fit' | 'scroll' | 'blocked',
  visibleDirectionCount, availableDirectionCount, totalDirectionCount,
  scroll: { top, max },
  coverage: {
    status: 'complete' | 'insufficient-space' | 'unrepresentable',
    totalNodeCount, coveredNodeIds, uncoveredNodeIds, retainedTags,
  },
  limit: null | { kind: 'size' | 'scale', requested },
}
```

Each direction exposes `coveredNodeIds`, `available` (rendered and reachable),
and `visible` (fully inside the current tag viewport) for the inspector.
`retainedTags` records the available set, or the failed covering plan in a
blocked layout. `coverage.coveredNodeIds` includes coverage reachable through
scrolling, not just the currently visible tags. The UI counter shows available
directions out of all candidates. Scroll changes update `onStateChange` only.

## Events

Every event contains `type`, an action-specific payload, and serializable
`before` / `after` snapshots.

| Event | Trigger and meaning |
| --- | --- |
| `refine` | Add one downward direction tag to the current set and visit the exact saved node or a temporary set. |
| `broaden` | Remove one selected tag and visit the resulting wider context. This is a new semantic transition. |
| `back` | Restore the most recent location from actual history. It does not choose a DAG parent. |
| `all` | Visit the explicit top-level state outside the DAG from any state. |
| `requestResults` | Emit `{ tags, nodeId, relevantCount }`; do not open or render application results. |
| `scaleChange` | Request a scale; emit `from`, `requested`, actual `to`, and `limited`. A rejected request leaves state unchanged except the limit hint. |
| `cloudResize` | Request dimensions; emit `from`, `requested`, actual `to`, and `limited`. Pointer cancellation additionally emits `cancelled`. No route entry is added. |

`back`, `broaden`, and `all` deliberately have different event types and can
produce different locations from the same starting state. Every selected tag
can be removed, including the final one. Removing the final tag visits `all`
with an empty set and no node ID; it still emits `broaden` with `removedTag`,
not an explicit `all` action. The previous location remains in actual history
and can be restored with `back`. No saved filter is modified, and no
empty-filter saved node is implicitly opened or created.
