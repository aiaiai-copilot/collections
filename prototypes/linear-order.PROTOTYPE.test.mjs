import assert from "node:assert/strict";
import test from "node:test";

import { createLinearOrder } from "./linear-order.PROTOTYPE.mjs";

test("новые объекты имеют неизвестное, а не равноценное отношение", () => {
  const order = createLinearOrder();

  assert.deepEqual(order.project(["A", "B"]), {
    places: [["A"], ["B"]],
    strictRelations: [],
    unknownPairs: [{ left: ["A"], right: ["B"] }],
    complete: false,
  });
});

test("явная равноценность объединяет объекты в одно общее место", () => {
  const order = createLinearOrder();

  const result = order.record({ left: "A", outcome: "equal", right: "B" });

  assert.deepEqual(
    { result, projection: order.project(["A", "B"]) },
    {
      result: { ok: true, decisionId: "decision-1" },
      projection: {
        places: [["A", "B"]],
        strictRelations: [],
        unknownPairs: [],
        complete: true,
      },
    },
  );
});

test("строгое решение упорядочивает разные места", () => {
  const order = createLinearOrder();

  const result = order.record({ left: "A", outcome: "higher", right: "B" });

  assert.deepEqual(
    { result, projection: order.project(["A", "B"]) },
    {
      result: { ok: true, decisionId: "decision-1" },
      projection: {
        places: [["A"], ["B"]],
        strictRelations: [{ higher: ["A"], lower: ["B"] }],
        unknownPairs: [],
        complete: true,
      },
    },
  );
});

test("строгий порядок выводится транзитивно через объект вне среза", () => {
  const order = createLinearOrder();
  order.record({ left: "A", outcome: "higher", right: "B" });
  order.record({ left: "B", outcome: "higher", right: "C" });

  assert.deepEqual(order.project(["A", "C"]), {
    places: [["A"], ["C"]],
    strictRelations: [{ higher: ["A"], lower: ["C"] }],
    unknownPairs: [],
    complete: true,
  });
});

test("строгое решение внутри транзитивного общего места отклоняется без изменения порядка", () => {
  const order = createLinearOrder();
  order.record({ left: "A", outcome: "equal", right: "B" });
  order.record({ left: "B", outcome: "equal", right: "C" });

  const result = order.record({ left: "A", outcome: "higher", right: "C" });

  assert.deepEqual(
    { result, projection: order.project(["A", "B", "C"]) },
    {
      result: {
        ok: false,
        conflict: {
          kind: "strict-within-common-place",
          attempted: { left: "A", outcome: "higher", right: "C" },
          conflictingDecisionIds: ["decision-1", "decision-2"],
          message: "A и C уже находятся на одном общем месте.",
        },
      },
      projection: {
        places: [["A", "B", "C"]],
        strictRelations: [],
        unknownPairs: [],
        complete: true,
      },
    },
  );
});

test("строгое решение, замыкающее транзитивный цикл, отклоняется с объяснением", () => {
  const order = createLinearOrder();
  order.record({ left: "A", outcome: "higher", right: "B" });
  order.record({ left: "B", outcome: "higher", right: "C" });

  const result = order.record({ left: "C", outcome: "higher", right: "A" });

  assert.deepEqual(
    { result, projection: order.project(["A", "B", "C"]) },
    {
      result: {
        ok: false,
        conflict: {
          kind: "strict-cycle",
          attempted: { left: "C", outcome: "higher", right: "A" },
          conflictingDecisionIds: ["decision-1", "decision-2"],
          message: "C > A замкнуло бы цикл строгого порядка.",
        },
      },
      projection: {
        places: [["A"], ["B"], ["C"]],
        strictRelations: [
          { higher: ["A"], lower: ["B"] },
          { higher: ["A"], lower: ["C"] },
          { higher: ["B"], lower: ["C"] },
        ],
        unknownPairs: [],
        complete: true,
      },
    },
  );
});

test("равноценность между строго упорядоченными объектами отклоняется без изменения порядка", () => {
  const order = createLinearOrder();
  order.record({ left: "A", outcome: "higher", right: "B" });
  order.record({ left: "B", outcome: "higher", right: "C" });

  const result = order.record({ left: "A", outcome: "equal", right: "C" });

  assert.deepEqual(
    { result, projection: order.project(["A", "B", "C"]) },
    {
      result: {
        ok: false,
        conflict: {
          kind: "equality-across-strict-order",
          attempted: { left: "A", outcome: "equal", right: "C" },
          conflictingDecisionIds: ["decision-1", "decision-2"],
          message: "A и C уже строго упорядочены.",
        },
      },
      projection: {
        places: [["A"], ["B"], ["C"]],
        strictRelations: [
          { higher: ["A"], lower: ["B"] },
          { higher: ["A"], lower: ["C"] },
          { higher: ["B"], lower: ["C"] },
        ],
        unknownPairs: [],
        complete: true,
      },
    },
  );
});

test("исход lower задаёт обратное строгое отношение", () => {
  const order = createLinearOrder();

  order.record({ left: "A", outcome: "lower", right: "B" });

  assert.deepEqual(order.project(["A", "B"]), {
    places: [["A"], ["B"]],
    strictRelations: [{ higher: ["B"], lower: ["A"] }],
    unknownPairs: [],
    complete: true,
  });
});

