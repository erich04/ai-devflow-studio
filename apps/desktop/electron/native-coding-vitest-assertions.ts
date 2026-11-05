// Inject the same predicate into the worker and the reporter, where Vitest has
// already serialized the error. A matcher that throws during setup has its
// own first stack frame. Only a false matcher verdict originates in expect.
export const vitestAssertion = String.raw`(error) => {
  if (error?.name === 'AssertionError') return true;
  if (error?.name !== 'Error' || !Object.hasOwn(error, 'actual') || !Object.hasOwn(error, 'expected')) return false;
  const frame = String(error.stack ?? '').split('\n').find(line => /^\s+at\s/u.test(line));
  return !!frame && /\/node_modules\/@vitest\/expect\/dist\/[^()\s]+\.[cm]?js:\d+:\d+\)?$/u.test(frame.replaceAll('\\', '/'));
}`
