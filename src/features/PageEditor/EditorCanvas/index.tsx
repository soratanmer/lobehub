'use client';

import { type CSSProperties } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas as SharedEditorCanvas } from '@/features/EditorCanvas';
import { usePermission } from '@/hooks/usePermission';

import { usePageEditorStore } from '../store';
import { useAskCopilotItem } from './useAskCopilotItem';
import { useSlashItems } from './useSlashItems';

interface EditorCanvasProps {
  placeholder?: string;
  style?: CSSProperties;
}

const EditorCanvas = memo<EditorCanvasProps>(({ placeholder, style }) => {
  const { t } = useTranslation(['file', 'ui']);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const editor = usePageEditorStore((s) => s.editor);
  const documentId = usePageEditorStore((s) => s.documentId);

  const slashItems = useSlashItems();
  const askCopilotItem = useAskCopilotItem(editor);

  return (
    <SharedEditorCanvas
      disabled={!canEdit}
      documentId={documentId}
      editor={editor}
      placeholder={placeholder || t('pageEditor.editorPlaceholder')}
      slashItems={slashItems}
      style={style}
      toolbarExtraItems={askCopilotItem}
      unsavedChangesGuard={{
        enabled: true,
        message: t('form.unsavedWarning', { ns: 'ui' }),
        title: t('form.unsavedChanges', { ns: 'ui' }),
      }}
    />
  );
});

export default EditorCanvas;
