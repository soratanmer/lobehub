import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const cssVarMock = {
  borderRadiusLG: '12px',
  colorFillSecondary: '#f2f2f2',
  colorText: '#111111',
};

const createLucideIcon = (name: string) => {
  const LucideIcon = ({ color = 'currentColor', size = 16 }: { color?: string; size?: number }) =>
    React.createElement(
      'svg',
      { 'data-icon': name, 'height': size, 'stroke': color, 'viewBox': '0 0 24 24', 'width': size },
      React.createElement('path', { d: 'M4 4h16v16H4z' }),
    );

  LucideIcon.displayName = name;

  return LucideIcon;
};

vi.mock('@lobechat/types', () => ({
  Plans: {
    Free: 'free',
    Hobby: 'hobby',
    Premium: 'premium',
    Starter: 'starter',
    Ultimate: 'ultimate',
  },
}));

vi.mock('@lobehub/ui', () => ({
  Center: ({ children, className, height, onClick, style, width }: any) =>
    React.createElement(
      'div',
      {
        className,
        onClick,
        style: { height, width, ...style },
      },
      children,
    ),
  Flexbox: ({ children, style }: any) => React.createElement('div', { style }, children),
  Icon: ({ color, icon: IconComponent, size }: any) =>
    React.createElement(
      'span',
      { className: 'anticon', role: 'img' },
      React.createElement(IconComponent, { color, size }),
    ),
  Tag: ({ children, style }: any) => React.createElement('span', { style }, children),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: (factory: any) => factory({ css: () => 'mock-icon', cssVar: cssVarMock }),
  cssVar: cssVarMock,
}));

vi.mock('lucide-react', () => ({
  Atom: createLucideIcon('Atom'),
  Box: createLucideIcon('Box'),
  CircleSlash: createLucideIcon('CircleSlash'),
  Sparkle: createLucideIcon('Sparkle'),
  Zap: createLucideIcon('Zap'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('PlanIcon', () => {
  it('keeps the small Premium icon as a rounded square with explicit centered layout', async () => {
    const { default: PlanIcon } = await import('./index');
    const { Plans } = await import('@lobechat/types');

    const html = renderToStaticMarkup(
      React.createElement(PlanIcon, { plan: Plans.Premium, size: 24 }),
    );

    expect(html).toContain('width:24px');
    expect(html).toContain('height:24px');
    expect(html).toContain('border-radius:8px');
    expect(html).toContain('display:flex');
    expect(html).toContain('align-items:center');
    expect(html).toContain('justify-content:center');
    expect(html).toContain('line-height:0');
    expect(html).not.toContain('class="anticon"');
    expect(html).toMatch(/<svg\b/);
  });
});
