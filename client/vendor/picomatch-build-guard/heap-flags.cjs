'use strict';
// Parent V8 heap flags can override Worker.resourceLimits. Deny them at the
// actual module/Worker startup boundary; do not print NODE_OPTIONS or values.
const FLAG = '--(?:(?:max|initial)[-_](?:old|semi|young)[-_]space[-_]size(?:[-_]percentage)?|max[-_]heap[-_]size|huge[-_]max[-_]old[-_]generation[-_]size)';
const argumentFlag = new RegExp('^(' + FLAG + ')(?=$|[=\\s\\"\\\'])', 'i');
module.exports = function assertWorkerHeapFlagsAbsent() {
  const found = [];
  for (const argument of process.execArgv) {
    const match = argumentFlag.exec(argument);
    if (match) found.push(match[1]);
  }
  if ((process.env.NODE_OPTIONS || '') !== '') found.push('NODE_OPTIONS');
  if (!found.length) return;
  const error = new Error('PICOMATCH_WORKER_HEAP_FLAGS_UNSUPPORTED: clear NODE_OPTIONS and remove parent heap-size flags for frontend build/test; keep outer CI resource limits.');
  error.name = 'PicomatchBuildEnvironmentError';
  error.code = 'PICOMATCH_WORKER_HEAP_FLAGS_UNSUPPORTED';
  error.flags = [...new Set(found.map(flag => flag === 'NODE_OPTIONS' ? flag : flag.toLowerCase().replaceAll('_', '-')))].sort();
  throw error;
};
