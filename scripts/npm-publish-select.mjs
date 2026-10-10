#!/usr/bin/env node
/** Decide whether this GitHub event should publish. Does not call npm. */
import { appendFileSync } from 'node:fs';
import { shouldPublishNpm } from './publish-npm-lib.mjs';

const publish = shouldPublishNpm({
  eventName: process.env.GITHUB_EVENT_NAME ?? '',
  prerelease: process.env.NPM_PUBLISH_PRERELEASE ?? '',
  tagName: process.env.NPM_PUBLISH_TAG ?? '',
});
const line = `publish=${publish ? 'true' : 'false'}`;
console.log(line);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
