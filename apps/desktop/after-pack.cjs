'use strict';

const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { adHocCodesignArgs } = require('../../scripts/lib/desktop-mac-sign.cjs');

/**
 * electron-builder `identity: null` leaves Electron's broken signature.
 * macOS then reports the app as damaged. Ad-hoc sign after pack.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', adHocCodesignArgs(appPath), { stdio: 'inherit' });
};
