import { ActionIcon, copyToClipboard, type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { CopyIcon, LinkIcon, MoreHorizontal, Trash } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const TaskDetailHeaderActions = memo(() => {
  const { t } = useTranslation(['chat', 'common']);
  const { modal, message } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const appOrigin = useAppOrigin();
  const { allowed: canEditTask } = usePermission('create_content');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const deleteTask = useTaskStore((s) => s.deleteTask);

  const triggerDelete = useCallback(() => {
    if (!canEditTask) return;
    if (!taskId) return;
    modal.confirm({
      centered: true,
      content: t('taskDetail.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('taskDetail.deleteConfirm.ok'),
      onOk: async () => {
        await deleteTask(taskId);
        navigate('/tasks');
      },
      title: t('taskDetail.deleteConfirm.title'),
      type: 'error',
    });
  }, [canEditTask, taskId, modal, t, deleteTask, navigate]);

  const menuItems = useMemo<DropdownItem[]>(() => {
    if (!taskId) return [];

    const taskUrl = `${appOrigin}/task/${taskId}`;

    return [
      {
        icon: <Icon icon={CopyIcon} />,
        key: 'copyId',
        label: t('taskList.contextMenu.copyId'),
        onClick: async () => {
          await copyToClipboard(taskId);
          message.success(t('taskList.contextMenu.copyIdSuccess'));
        },
      },
      {
        icon: <Icon icon={LinkIcon} />,
        key: 'copyLink',
        label: t('taskList.contextMenu.copyLink'),
        onClick: async () => {
          await copyToClipboard(taskUrl);
          message.success(t('taskList.contextMenu.copyLinkSuccess'));
        },
      },
      { type: 'divider' },
      {
        danger: true,
        disabled: !canEditTask,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: triggerDelete,
      },
    ];
  }, [taskId, appOrigin, t, message, triggerDelete, canEditTask]);

  if (!taskId) return null;

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontal} size={'small'} />
    </DropdownMenu>
  );
});

export default TaskDetailHeaderActions;
