function findPath(decisions, start, target, includeStrictRelations) {
  if (start === target) return [];

  const neighbours = new Map();

  function addStep(from, to, decisionId) {
    const steps = neighbours.get(from) ?? [];
    steps.push({ object: to, decisionId });
    neighbours.set(from, steps);
  }

  for (const decision of decisions) {
    if (decision.outcome === "equal") {
      addStep(decision.left, decision.right, decision.decisionId);
      addStep(decision.right, decision.left, decision.decisionId);
      continue;
    }

    if (!includeStrictRelations) continue;

    const higher = decision.outcome === "higher" ? decision.left : decision.right;
    const lower = decision.outcome === "higher" ? decision.right : decision.left;
    addStep(higher, lower, decision.decisionId);
  }

  const pending = [start];
  const previous = new Map([[start, null]]);

  while (pending.length > 0) {
    const current = pending.shift();

    for (const neighbour of neighbours.get(current) ?? []) {
      if (previous.has(neighbour.object)) continue;

      previous.set(neighbour.object, {
        object: current,
        decisionId: neighbour.decisionId,
      });

      if (neighbour.object === target) {
        const decisionIds = [];
        let cursor = target;

        while (cursor !== start) {
          const step = previous.get(cursor);
          decisionIds.unshift(step.decisionId);
          cursor = step.object;
        }

        return decisionIds;
      }

      pending.push(neighbour.object);
    }
  }

  return null;
}

function findEqualityPath(decisions, start, target) {
  return findPath(decisions, start, target, false);
}

function findOrderPath(decisions, start, target) {
  return findPath(decisions, start, target, true);
}

function explainConflict(decisions, decision) {
  if (decision.outcome === "equal") {
    const equalityPath = findEqualityPath(decisions, decision.left, decision.right);
    const strictPath =
      equalityPath === null
        ? (findOrderPath(decisions, decision.left, decision.right) ??
          findOrderPath(decisions, decision.right, decision.left))
        : null;

    if (strictPath !== null) {
      return {
        kind: "equality-across-strict-order",
        attempted: decision,
        conflictingDecisionIds: strictPath,
        message: `${decision.left} и ${decision.right} уже строго упорядочены.`,
      };
    }

    return null;
  }

  const equalityPath = findEqualityPath(decisions, decision.left, decision.right);

  if (equalityPath !== null) {
    return {
      kind: "strict-within-common-place",
      attempted: decision,
      conflictingDecisionIds: equalityPath,
      message: `${decision.left} и ${decision.right} уже находятся на одном общем месте.`,
    };
  }

  const higher = decision.outcome === "higher" ? decision.left : decision.right;
  const lower = decision.outcome === "higher" ? decision.right : decision.left;
  const cyclePath = findOrderPath(decisions, lower, higher);

  if (cyclePath !== null) {
    return {
      kind: "strict-cycle",
      attempted: decision,
      conflictingDecisionIds: cyclePath,
      message: `${higher} > ${lower} замкнуло бы цикл строгого порядка.`,
    };
  }

  return null;
}

export function createLinearOrder() {
  const decisions = [];
  let nextDecisionNumber = 1;

  return {
    record(decision) {
      const conflict = explainConflict(decisions, decision);
      if (conflict !== null) return { ok: false, conflict };

      const decisionId = `decision-${nextDecisionNumber}`;
      nextDecisionNumber += 1;
      decisions.push({ ...decision, decisionId });

      return { ok: true, decisionId };
    },

    revise(revision) {
      const retractedDecisionIds = new Set(revision.retract);
      const remainingDecisions = decisions.filter(
        (decision) => !retractedDecisionIds.has(decision.decisionId),
      );
      const conflict = explainConflict(remainingDecisions, revision.record);

      if (conflict !== null) return { ok: false, conflict };

      const decisionId = `decision-${nextDecisionNumber}`;
      nextDecisionNumber += 1;
      decisions.length = 0;
      decisions.push(...remainingDecisions, { ...revision.record, decisionId });

      return {
        ok: true,
        decisionId,
        retractedDecisionIds: revision.retract,
      };
    },

    project(objects) {
      const parents = new Map();

      function find(object) {
        if (!parents.has(object)) parents.set(object, object);
        const parent = parents.get(object);

        if (parent !== object) parents.set(object, find(parent));
        return parents.get(object);
      }

      function unite(left, right) {
        const leftRoot = find(left);
        const rightRoot = find(right);

        if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
      }

      for (const decision of decisions) {
        if (decision.outcome === "equal") unite(decision.left, decision.right);
      }

      const placesByRoot = new Map();

      for (const object of objects) {
        const root = find(object);
        const place = placesByRoot.get(root) ?? [];
        place.push(object);
        placesByRoot.set(root, place);
      }

      const places = [...placesByRoot.values()];
      const lowerPlacesByHigherRoot = new Map();

      for (const decision of decisions) {
        if (decision.outcome === "equal") continue;

        const higherObject = decision.outcome === "higher" ? decision.left : decision.right;
        const lowerObject = decision.outcome === "higher" ? decision.right : decision.left;
        const higherRoot = find(higherObject);
        const lowerRoot = find(lowerObject);
        const lowerRoots = lowerPlacesByHigherRoot.get(higherRoot) ?? new Set();
        lowerRoots.add(lowerRoot);
        lowerPlacesByHigherRoot.set(higherRoot, lowerRoots);
      }

      function isHigher(higherPlace, lowerPlace) {
        const higherRoot = find(higherPlace[0]);
        const lowerRoot = find(lowerPlace[0]);
        const visited = new Set();
        const pending = [higherRoot];

        while (pending.length > 0) {
          const current = pending.pop();
          if (current === lowerRoot) return true;
          if (visited.has(current)) continue;

          visited.add(current);
          pending.push(...(lowerPlacesByHigherRoot.get(current) ?? []));
        }

        return false;
      }

      const strictRelations = [];
      const unknownPairs = [];

      for (let left = 0; left < places.length; left += 1) {
        for (let right = left + 1; right < places.length; right += 1) {
          if (isHigher(places[left], places[right])) {
            strictRelations.push({ higher: places[left], lower: places[right] });
          } else if (isHigher(places[right], places[left])) {
            strictRelations.push({ higher: places[right], lower: places[left] });
          } else {
            unknownPairs.push({ left: places[left], right: places[right] });
          }
        }
      }

      return {
        places,
        strictRelations,
        unknownPairs,
        complete: unknownPairs.length === 0,
      };
    },
  };
}
