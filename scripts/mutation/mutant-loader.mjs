/**
 * `node --import` hook used by run-mutation.mjs: when MUTATION_TARGET is set, the ES module at that
 * path is served from MUTATION_SOURCE instead of disk. Mutants therefore never touch dist files,
 * so parallel runs cannot see each other's mutants and a crash cannot leave a mutated file behind.
 * MUTATION_HIT (optional) gets a line appended when the target is actually loaded.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const target = process.env.MUTATION_TARGET;
if (target) {
  const targetUrl = pathToFileURL(target).href;
  const source = readFileSync(process.env.MUTATION_SOURCE, 'utf8');
  const hitFile = process.env.MUTATION_HIT;
  registerHooks({
    load(url, context, nextLoad) {
      if (url.split(/[?#]/)[0] !== targetUrl) return nextLoad(url, context);
      if (hitFile) appendFileSync(hitFile, `${url}\n`);
      return { format: 'module', source, shortCircuit: true };
    },
  });
}
