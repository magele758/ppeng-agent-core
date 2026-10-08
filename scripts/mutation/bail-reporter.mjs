/**
 * node:test reporter for mutant runs: exits with code 1 on the first failing test, so a killed
 * mutant does not pay for the rest of the file. Mutant runs only need pass / fail, not output.
 */
export default async function* bailReporter(source) {
  for await (const event of source) {
    if (event.type === 'test:fail' && event.data.details?.type !== 'suite') process.exit(1);
  }
  yield '';
}
