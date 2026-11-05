// A node:test reporter for repeated runs (.github/workflows/repeat.yml):
// a line of JSON per test — its file and name, whether it passed, and why
// not — for tests/repeat-summary.mjs to count over many rounds.
export default async function* record(source) {
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const d = event.data;
    if (d.details?.type === 'suite' || d.nesting > 0) continue;
    // A file is reported as a test of its own too: counted only when it
    // fails as a whole (it did not load, or a hook after its tests failed).
    if (event.type === 'test:pass' && String(d.file ?? '').endsWith(d.name)) continue;
    const e = d.details?.error;
    const cause = e?.cause ?? e;
    yield `${JSON.stringify({
      file: String(d.file ?? '').split('/').pop(),
      name: d.name,
      ok: event.type === 'test:pass',
      skipped: Boolean(d.skip),
      why: cause ? String(cause.message ?? cause).split('\n')[0].slice(0, 300) : undefined,
    })}\n`;
  }
}
