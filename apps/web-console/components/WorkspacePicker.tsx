'use client';

import { api } from '@/lib/api';
import {
  basenameFromPath,
  canChangeWorkspaceBinding,
  childBrowsePath,
  defaultProjectNameFromRoots,
  parseCloudFoldersResponse,
  parseCreatedCloudFolder,
  parseCreatedProject,
  parseFsBrowse,
  parseFsValidate,
  parseProjectsResponse,
  resolveBoundRoots,
  rootPathTaken,
  shortPath,
  translateWorkspaceBlock,
  validateNewCloudDraft,
  validateNewProjectDraft,
  workspaceAvailabilityFrom,
  type DraftValidationError,
  type FsBrowseResult,
  type LabCloudFolder,
  type LabProject,
  type ProjectRootDraft,
  type RootAvailability,
  type WorkspaceAvailability,
  type WorkspaceBinding
} from '@/lib/workspace-binding';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type PanelView = 'menu' | 'new_project' | 'new_cloud' | 'browse';
type BrowseTarget = 'draft' | 'project';
type DraftRoot = ProjectRootDraft & { key: string };

function newDraftRoot(path = '', alias = ''): DraftRoot {
  return { key: `${Date.now()}-${Math.random().toString(16).slice(2)}`, path, alias };
}

