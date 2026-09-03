import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import {
  CloudFolderPersist,
  MemoryCloudObjectStore,
  cloudFolderLocalPath,
  cloudFolderS3Prefix,
  isS3Configured,
  persistCloudFolderAfterWrite
} from '../dist/workspace/cloud-persist.js';
import { resolveEffectiveWorkspace } from '../dist/workspace/effective.js';

function tmpState() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-cloud-'));
  const store = new SqliteStateStore(join(dir, 'runtime.sqlite'));
  return { dir, store };
}

test('isS3Configured is false without RAW_AGENT_S3_*', () => {
  assert.equal(
    isS3Configured({
      RAW_AGENT_S3_BUCKET: '',
      RAW_AGENT_S3_ACCESS_KEY: '',
      RAW_AGENT_S3_SECRET_KEY: ''
    }),
    false
  );
  assert.equal(
    isS3Configured({
      RAW_AGENT_S3_BUCKET: 'b',
      RAW_AGENT_S3_ACCESS_KEY: 'k',
      RAW_AGENT_S3_SECRET_KEY: 's'
    }),
    true
  );
});

test('create cloud folder without S3 stays local', async () => {
  const { dir, store } = tmpState();
  try {
    const folders = store.cloudFolders();
    const rec = folders.create({
      name: 'Notes',
      backend: 'local',
      localPath: '',
      s3Prefix: ''
    });
    const localPath = cloudFolderLocalPath(dir, rec.id);
    mkdirSync(localPath, { recursive: true });
    folders.update(rec.id, { localPath, s3Prefix: cloudFolderS3Prefix(rec.id) });
    const got = folders.get(rec.id);
    assert.equal(got?.backend, 'local');
    assert.equal(got?.localPath, localPath);

    const persist = CloudFolderPersist.fromEnv({
      RAW_AGENT_S3_BUCKET: '',
      RAW_AGENT_S3_ACCESS_KEY: '',
      RAW_AGENT_S3_SECRET_KEY: ''
    });
    assert.equal(persist.isConfigured(), false);
    await persist.writeMarker(rec.id);
    await persist.persistAll(rec.id, localPath);

    const effective = await resolveEffectiveWorkspace({
      store,
      session: { metadata: { workspaceBinding: { kind: 'cloud_folder', cloudFolderId: rec.id } } },
      repoRoot: dir,
      stateDir: dir,
      persist
    });
    assert.equal(effective.kind, 'cloud_folder');
    assert.equal(effective.workspaceRoot, realpathSync(localPath));
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mock S3 persist and hydrate', async () => {
  const { dir, store } = tmpState();
  const objects = new MemoryCloudObjectStore();
  const persist = new CloudFolderPersist(objects, true);
  try {
    const rec = store.cloudFolders().create({
      name: 'Cloud',
      backend: 's3',
      localPath: '',
      s3Prefix: ''
    });
    const localPath = cloudFolderLocalPath(dir, rec.id);
    mkdirSync(localPath, { recursive: true });
    writeFileSync(join(localPath, 'hello.txt'), 'hi');
    store.cloudFolders().update(rec.id, { localPath, s3Prefix: cloudFolderS3Prefix(rec.id) });

    await persist.writeMarker(rec.id);
    const n = await persist.persistAll(rec.id, localPath);
    assert.ok(n >= 1);
    assert.ok([...objects.objects.keys()].some((k) => k.endsWith('hello.txt')));

    const other = join(dir, 'hydrated');
    mkdirSync(other, { recursive: true });
    const hydrated = await persist.hydrate(rec.id, other);
    assert.ok(hydrated >= 1);
    assert.equal(readFileSync(join(other, 'hello.txt'), 'utf8'), 'hi');

    await persistCloudFolderAfterWrite(
      {
        repoRoot: dir,
        stateDir: dir,
        workspaceRoot: localPath,
        session: {
          id: 's',
          metadata: { workspaceBinding: { kind: 'cloud_folder', cloudFolderId: rec.id } }
        },
        agent: { id: 'a', name: 'a', role: 'r', instructions: '', capabilities: [] }
      },
      join(localPath, 'hello.txt'),
      persist
    );
    assert.ok(objects.objects.has(`${cloudFolderS3Prefix(rec.id)}hello.txt`));
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
