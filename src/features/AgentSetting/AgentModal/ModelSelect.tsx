import { memo } from 'react';

import Select from '@/features/ModelSelect';

import { useStore } from '../store';

const ModelSelect = memo(() => {
  const [model, provider, disabled, updateConfig] = useStore((s) => [
    s.config.model,
    s.config.provider,
    s.disabled,
    s.setAgentConfig,
  ]);

  return (
    <Select
      disabled={disabled}
      value={{ model, provider }}
      onChange={(props) => {
        if (disabled) return;

        updateConfig(props);
      }}
    />
  );
});

export default ModelSelect;
