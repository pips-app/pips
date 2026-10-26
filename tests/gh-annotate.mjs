// A node:test reporter for CI: each failure becomes a GitHub annotation,
// readable from the run's page and its API without downloading the logs.
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');

export default async function* annotate(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail' || event.data.details?.type === 'suite') continue;
    const e = event.data.details?.error;
    const cause = e?.cause ?? e;
    const text = [cause?.message ?? String(cause), ...(String(cause?.stack ?? '').split('\n').filter((l) => l.includes('.test.mjs')).slice(0, 2))].join('\n');
    yield `::error title=${esc(event.data.name)}::${esc(text.slice(0, 2000))}\n`;
  }
}
