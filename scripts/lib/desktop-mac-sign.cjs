'use strict';

function adHocCodesignArgs(appPath) {
  return ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath];
}

module.exports = { adHocCodesignArgs };
