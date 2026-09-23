// PROTOTYPE: full logical read, not UI, session history or a production API.
import { canonicalTags } from './contract.mjs';

const subset = (a, b) => a.every(tag => b.includes(tag));
const properSubset = (a, b) => a.length < b.length && subset(a, b);

class SourceOutcome extends Error {
  constructor(outcome) { super(outcome.status); this.outcome = outcome; }
}

export function readNavigation(source, request = {}) {
  const revision = request.revision ?? source.revision;
  const mode = request.mode ?? 'nodes';
  if (!['nodes', 'free'].includes(mode)) throw new Error('invalid mode');
  const take = answer => {
    if (answer.status !== 'ok') throw new SourceOutcome(answer);
    if (answer.revision !== revision) throw new SourceOutcome({ status: 'read-failed', reason: 'mixed-revision' });
    return answer.value;
  };

  try {
    const linked = request.collectionId === undefined ? null : take(source.collection(request.collectionId, revision));
    const tags = canonicalTags(linked ? linked.tags : request.tags ?? []);
    const related = take(source.related(tags, revision));
    const current = linked ?? (tags.length ? related.equal : null);
    const location = {
      kind: current ? 'node' : tags.length ? 'temporary' : 'all',
      nodeId: current?.id ?? null, tags,
    };
    const emptyEntry = location.kind === 'all' ? related.equal : null;
    const destinations = emptyEntry ? [emptyEntry, ...related.narrower] : related.narrower;
    const itemTags = mode === 'free' ? take(source.extraTags(tags, revision)) : [];
    const parents = mode === 'nodes' ? related.wider.filter(node =>
      !related.wider.some(other => properSubset(node.tags, other.tags))) : [];
    const nodeTransition = node => ({
      kind: 'node', nodeId: node.id, targetTags: node.tags,
      addedTags: node.tags.filter(tag => !tags.includes(tag)),
      coveredNodeIds: destinations.filter(other => subset(node.tags, other.tags)).map(other => other.id).sort(),
    });

    let transitions;
    if (mode === 'nodes') {
      transitions = destinations.filter(node =>
        !destinations.some(other => properSubset(other.tags, node.tags))).map(nodeTransition);
    } else {
      const candidates = new Set(itemTags.map(entry => entry.tag));
      for (const node of related.narrower) {
        for (const tag of node.tags) if (!tags.includes(tag)) candidates.add(tag);
      }
      transitions = [...candidates].sort().map(tag => {
        const targetTags = canonicalTags([...tags, tag]);
        const exact = related.narrower.find(node => node.tags.length === targetTags.length && subset(targetTags, node.tags));
        return {
          kind: exact ? 'node' : 'temporary', nodeId: exact?.id ?? null,
          targetTags, addedTags: [tag],
          coveredNodeIds: related.narrower.filter(node => node.tags.includes(tag)).map(node => node.id),
        };
      });
      // Explicit empty-node entry does not replace the ordinary free refinements.
      if (emptyEntry) transitions.unshift(nodeTransition(emptyEntry));
    }

    const queries = [tags, ...transitions.map(entry => entry.targetTags)];
    const counts = take(source.count(queries, revision));
    if (!Array.isArray(counts) || counts.length !== queries.length || counts.some((entry, i) =>
      !Number.isSafeInteger(entry.count) || entry.count < 0 || JSON.stringify(entry.tags) !== JSON.stringify(queries[i]))) {
      return { status: 'read-failed', reason: 'invalid-count-batch' };
    }
    const page = take(source.page(tags, { offset: request.offset, limit: request.limit }, revision));
    if (page.total !== counts[0].count) return { status: 'read-failed', reason: 'inconsistent-page-count' };
    return {
      status: 'ok', revision,
      value: {
        mode, location, total: counts[0].count, parents,
        transitions: transitions.map((entry, i) => ({ ...entry, count: counts[i + 1].count })),
        page,
        // Observability for the rig; NOT a proposed wire payload.
        sourceFacts: { related, itemTags, counts },
      },
    };
  } catch (error) {
    if (error instanceof SourceOutcome) return error.outcome;
    throw error;
  }
}