test("пересекающиеся срезы сохраняют общий порядок и явно показывают неизвестные пары", () => {
  const order = createLinearOrder();
  order.record({ left: "A", outcome: "equal", right: "B" });
  order.record({ left: "A", outcome: "higher", right: "C" });

  assert.deepEqual(
    {
      completeSlice: order.project(["B", "C"]),
      partialSlice: order.project(["A", "B", "C", "D"]),
    },
    {
      completeSlice: {
        places: [["B"], ["C"]],
        strictRelations: [{ higher: ["B"], lower: ["C"] }],
        unknownPairs: [],
        complete: true,
      },
      partialSlice: {
        places: [["A", "B"], ["C"], ["D"]],
        strictRelations: [{ higher: ["A", "B"], lower: ["C"] }],
        unknownPairs: [
          { left: ["A", "B"], right: ["D"] },
          { left: ["C"], right: ["D"] },
        ],
        complete: false,
      },
    },
  );
});

test("явный пересмотр отделяет объект от общего места атомарно", () => {
  const order = createLinearOrder();
  const first = order.record({ left: "A", outcome: "equal", right: "B" });
  order.record({ left: "B", outcome: "equal", right: "C" });

  const result = order.revise({
    retract: [first.decisionId],
    record: { left: "A", outcome: "higher", right: "C" },
  });

  assert.deepEqual(
    { result, projection: order.project(["A", "B", "C"]) },
    {
      result: {
        ok: true,
        decisionId: "decision-3",
        retractedDecisionIds: ["decision-1"],
      },
      projection: {
        places: [["A"], ["B", "C"]],
        strictRelations: [{ higher: ["A"], lower: ["B", "C"] }],
        unknownPairs: [],
        complete: true,
      },
    },
  );
});

test("явный пересмотр заменяет равноценность пары строгим порядком", () => {
  const order = createLinearOrder();
  const equality = order.record({ left: "A", outcome: "equal", right: "B" });

  const result = order.revise({
    retract: [equality.decisionId],
    record: { left: "A", outcome: "higher", right: "B" },
  });

  assert.deepEqual(
    { result, projection: order.project(["A", "B"]) },
    {
      result: {
        ok: true,
        decisionId: "decision-2",
        retractedDecisionIds: ["decision-1"],
      },
      projection: {
        places: [["A"], ["B"]],
        strictRelations: [{ higher: ["A"], lower: ["B"] }],
        unknownPairs: [],
        complete: true,
      },
    },
  );
});

test("явный пересмотр заменяет строгий порядок пары равноценностью", () => {
  const order = createLinearOrder();
  const strictDecision = order.record({ left: "A", outcome: "higher", right: "B" });

  const result = order.revise({
    retract: [strictDecision.decisionId],
    record: { left: "A", outcome: "equal", right: "B" },
  });

  assert.deepEqual(
    { result, projection: order.project(["A", "B"]) },
    {
      result: {
        ok: true,
        decisionId: "decision-2",
        retractedDecisionIds: ["decision-1"],
      },
      projection: {
        places: [["A", "B"]],
        strictRelations: [],
        unknownPairs: [],
        complete: true,
      },
    },
  );
});

test("пересмотр транзитивного следствия отзывает только явно выбранное решение", () => {
  const order = createLinearOrder();
  const first = order.record({ left: "A", outcome: "higher", right: "B" });
  order.record({ left: "B", outcome: "higher", right: "C" });

  const result = order.revise({
    retract: [first.decisionId],
    record: { left: "A", outcome: "lower", right: "C" },
  });

  assert.deepEqual(
    { result, projection: order.project(["A", "B", "C"]) },
    {
      result: {
        ok: true,
        decisionId: "decision-3",
        retractedDecisionIds: ["decision-1"],
      },
      projection: {
        places: [["A"], ["B"], ["C"]],
        strictRelations: [
          { higher: ["B"], lower: ["A"] },
          { higher: ["C"], lower: ["A"] },
          { higher: ["B"], lower: ["C"] },
        ],
        unknownPairs: [],
        complete: true,
      },
    },
  );
});

test("неполный пересмотр общего места отклоняется атомарно", () => {
  const order = createLinearOrder();
  const first = order.record({ left: "A", outcome: "equal", right: "B" });
  order.record({ left: "B", outcome: "equal", right: "C" });
  order.record({ left: "A", outcome: "equal", right: "C" });

  const result = order.revise({
    retract: [first.decisionId],
    record: { left: "A", outcome: "higher", right: "C" },
  });

  assert.deepEqual(
    { result, projection: order.project(["A", "B", "C"]) },
    {
      result: {
        ok: false,
        conflict: {
          kind: "strict-within-common-place",
          attempted: { left: "A", outcome: "higher", right: "C" },
          conflictingDecisionIds: ["decision-3"],
          message: "A и C уже находятся на одном общем месте.",
        },
      },
      projection: {
        places: [["A", "B", "C"]],
        strictRelations: [],
        unknownPairs: [],
        complete: true,
      },
    },
  );
});
