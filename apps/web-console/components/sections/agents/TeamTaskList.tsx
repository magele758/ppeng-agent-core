'use client';

import { useI18n } from '@/lib/i18n';
import {
  TEAM_GRAPH_WORK_COLORS,
  type SwarmPlanTask,
  type TeamGraphWorkType
} from '@/lib/team-graph';

interface TeamTaskListProps {
  tasks: SwarmPlanTask[];
  workTypes: Record<string, TeamGraphWorkType>;
}

/** 团队图旁的子任务清单：图里节点会截断文字，这里给出完整标题、状态与角色。 */
export function TeamTaskList({ tasks, workTypes }: TeamTaskListProps) {
  const { t } = useI18n();
  if (tasks.length === 0) {
    return <p className="ag-panel__lead">{t('agents.teams.tasksEmpty')}</p>;
  }
  return (
    <ul className="ag-tasks" data-testid="team-task-list">
      {tasks.map((task, i) => (
        <li key={task.id} className="ag-task" data-testid={`team-task-${task.id}`}>
          <span
            className="ag-task__dot"
            aria-hidden="true"
            style={{ background: TEAM_GRAPH_WORK_COLORS[workTypes[task.id] ?? 'idle'] }}
          />
          <div className="ag-task__body">
            <span className="ag-task__title">
              <span className="ag-task__index">{i + 1}.</span> {task.title}
            </span>
            <span className="ag-task__meta">
              <span className="chip chip-muted">{task.status}</span>
              {task.requiredRole ? <span>{t('agents.teams.taskRole', { role: task.requiredRole })}</span> : null}
              <span>
                {t('agents.teams.taskOwner', { owner: task.ownerAgentId || t('agents.teams.taskUnassigned') })}
              </span>
              {task.blockedBy?.length ? (
                <span>{t('agents.teams.taskBlockedBy', { count: task.blockedBy.length })}</span>
              ) : null}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
