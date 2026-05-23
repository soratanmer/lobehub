import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/lobe-team/settings/general';

interface WorkspaceMock {
  activeWorkspaceId: string;
  workspaces: { id: string; slug: string }[];
}

interface NavPanelDraggableMockProps {
  activeContent: {
    key: string;
    node: ReactNode;
  };
}

const workspaceState: WorkspaceMock = {
  activeWorkspaceId: 'workspace-1',
  workspaces: [{ id: 'workspace-1', slug: 'lobe-team' }],
};

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname }),
}));

vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: (selector: (state: WorkspaceMock) => unknown) => selector(workspaceState),
  workspaceSelectors: {
    activeWorkspace: (s: WorkspaceMock) =>
      s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId) ?? null,
  },
}));

vi.mock('@/routes/(main)/home/_layout/SidebarContent', () => ({
  default: () => <div>Home sidebar</div>,
}));

vi.mock('@/features/WorkspaceSetting/SideBar/Content', () => ({
  default: () => <div>Workspace settings sidebar</div>,
}));

vi.mock('@/routes/(main)/settings/_layout/SidebarContent', () => ({
  default: () => <div>Personal settings sidebar</div>,
}));

vi.mock('./components/NavPanelDraggable', () => ({
  NavPanelDraggable: ({ activeContent }: NavPanelDraggableMockProps) => (
    <div data-nav-key={activeContent.key}>{activeContent.node}</div>
  ),
}));

describe('NavPanel', () => {
  beforeEach(() => {
    pathname = '/lobe-team/settings/general';
  });

  it('uses workspace settings sidebar instead of a stale home snapshot on workspace settings routes', async () => {
    const { default: NavPanel, NavPanelPortal } = await import('./index');

    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Stale home snapshot</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace settings sidebar')).toBeInTheDocument();
    });
    expect(screen.queryByText('Stale home snapshot')).not.toBeInTheDocument();
  });

  it('uses personal settings sidebar instead of a stale home snapshot on user settings routes', async () => {
    pathname = '/settings/profile';
    const { default: NavPanel, NavPanelPortal } = await import('./index');

    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Stale home snapshot</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText('Personal settings sidebar')).toBeInTheDocument();
    });
    expect(screen.queryByText('Stale home snapshot')).not.toBeInTheDocument();
  });
});
