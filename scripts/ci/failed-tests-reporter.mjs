// node --test reporter: one JSON line per failing test, consumed by retry-failed-tests.mjs.
export default async function* failedTestsReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const { file, name, nesting, details } = event.data;
    const error = details?.error;
    yield `${JSON.stringify({
      file: file ?? null,
      name,
      nesting,
      failureType: error?.failureType ?? null,
      message: String(error?.cause?.message ?? error?.message ?? '').slice(0, 500)
    })}\n`;
  }
}
