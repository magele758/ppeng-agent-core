/**
 * Suppress only Node's `node:sqlite` ExperimentalWarning.
 *
 * `node:sqlite` is shipped as experimental in Node 22, and prints the warning
 * once per process. We rely on it for the runtime store, so the warning is
 * pure noise — but blanket-disabling all warnings would hide future genuine
 * issues. This filter is targeted: only the SQLite experimental notice gets
 * dropped; everything else passes through to the default printer.
 *
 * Set `RAW_AGENT_KEEP_SQLITE_WARNING=1` to opt back in (e.g. for an upgrade
 * audit when checking what's still experimental).
 */
const KEEP = ['1', 'true', 'yes'].includes(
  String(process.env.RAW_AGENT_KEEP_SQLITE_WARNING ?? '').toLowerCase()
);

interface MaybeNamedWarning extends Error {
  code?: string;
}

if (!KEEP) {
  // Node 22's default 'warning' printer is itself an internal listener, so
  // simply adding another listener does NOT suppress the default output (this
  // surprised us during testing). Strip existing listeners first, then attach
  // a single filtering listener that reimplements the default format for
  // anything we don't want to swallow.
  process.removeAllListeners('warning');
  process.on('warning', (warning: MaybeNamedWarning) => {
    if (warning?.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message ?? '')) {
      return;
    }
    const name = warning.name ?? 'Warning';
    const tag = warning.code ? `${name} [${warning.code}]` : name;
    process.stderr.write(`(node:${process.pid}) ${tag}: ${warning.message}\n`);
    if (warning.stack && warning.name !== 'DeprecationWarning') {
      process.stderr.write(`${warning.stack}\n`);
    }
  });
}
