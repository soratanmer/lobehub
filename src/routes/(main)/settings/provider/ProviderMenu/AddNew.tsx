'use client';

import { ActionIcon, Tooltip } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import CreateNewProvider from '../features/CreateNewProvider';

const AddNewProvider = () => {
  const { t } = useTranslation('modelProvider');
  const [open, setOpen] = useState(false);
  const { allowed: canManageProvider, reason } = usePermission('manage_provider_key');

  const button = (
    <ActionIcon
      disabled={!canManageProvider}
      icon={PlusIcon}
      size={'small'}
      title={canManageProvider ? t('menu.addCustomProvider') : undefined}
      onClick={() => {
        if (!canManageProvider) return;
        setOpen(true);
      }}
    />
  );

  return (
    <>
      {canManageProvider ? button : <Tooltip title={reason}>{button}</Tooltip>}
      <CreateNewProvider open={open} onClose={() => setOpen(false)} />
    </>
  );
};

export default AddNewProvider;