async function validatePath(path: string, invalidResponse: string) {
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

function draftErrorMessage(
  error: DraftValidationError,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
): string {
  switch (error) {
    case 'name_required':
      return t('play.workspacePicker.errNameRequired');
    case 'root_required':
      return t('play.workspacePicker.errRootRequired');
    case 'root_path_dup':
      return t('play.workspacePicker.errRootPathDup');
    case 'root_alias_dup':
      return t('play.workspacePicker.errRootAliasDup');
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [projects, setProjects] = useState<LabProject[]>([]);
  const [folders, setFolders] = useState<LabCloudFolder[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [view, setView] = useState<PanelView>('menu');
  const [browseReturn, setBrowseReturn] = useState<Exclude<PanelView, 'browse'>>('menu');
  const [browseTarget, setBrowseTarget] = useState<BrowseTarget>('draft');
  const [newName, setNewName] = useState('');
  const [newRoots, setNewRoots] = useState<DraftRoot[]>([]);
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [browse, setBrowse] = useState<FsBrowseResult | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [pastePath, setPastePath] = useState('');
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

  const formatReason = useCallback(
    (info: Parameters<typeof translateWorkspaceBlock>[0]) =>
      translateWorkspaceBlock(info, (key, vars) => t(key as MessageKey, vars)),
    [t]
  );

  const reportAvailability = useCallback(
    (nextRoots: RootAvailability[], nextChecking: boolean) => {
      onAvailRef.current?.(
        workspaceAvailabilityFrom(binding, nextRoots, {
          bound: sealed,
          checking: nextChecking,
          formatReason
        })
      );
    },
    [binding, formatReason, sealed]
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
    const keyChanged = bindKeyRef.current !== bindKey;
    bindKeyRef.current = bindKey;
    const startRoots = keyChanged ? [] : rootsRef.current;
    if (binding.kind === 'default') {
      setRoots([]);
      setChecking(false);
      reportAvailability([], false);
      return;
    }
    if (keyChanged) setRoots([]);
    setChecking(true);
    reportAvailability(startRoots, true);
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
          reportAvailability([], false);
          return;
        }
        const targets = resolveBoundRoots({ binding, project, folder });
        if (!targets.length) {
          setRoots([]);
          reportAvailability([], false);
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
        reportAvailability(next, false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bindKey, binding, reportAvailability, selectedFolder, selectedProject, t]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setView('menu');
    setBrowse(null);
    setLocalErr(null);
    setLocalMsg(null);
    setPastePath('');
  }, []);

  useEffect(() => {
    if (!panelOpen) return;
    const onDoc = (e: MouseEvent) => {
      const node = rootRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) closePanel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (view === 'browse') {
        setView(browseReturn);
        setBrowse(null);
        return;
      }
      if (view === 'new_project' || view === 'new_cloud') {
        setView('menu');
        return;
      }
      closePanel();
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [browseReturn, closePanel, panelOpen, view]);

  const shownRoots = resolveBoundRoots({
    binding,
    project: selectedProject,
    folder: selectedFolder
  });

  const summary = (() => {
    switch (binding.kind) {
      case 'project': {
        const name = selectedProject?.name || t('play.workspacePicker.projectGroup');
        const count = shownRoots.length;
        const extra = count > 1 ? t('play.workspacePicker.moreRoots', { count: count - 1 }) : '';
        const primary = shownRoots[0]?.path ? shortPath(shownRoots[0].path, 28) : '';
        return {
          title: name,
          meta: [primary, extra].filter(Boolean).join(' ')
        };
      }
      case 'cloud_folder':
        return {
          title: selectedFolder?.name
            ? t('play.workspacePicker.cloudNamed', { name: selectedFolder.name })
            : t('play.workspacePicker.cloudGroup'),
          meta: selectedFolder?.localPath ? shortPath(selectedFolder.localPath, 28) : ''
        };
      case 'default':
        return { title: t('play.workspacePicker.summaryDefault'), meta: '' };
      default: {
        const _exhaustive: never = binding.kind;
        return _exhaustive;
      }
    }
  })();

  const unavailable = roots.filter((r) => !r.ok);
  const warn = workspaceAvailabilityFrom(binding, roots, {
    bound: sealed,
    checking,
    formatReason
  }).reason;

  const openPanel = () => {
    if (disabled) return;
    setLocalErr(null);
    setLocalMsg(null);
    setView('menu');
    setPanelOpen((open) => !open);
  };

  const applyBinding = (next: WorkspaceBinding) => {
    setLocalErr(null);
    setLocalMsg(null);
    onBindingChange(next);
  };

  const startNewProject = () => {
    setNewName('');
    setNewRoots([]);
    setLocalErr(null);
    setLocalMsg(null);
    setView('new_project');
  };

  const startNewCloud = () => {
    setNewName('');
    setLocalErr(null);
    setLocalMsg(null);
    setView('new_cloud');
  };

  const openBrowse = async (target: BrowseTarget, returnTo: Exclude<PanelView, 'browse'>, startPath = '') => {
    setBrowseTarget(target);
    setBrowseReturn(returnTo);
    setView('browse');
    setBrowseBusy(true);
    setLocalErr(null);
    setPastePath(startPath);
    try {
      setBrowse(await browsePath(startPath));
    } catch (e) {
      setBrowse({ path: startPath, entries: [] });
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowseBusy(false);
    }
  };

  const goBrowse = async (path: string) => {
    setBrowseBusy(true);
    setLocalErr(null);
    try {
      setBrowse(await browsePath(path));
      setPastePath(path);
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowseBusy(false);
    }
  };

  const upsertProject = (project: LabProject) => {
    setProjects((prev) => [...prev.filter((p) => p.id !== project.id), project]);
  };

  const acceptFolder = async (rawPath: string) => {
    const path = rawPath.trim();
    if (!path) return;
    setBusy(true);
    setLocalErr(null);
    try {
      const v = await validatePath(path, t('play.workspacePicker.invalidResponse'));
      if (!v.ok) {
        setLocalErr(v.error || v.code || t('play.workspacePicker.pathInvalid'));
        return;
      }
      const real = v.realPath ?? path;
      if (browseTarget === 'draft') {
        if (rootPathTaken(newRoots, real)) {
          setLocalErr(t('play.workspacePicker.errRootPathDup'));
          return;
        }
        setNewRoots((prev) => [...prev, newDraftRoot(real, basenameFromPath(real))]);
        setView('new_project');
        setBrowse(null);
        setLocalMsg(t('play.workspacePicker.rootAdded', { path: real }));
        return;
      }
      if (!selectedProject || locked) return;
      if (rootPathTaken(selectedProject.roots, real)) {
        setLocalErr(t('play.workspacePicker.errRootPathDup'));
        return;
      }
      const updated = parseCreatedProject(
        await api(`/api/projects/${encodeURIComponent(selectedProject.id)}/roots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: real, alias: basenameFromPath(real) })
        })
      );
      if (!updated) throw new Error(t('play.workspacePicker.addRootFailed'));
      upsertProject(updated);
      setView('menu');
      setBrowse(null);
      setLocalMsg(t('play.workspacePicker.rootAdded', { path: real }));
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeProjectRoot = async (rootId: string) => {
    if (!selectedProject || locked) return;
    if (selectedProject.roots.length <= 1) {
      setLocalErr(t('play.workspacePicker.cannotRemoveLast'));
      return;
    }
    setBusy(true);
    setLocalErr(null);
    try {
      const updated = parseCreatedProject(
        await api(
          `/api/projects/${encodeURIComponent(selectedProject.id)}/roots/${encodeURIComponent(rootId)}`,
          { method: 'DELETE' }
        )
      );
      if (updated) upsertProject(updated);
      else {
        await reloadCatalog();
      }
      setLocalMsg(t('play.workspacePicker.rootRemoved'));
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createProject = async () => {
    const draftRoots = newRoots.map((r) => ({ path: r.path.trim(), alias: r.alias?.trim() }));
    const name =
      newName.trim() ||
      defaultProjectNameFromRoots(draftRoots) ||
      t('play.workspacePicker.createNameFallback');
    const checked = validateNewProjectDraft(name, draftRoots);
    if (!checked.ok) {
      setLocalErr(draftErrorMessage(checked.error, t));
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
            name,
            roots: usable
          })
        })
      );
      if (!created) throw new Error(t('play.workspacePicker.createProjectFailed'));
      upsertProject(created);
      setLocalMsg(t('play.workspacePicker.created', { name: created.name }));
      applyBinding({ kind: 'project', projectId: created.id });
      setView('menu');
      setNewRoots([]);
      setNewName('');
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createCloud = async () => {
    const checked = validateNewCloudDraft(newName);
    if (!checked.ok) {
      setLocalErr(draftErrorMessage(checked.error, t));
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
      setView('menu');
      setNewName('');
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rootCountLabel = (count: number) =>
    count === 1
      ? t('play.workspacePicker.summaryRootsOne')
      : t('play.workspacePicker.summaryRoots', { count });

  const renderChips = (
    items: Array<{ id?: string; key?: string; path: string; alias?: string; isPrimary?: boolean }>,
    onRemove?: (id: string) => void,
    canRemove = true
  ) => (
    <ul className="workspace-picker__chips">
      {items.map((item) => {
        const id = item.id ?? item.key ?? item.path;
        return (
          <li key={id} className="workspace-picker__chip" title={item.path}>
            <span className="workspace-picker__chip-name">
              {item.alias || basenameFromPath(item.path) || item.path}
            </span>
            <code className="workspace-picker__chip-path">{shortPath(item.path, 36)}</code>
            {item.isPrimary ? (
              <span className="workspace-picker__chip-badge">{t('play.workspacePicker.primaryBadge')}</span>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                className="workspace-picker__chip-remove"
                disabled={!canRemove || busy}
                aria-label={t('play.workspacePicker.removeRoot')}
                onClick={() => onRemove(id)}
              >
                ×
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="workspace-picker" id="workspacePicker" ref={rootRef}>
      <button
        type="button"
        className={`workspace-picker__summary${panelOpen ? ' is-open' : ''}${warn ? ' is-warn' : ''}`}
        disabled={disabled}
        aria-expanded={panelOpen}
        aria-haspopup="dialog"
        aria-controls="workspacePickerPanel"
        title={sealed ? t('play.workspacePicker.boundTitle') : t('play.workspacePicker.unboundTitle')}
        aria-label={`${t('play.workspace')} · ${summary.title}${summary.meta ? ` · ${summary.meta}` : ''}`}
        onClick={openPanel}
      >
        <span className="workspace-picker__kicker">{t('play.workspace')}</span>
        <span className="workspace-picker__value">
          {sealed ? `${t('play.workspacePicker.sealed')} · ` : ''}
          {summary.title}
        </span>
        {summary.meta ? <span className="workspace-picker__meta">{summary.meta}</span> : null}
        <span className="workspace-picker__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {panelOpen ? (
        <div
          className="workspace-picker__panel"
          id="workspacePickerPanel"
          role="dialog"
          aria-label={t('play.workspacePicker.panelTitle')}
        >
          {view === 'menu' ? (
            <>
              <div className="workspace-picker__panel-head">
                <div>
                  <h3 className="workspace-picker__panel-title">{t('play.workspacePicker.panelTitle')}</h3>
                  <p className="workspace-picker__hint muted">{t('play.workspacePicker.panelHint')}</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={closePanel}>
                  {t('common.close')}
                </button>
              </div>

              <div className="workspace-picker__choices" role="group" aria-label={t('play.workspace')}>
                <button
                  type="button"
                  aria-pressed={binding.kind === 'default'}
                  className={`workspace-picker__choice${binding.kind === 'default' ? ' is-active' : ''}`}
                  disabled={locked && binding.kind !== 'default'}
                  onClick={() => applyBinding({ kind: 'default' })}
                >
                  <span>{t('play.workspacePicker.defaultOption')}</span>
                </button>

                {projects.length ? (
                  <p className="workspace-picker__group">{t('play.workspacePicker.projectGroup')}</p>
                ) : null}
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={binding.kind === 'project' && binding.projectId === p.id}
                    className={`workspace-picker__choice${
                      binding.kind === 'project' && binding.projectId === p.id ? ' is-active' : ''
                    }`}
                    disabled={locked && !(binding.kind === 'project' && binding.projectId === p.id)}
                    onClick={() => applyBinding({ kind: 'project', projectId: p.id })}
                  >
                    <span>{p.name}</span>
                    <span className="workspace-picker__choice-meta">
                      {rootCountLabel(p.roots.length)}
                      {p.roots[0]?.path ? ` · ${shortPath(p.roots[0].path, 24)}` : ''}
                    </span>
                  </button>
                ))}

                {folders.length ? (
                  <p className="workspace-picker__group">{t('play.workspacePicker.cloudGroup')}</p>
                ) : null}
                {folders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={binding.kind === 'cloud_folder' && binding.cloudFolderId === f.id}
                    className={`workspace-picker__choice${
                      binding.kind === 'cloud_folder' && binding.cloudFolderId === f.id ? ' is-active' : ''
                    }`}
                    disabled={locked && !(binding.kind === 'cloud_folder' && binding.cloudFolderId === f.id)}
                    onClick={() => applyBinding({ kind: 'cloud_folder', cloudFolderId: f.id })}
                  >
                    <span>
                      {f.name}
                      {f.backend === 's3'
                        ? ` · ${t('play.workspacePicker.s3Badge')}`
                        : ` · ${t('play.workspacePicker.local')}`}
                    </span>
                    {f.localPath ? (
                      <span className="workspace-picker__choice-meta">{shortPath(f.localPath, 28)}</span>
                    ) : null}
                  </button>
                ))}
              </div>

              {binding.kind === 'project' ? (
                <div className="workspace-picker__folders">
                  <div className="workspace-picker__folders-head">
                    <h4>{t('play.workspacePicker.foldersTitle')}</h4>
                    <p className="muted">{t('play.workspacePicker.foldersHint')}</p>
                  </div>
                  {selectedProject?.roots.length
                    ? renderChips(
                        selectedProject.roots,
                        locked ? undefined : (id) => void removeProjectRoot(id),
                        !locked && selectedProject.roots.length > 1
                      )
                    : (
                      <p className="workspace-picker__hint muted">{t('play.workspacePicker.foldersEmpty')}</p>
                    )}
                  {!locked ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => void openBrowse('project', 'menu', selectedProject?.roots[0]?.path ?? '')}
                    >
                      {t('play.workspacePicker.addFolder')}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {!locked ? (
                <div className="workspace-picker__actions">
                  <button type="button" className="btn btn-sm" onClick={startNewProject}>
                    {t('play.workspacePicker.newProject')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={startNewCloud}>
                    {t('play.workspacePicker.newCloud')}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {view === 'new_project' && !locked ? (
            <div className="workspace-picker__form" aria-label={t('play.workspacePicker.newProjectAria')}>
              <div className="workspace-picker__panel-head">
                <div>
                  <h3 className="workspace-picker__panel-title">{t('play.workspacePicker.newProjectTitle')}</h3>
                  <p className="workspace-picker__hint muted">{t('play.workspacePicker.newProjectHint')}</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView('menu')}>
                  {t('play.workspacePicker.back')}
                </button>
              </div>
              {newRoots.length
                ? renderChips(newRoots, (key) => setNewRoots((prev) => prev.filter((r) => r.key !== key)))
                : (
                  <p className="workspace-picker__hint muted">{t('play.workspacePicker.foldersEmpty')}</p>
                )}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void openBrowse('draft', 'new_project', newRoots[0]?.path ?? '')}
              >
                {t('play.workspacePicker.addFolder')}
              </button>
              <label className="field">
                <span>{t('play.workspacePicker.nameOptional')}</span>
                <input
                  type="text"
                  className="input-compact"
                  value={newName}
                  placeholder={
                    defaultProjectNameFromRoots(newRoots) || t('play.workspacePicker.projectName')
                  }
                  autoComplete="off"
                  onChange={(e) => setNewName(e.target.value)}
                  aria-label={t('play.workspacePicker.projectNameAria')}
                />
              </label>
              <div className="workspace-picker__actions">
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void createProject()}>
                  {busy ? t('play.creating') : t('play.workspacePicker.createAndUse')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setView('menu');
                    setNewRoots([]);
                    setNewName('');
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : null}

          {view === 'new_cloud' && !locked ? (
            <div className="workspace-picker__form" aria-label={t('play.workspacePicker.newCloudAria')}>
              <div className="workspace-picker__panel-head">
                <div>
                  <h3 className="workspace-picker__panel-title">{t('play.workspacePicker.newCloudTitle')}</h3>
                  <p className="workspace-picker__hint muted">{t('play.workspacePicker.newCloudHint')}</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView('menu')}>
                  {t('play.workspacePicker.back')}
                </button>
              </div>
              <label className="field">
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
              <div className="workspace-picker__actions">
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void createCloud()}>
                  {busy ? t('play.creating') : t('play.workspacePicker.createAndUse')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView('menu')}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : null}

          {view === 'browse' ? (
            <div className="workspace-browse" aria-label={t('play.workspacePicker.browseAria')}>
              <div className="workspace-picker__panel-head">
                <div>
                  <h3 className="workspace-picker__panel-title">{t('play.workspacePicker.browseTitle')}</h3>
                  <p className="workspace-picker__hint muted">{t('play.workspacePicker.browseHint')}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setView(browseReturn);
                    setBrowse(null);
                  }}
                >
                  {t('play.workspacePicker.back')}
                </button>
              </div>
              <div className="workspace-browse__bar">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!browse?.parent || browseBusy}
                  onClick={() => {
                    if (browse?.parent) void goBrowse(browse.parent);
                  }}
                >
                  {t('play.workspacePicker.parent')}
                </button>
                <code className="workspace-browse__path">
                  {browse?.path || t('play.workspacePicker.defaultStart')}
                </code>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!browse?.path || busy}
                  onClick={() => void acceptFolder(browse?.path ?? '')}
                >
                  {t('play.workspacePicker.useCurrent')}
                </button>
              </div>
              <label className="field">
                <span>{t('play.workspacePicker.pathPaste')}</span>
                <span className="workspace-browse__paste">
                  <input
                    type="text"
                    className="input-compact"
                    value={pastePath}
                    autoComplete="off"
                    aria-label={t('play.workspacePicker.pathPasteAria')}
                    onChange={(e) => setPastePath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void acceptFolder(pastePath);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!pastePath.trim() || busy}
                    onClick={() => void acceptFolder(pastePath)}
                  >
                    {t('play.workspacePicker.usePasted')}
                  </button>
                </span>
              </label>
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
                          void goBrowse(childBrowsePath(browse?.path ?? '', e));
                        }}
                      >
                        {e.name}/
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          {loadErr ? <p className="workspace-picker__hint muted">{loadErr}</p> : null}
          {checking ? <p className="workspace-picker__hint muted">{t('play.workspacePicker.checking')}</p> : null}
          {warn ? (
            <p className="workspace-picker__warn" role="alert">
              {warn}
            </p>
          ) : null}
          {unavailable.length && !warn ? (
            <p className="workspace-picker__warn" role="alert">
              {t('play.workspacePicker.unavailable', {
                names: unavailable.map((r) => r.alias || r.path).join(', ')
              })}
            </p>
          ) : null}
          {localErr ? (
            <p className="workspace-picker__warn" role="alert">
              {localErr}
            </p>
          ) : null}
          {localMsg ? <p className="workspace-picker__hint muted">{localMsg}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
