import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';

interface UseDropdownMenuProps {
  agentId: string;
  agentTitle: string;
  isBuiltinAgent: boolean;
  onClose: () => void;
}

export const useDropdownMenu = ({
  agentId,
  isBuiltinAgent,
  onClose,
}: UseDropdownMenuProps): MenuProps['items'] => {
  const { t } = useTranslation(['common', 'chat']);
  const { modal } = App.useApp();
  const removeAgent = useHomeStore((s) => s.removeAgent);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const handleDelete = () => {
    if (!canEdit) return;
    modal.confirm({
      cancelText: t('cancel'),
      centered: true,
      okButtonProps: { danger: true },
      okText: t('delete'),
      onOk: async () => {
        await removeAgent(agentId);
        onClose();
      },
      title: t('confirmRemoveSessionItemAlert', { ns: 'chat' }),
    });
  };

  return useMemo(() => {
    if (isBuiltinAgent) return [];

    return [
      {
        danger: true,
        disabled: !canEdit,
        icon: <Icon icon={Trash2} />,
        key: 'delete',
        label: t('delete'),
        onClick: handleDelete,
      },
    ].filter(Boolean) as MenuProps['items'];
  }, [canEdit, t, isBuiltinAgent, handleDelete]);
};
