'use client';

import { api } from '@/lib/api';
import {
  bindingFromPickerValue,
  childBrowsePath,
  decodeWorkspacePickerValue,
  encodeWorkspacePickerValue,
  formatRootList,
  parseCloudFoldersResponse,
  parseCreatedCloudFolder,
  parseCreatedProject,
  parseFsBrowse,
  parseFsValidate,
  parseProjectsResponse,
  canChangeWorkspaceBinding,
  pickerValueFromBinding,
  resolveBoundRoots,
  validateNewCloudDraft,
  validateNewProjectDraft,
  workspaceAvailabilityFrom,
  type FsBrowseResult,
  type LabCloudFolder,
  type LabProject,
  type ProjectRootDraft,
  type RootAvailability,
  type WorkspaceAvailability,
  type WorkspaceBinding
} from '@/lib/workspace-binding';
import { useI18n } from '@/lib/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type DraftKind = 'new_project' | 'new_cloud' | null;

type DraftRoot = ProjectRootDraft & { key: string };

function newDraftRoot(): DraftRoot {
  return { key: `${Date.now()}-${Math.random().toString(16).slice(2)}`, path: '', alias: '' };
}

async function validatePath(path: string, invalidResponse: string) {
  // 400 body is `{ ok:false, code, message }` — do not go through api() which
  // throws and drops the structured result.
  const res = await fetch('/api/fs/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  const parsed = parseFsValidate(data);
  if (parsed.ok || parsed.error || parsed.code) return parsed;
  return { ok: false, error: res.ok ? invalidResponse : `HTTP ${res.status}` };
}

async function browsePath(path: string) {
  const q = path ? `?path=${encodeURIComponent(path)}` : '';
  return parseFsBrowse(await api(`/api/fs/browse${q}`));
}

export function WorkspacePicker({
  binding,
  bound,
  disabled,
  onBindingChange,
  onAvailabilityChange
}: {
  binding: WorkspaceBinding;
  bound: boolean;
  disabled?: boolean;
  onBindingChange: (next: WorkspaceBinding) => void;
  onAvailabilityChange?: (next: WorkspaceAvailability) => void;
}) {
  const { t } = useI18n();
  const sealed = !canChangeWorkspaceBinding(bound, binding);
  const locked = Boolean(disabled || sealed);
  const [projects, setProjects] = useState<LabProject[]>([]);
  const [folders, setFolders] = useState<LabCloudFolder[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftKind>(null);
  const [newName, setNewName] = useState('');
  const [newRoots, setNewRoots] = useState<DraftRoot[]>([newDraftRoot()]);
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [browse, setBrowse] = useState<FsBrowseResult | null>(null);
  const [browseForKey, setBrowseForKey] = useState<string | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [roots, setRoots] = useState<RootAvailability[]>([]);
  const [checking, setChecking] = useState(false);
  const onAvailRef = useRef(onAvailabilityChange);
  const rootsRef = useRef(roots);
  const bindKey = `${binding.kind}:${binding.projectId ?? ''}:${binding.cloudFolderId ?? ''}`;
  const bindKeyRef = useRef(bindKey);
  onAvailRef.current = onAvailabilityChange;
  rootsRef.current = roots;

  const selectedProject = useMemo(
    () =>
      binding.kind === 'project' ? projects.find((p) => p.id === binding.projectId) ?? null : null,
    [binding, projects]
  );
  const selectedFolder = useMemo(
    () =>
      binding.kind === 'cloud_folder'
        ? folders.find((f) => f.id === binding.cloudFolderId) ?? null
        : null,
    [binding, folders]
  );

  const reloadCatalog = useCallback(async () => {
    setLoadErr(null);
    const [projRes, folderRes] = await Promise.allSettled([
      api('/api/projects'),
      api('/api/cloud-folders')
    ]);
    if (projRes.status === 'fulfilled') {
      setProjects(parseProjectsResponse(projRes.value));
    } else {
      setProjects([]);
    }
    if (folderRes.status === 'fulfilled') {
      setFolders(parseCloudFoldersResponse(folderRes.value));
    } else {
      setFolders([]);
    }
    if (projRes.status === 'rejected' && folderRes.status === 'rejected') {
      setLoadErr(t('play.workspacePicker.loadErr'));
    }
  }, [t]);

  useEffect(() => {
    void reloadCatalog();
  }, [reloadCatalog]);

  useEffect(() => {
    let cancelled = false;
    const report = (nextRoots: RootAvailability[], nextChecking: boolean) => {
      onAvailRef.current?.(
        workspaceAvailabilityFrom(binding, nextRoots, { bound: sealed, checking: nextChecking })
      );
    };
    const keyChanged = bindKeyRef.current !== bindKey;
    bindKeyRef.current = bindKey;
    const startRoots = keyChanged ? [] : rootsRef.current;
    if (binding.kind === 'default') {
      setRoots([]);
      setChecking(false);
      report([], false);
      return;
    }
    if (keyChanged) setRoots([]);
    setChecking(true);
    report(startRoots, true);
    void (async () => {
      try {
        let project = selectedProject;
        let folder = selectedFolder;
        if (binding.kind === 'project' && binding.projectId && !project) {
          try {
            project = parseCreatedProject(
              await api(`/api/projects/${encodeURIComponent(binding.projectId)}`)
            );
            if (project && !cancelled) {
              setProjects((prev) => (prev.some((p) => p.id === project!.id) ? prev : [...prev, project!]));
            }
          } catch {
            project = null;
          }
        }
        if (binding.kind === 'cloud_folder' && binding.cloudFolderId && !folder) {
          try {
            const parsed = parseCloudFoldersResponse(
              await api(`/api/cloud-folders/${encodeURIComponent(binding.cloudFolderId)}`)
            );
            folder = parsed[0] ?? null;
            if (folder && !cancelled) {
              setFolders((prev) => (prev.some((f) => f.id === folder!.id) ? prev : [...prev, folder!]));
            }
          } catch {
            folder = null;
          }
        }
        if (cancelled) return;
        if (
          (binding.kind === 'project' && !binding.projectId) ||
          (binding.kind === 'cloud_folder' && !binding.cloudFolderId)
        ) {
          setRoots([]);
          report([], false);
          return;
        }
        const targets = resolveBoundRoots({ binding, project, folder });
        if (!targets.length) {
          setRoots([]);
          report([], false);
          return;
        }
        const invalidResponse = t('play.workspacePicker.invalidResponse');
        const next = await Promise.all(
          targets.map(async (target): Promise<RootAvailability> => {
            try {
              const v = await validatePath(target.path, invalidResponse);
              return {
                path: target.path,
                alias: target.alias,
                ok: v.ok,
                realPath: v.realPath,
                error: v.error,
                code: v.code
              };
            } catch (e) {
              return {
                path: target.path,
                alias: target.alias,
                ok: false,
                error: e instanceof Error ? e.message : String(e)
              };
            }
          })
        );
        if (cancelled) return;
        setRoots(next);
        report(next, false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bindKey, binding, bound, sealed, selectedFolder, selectedProject, t]);

  const selectValue = draft
    ? encodeWorkspacePickerValue({ kind: draft })
    : encodeWorkspacePickerValue(pickerValueFromBinding(binding));

  const label = (() => {
    switch (binding.kind) {
      case 'project':
        return selectedProject?.name ? `Project · ${selectedProject.name}` : 'Project';
      case 'cloud_folder':
        return selectedFolder?.name
          ? t('play.workspacePicker.cloudNamed', { name: selectedFolder.name })
          : t('play.workspacePicker.cloudGroup');
      case 'default':
        return t('play.workspacePicker.defaultLabel');
      default: {
        const _exhaustive: never = binding.kind;
        return _exhaustive;
      }
    }
  })();

  const shownRoots = resolveBoundRoots({
    binding,
    project: selectedProject,
    folder: selectedFolder
  });

  const openBrowse = async (key: string, startPath: string) => {
    setBrowseForKey(key);
    setBrowseBusy(true);
    setLocalErr(null);
    try {
      setBrowse(await browsePath(startPath));
    } catch (e) {
      setBrowse({ path: startPath, entries: [] });
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowseBusy(false);
    }
  };

  const applyBinding = (next: WorkspaceBinding) => {
    setDraft(null);
    setLocalErr(null);
    setLocalMsg(null);
    setBrowse(null);
    setBrowseForKey(null);
    onBindingChange(next);
  };

  const onSelectChange = (raw: string) => {
    const value = decodeWorkspacePickerValue(raw);
    if (value.kind === 'new_project') {
      setDraft('new_project');
      setNewName('');
      setNewRoots([newDraftRoot()]);
      setLocalErr(null);
      setLocalMsg(null);
      return;
    }
    if (value.kind === 'new_cloud') {
      setDraft('new_cloud');
      setNewName('');
      setLocalErr(null);
      setLocalMsg(null);
      return;
    }
    const next = bindingFromPickerValue(value);
    if (next) applyBinding(next);
  };

  const createProject = async () => {
    const draftRoots = newRoots.map((r) => ({ path: r.path.trim(), alias: r.alias?.trim() }));
    const checked = validateNewProjectDraft(newName, draftRoots);
    if (!checked.ok) {
      setLocalErr(checked.error);
      return;
    }
    setBusy(true);
    setLocalErr(null);
    try {
      const usable: Array<{ path: string; alias?: string; primary?: boolean }> = [];
      for (const [idx, root] of draftRoots.filter((r) => r.path).entries()) {
        const v = await validatePath(root.path, t('play.workspacePicker.invalidResponse'));
        if (!v.ok) {
          setLocalErr(
            t('play.workspacePicker.pathInvalidDetail', {
              name: root.alias || root.path,
              detail: v.error || v.code || t('play.workspacePicker.pathInvalid')
            })
          );
          return;
        }
        usable.push({
          path: v.realPath ?? root.path,
          ...(root.alias ? { alias: root.alias } : {}),
          ...(idx === 0 ? { primary: true } : {})
        });
      }
      const created = parseCreatedProject(
        await api('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newName.trim(),
            roots: usable
          })
        })
      );
      if (!created) throw new Error(t('play.workspacePicker.createProjectFailed'));
      setProjects((prev) => [...prev.filter((p) => p.id !== created.id), created]);
      setLocalMsg(t('play.workspacePicker.created', { name: created.name }));
      applyBinding({ kind: 'project', projectId: created.id });
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createCloud = async () => {
    const checked = validateNewCloudDraft(newName);
    if (!checked.ok) {
      setLocalErr(checked.error);
      return;
    }
    setBusy(true);
    setLocalErr(null);
    try {
      const created = parseCreatedCloudFolder(
        await api('/api/cloud-folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() })
        })
      );
      if (!created) throw new Error(t('play.workspacePicker.createCloudFailed'));
      setFolders((prev) => [...prev.filter((f) => f.id !== created.id), created]);
      setLocalMsg(t('play.workspacePicker.created', { name: created.name }));
      applyBinding({ kind: 'cloud_folder', cloudFolderId: created.id });
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unavailable = roots.filter((r) => !r.ok);
  const warn = workspaceAvailabilityFrom(binding, roots, { bound: sealed, checking }).reason;

  return (
    <div className="workspace-picker" id="workspacePicker">
      <label className="field field--inline">
        <span>{t('play.workspace')}</span>
        <select
          value={selectValue}
          disabled={locked}
          title={
            sealed
              ? t('play.workspacePicker.boundTitle')
              : t('play.workspacePicker.unboundTitle')
          }
          aria-label={t('play.workspace')}
          onChange={(e) => onSelectChange(e.target.value)}
        >
          <option value="default">{t('play.workspacePicker.defaultOption')}</option>
          <optgroup label="Project">
            {projects.map((p) => (
              <option key={p.id} value={encodeWorkspacePickerValue({ kind: 'project', projectId: p.id })}>
                {p.name}
              </option>
            ))}
            {!locked ? <option value="__new_project">{t('play.workspacePicker.newProject')}</option> : null}
          </optgroup>
          <optgroup label={t('play.workspacePicker.cloudGroup')}>
            {folders.map((f) => (
              <option
                key={f.id}
                value={encodeWorkspacePickerValue({ kind: 'cloud_folder', cloudFolderId: f.id })}
              >
                {f.name}
                {f.backend === 's3' ? ' · S3' : ` · ${t('play.workspacePicker.local')}`}
              </option>
            ))}
            {!locked ? <option value="__new_cloud">{t('play.workspacePicker.newCloud')}</option> : null}
          </optgroup>
        </select>
      </label>

      {loadErr ? <p className="workspace-picker__hint muted">{loadErr}</p> : null}

      {sealed || (shownRoots.length > 0 && !draft) ? (
        <p className="workspace-picker__roots muted" title={formatRootList(shownRoots)}>
          {sealed ? t('play.workspacePicker.sealed') : ''}
          {label}
          {shownRoots.length ? ` · ${formatRootList(shownRoots)}` : ''}
        </p>
      ) : null}

      {checking ? <p className="workspace-picker__hint muted">{t('play.workspacePicker.checking')}</p> : null}

      {warn ? (
        <p className="workspace-picker__warn" role="alert">
          {warn}
        </p>
      ) : null}

      {unavailable.length && !warn ? (
        <p className="workspace-picker__warn" role="alert">
          {t('play.workspacePicker.unavailable', {
            names: unavailable.map((r) => r.alias || r.path).join('、')
          })}
        </p>
      ) : null}

      {draft === 'new_project' && !locked ? (
        <div className="workspace-editor" aria-label={t('play.workspacePicker.newProjectAria')}>
          <label className="field field--inline">
            <span>{t('play.name')}</span>
            <input
              type="text"
              className="input-compact"
              value={newName}
              placeholder={t('play.workspacePicker.projectName')}
              autoComplete="off"
              onChange={(e) => setNewName(e.target.value)}
              aria-label={t('play.workspacePicker.projectNameAria')}
            />
          </label>
          {newRoots.map((root, idx) => (
            <div key={root.key} className="workspace-editor__root">
              <input
                type="text"
                className="input-compact workspace-editor__alias"
                value={root.alias ?? ''}
                placeholder={idx === 0 ? t('play.workspacePicker.aliasPrimary') : t('play.workspacePicker.alias')}
                aria-label={t('play.workspacePicker.rootAlias', { n: idx + 1 })}
                onChange={(e) =>
                  setNewRoots((prev) =>
                    prev.map((r) => (r.key === root.key ? { ...r, alias: e.target.value } : r))
                  )
                }
              />
              <input
                type="text"
                className="input-compact workspace-editor__path"
                value={root.path}
                placeholder={t('play.workspacePicker.absPath')}
                aria-label={t('play.workspacePicker.rootPath', { n: idx + 1 })}
                onChange={(e) =>
                  setNewRoots((prev) =>
                    prev.map((r) => (r.key === root.key ? { ...r, path: e.target.value } : r))
                  )
                }
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void openBrowse(root.key, root.path)}
              >
                {t('play.workspacePicker.browse')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  void validatePath(root.path.trim(), t('play.workspacePicker.invalidResponse'))
                    .then((v) => {
                      if (v.ok && v.realPath) {
                        setNewRoots((prev) =>
                          prev.map((r) => (r.key === root.key ? { ...r, path: v.realPath ?? r.path } : r))
                        );
                        setLocalMsg(t('play.workspacePicker.pathOk', { path: v.realPath }));
                        setLocalErr(null);
                      } else {
                        setLocalErr(v.error || v.code || t('play.workspacePicker.pathInvalid'));
                      }
                    })
                    .catch((e: unknown) => {
                      setLocalErr(e instanceof Error ? e.message : String(e));
                    });
                }}
              >
                {t('play.workspacePicker.validate')}
              </button>
              {newRoots.length > 1 ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={t('play.workspacePicker.removeRoot')}
                  onClick={() => setNewRoots((prev) => prev.filter((r) => r.key !== root.key))}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          <div className="workspace-editor__actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setNewRoots((prev) => [...prev, newDraftRoot()])}
            >
              {t('play.workspacePicker.addRoot')}
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void createProject()}>
              {busy ? t('play.creating') : t('play.workspacePicker.createAndUse')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {draft === 'new_cloud' && !locked ? (
        <div className="workspace-editor" aria-label={t('play.workspacePicker.newCloudAria')}>
          <label className="field field--inline">
            <span>{t('play.name')}</span>
            <input
              type="text"
              className="input-compact"
              value={newName}
              placeholder={t('play.workspacePicker.cloudName')}
              autoComplete="off"
              onChange={(e) => setNewName(e.target.value)}
              aria-label={t('play.workspacePicker.cloudNameAria')}
            />
          </label>
          <div className="workspace-editor__actions">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void createCloud()}>
              {busy ? t('play.creating') : t('play.workspacePicker.createAndUse')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {browseForKey && draft === 'new_project' ? (
        <div className="workspace-browse" aria-label={t('play.workspacePicker.browseAria')}>
          <div className="workspace-browse__bar">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!browse?.parent || browseBusy}
              onClick={() => {
                if (browse?.parent) void openBrowse(browseForKey, browse.parent);
              }}
            >
              {t('play.workspacePicker.parent')}
            </button>
            <code className="workspace-browse__path">{browse?.path || t('play.workspacePicker.defaultStart')}</code>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!browse?.path}
              onClick={() => {
                if (!browse?.path) return;
                setNewRoots((prev) =>
                  prev.map((r) => (r.key === browseForKey ? { ...r, path: browse.path } : r))
                );
                setBrowse(null);
                setBrowseForKey(null);
              }}
            >
              {t('play.workspacePicker.useCurrent')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setBrowse(null);
                setBrowseForKey(null);
              }}
            >
              {t('common.close')}
            </button>
          </div>
          {browseBusy ? <p className="muted">{t('play.workspacePicker.readingDir')}</p> : null}
          <ul className="workspace-browse__list">
            {(browse?.entries ?? [])
              .filter((e) => e.kind === 'dir')
              .map((e) => (
                <li key={e.name}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      void openBrowse(browseForKey, childBrowsePath(browse?.path ?? '', e));
                    }}
                  >
                    {e.name}/
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {localErr ? (
        <p className="workspace-picker__warn" role="alert">
          {localErr}
        </p>
      ) : null}
      {localMsg ? <p className="workspace-picker__hint muted">{localMsg}</p> : null}
    </div>
  );
}
