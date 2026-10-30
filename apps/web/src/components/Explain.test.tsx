import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { AI_CHAT_OPEN_EVENT, type AiChatOpenDetail } from '../lib/ai-chat-events';
import type { Explanation } from '../lib/explanations';
import { AskAIAction, ExplainButton, ExplainPanel, HelpTip } from './Explain';

const full: Explanation = {
  id: 'test.full',
  title: 'Chỉ số thử nghiệm',
  summary: 'Tóm tắt ngắn cho tooltip.',
  what: 'Đây là phần giải thích khái niệm.',
  why: 'Đây là lý do nó quan trọng.',
  formula: 'Chỉ số = A / B × 100',
  howToRead: 'Đây là cách hiểu con số.',
  limitations: ['Giới hạn thứ nhất', 'Giới hạn thứ hai'],
  assistantType: 'SAVINGS',
  aiPrompt: 'Giải thích chỉ số thử nghiệm của tôi.',
  source: 'test',
};

const minimal: Explanation = {
  id: 'test.minimal',
  title: 'Chỉ số tối giản',
  summary: 'Chỉ có phần tóm tắt.',
  assistantType: 'ANALYTICS',
  aiPrompt: 'Giải thích chỉ số tối giản.',
  source: 'test',
};

afterEach(() => {
  document.body.style.overflow = '';
});

describe('HelpTip (Level A)', () => {
  it('shows the short explanation and opens the detailed panel from the same text', async () => {
    const user = userEvent.setup();
    render(<HelpTip label="Chỉ số thử nghiệm" explanation={full} />);

    const tooltipText = screen.getByText(full.summary);
    expect(tooltipText).toBeInTheDocument();

    await user.click(screen.getByLabelText('Giải thích Chỉ số thử nghiệm'));
    expect(screen.getByText(full.summary)).toBeVisible();

    await user.click(
      screen.getByRole('button', { name: /Giải thích chi tiết: Chỉ số thử nghiệm/ }),
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: full.title })).toBeInTheDocument();
    // The tooltip and the panel reuse the same wording, so they cannot drift.
    expect(within(dialog).getAllByText(full.summary).length).toBeGreaterThan(0);
  });

  it('keeps supporting plain children without a panel', async () => {
    const user = userEvent.setup();
    render(<HelpTip label="Đơn giản">Nội dung ngắn</HelpTip>);

    await user.click(screen.getByLabelText('Giải thích Đơn giản'));
    expect(screen.getByText('Nội dung ngắn')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Giải thích chi tiết/ })).not.toBeInTheDocument();
  });
});

describe('ExplainButton and ExplainPanel (Level B)', () => {
  it('renders only the sections that have verified content', async () => {
    const user = userEvent.setup();
    render(<ExplainButton explanation={full} />);

    await user.click(screen.getByRole('button', { name: 'Giải thích: Chỉ số thử nghiệm' }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('Đây là gì?')).toBeInTheDocument();
    expect(within(dialog).getByText('Vì sao quan trọng?')).toBeInTheDocument();
    expect(within(dialog).getByText('Cách tính')).toBeInTheDocument();
    expect(within(dialog).getByText('Cách hiểu')).toBeInTheDocument();
    expect(within(dialog).getByText('Giới hạn')).toBeInTheDocument();
    expect(within(dialog).getByText('Chỉ số = A / B × 100')).toBeInTheDocument();
    expect(within(dialog).getByText('Giới hạn thứ hai')).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('omits empty sections instead of rendering placeholders', async () => {
    const user = userEvent.setup();
    render(<ExplainButton explanation={minimal} />);

    await user.click(screen.getByRole('button', { name: 'Giải thích: Chỉ số tối giản' }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).queryByText('Cách tính')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Giới hạn')).not.toBeInTheDocument();
    expect(within(dialog).getByText(minimal.summary)).toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<ExplainButton explanation={full} />);
    const trigger = screen.getByRole('button', { name: 'Giải thích: Chỉ số thử nghiệm' });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('traps Tab inside the panel', async () => {
    const user = userEvent.setup();
    render(<ExplainButton explanation={full} />);
    await user.click(screen.getByRole('button', { name: 'Giải thích: Chỉ số thử nghiệm' }));

    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(first).toHaveFocus();

    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('uses a bottom sheet on small screens and a side drawer on desktop', () => {
    render(<ExplainPanel explanation={full} open onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-h-[85vh]');
    expect(dialog.className).toContain('rounded-t-2xl');
    expect(dialog.className).toContain('sm:w-[27rem]');
    expect(dialog.className).toContain('sm:border-l');
  });

  it('offers a close button inside the panel', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(true);
      return <ExplainPanel explanation={full} open={open} onClose={() => setOpen(false)} />;
    }
    render(<Harness />);

    // The header icon and the footer action share the label "Đóng".
    await user.click(screen.getAllByRole('button', { name: 'Đóng' })[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AskAIAction', () => {
  it('dispatches the contextual prompt and assistant type without sending a message', async () => {
    const received: AiChatOpenDetail[] = [];
    const listener = (event: Event) =>
      received.push((event as CustomEvent<AiChatOpenDetail>).detail);
    window.addEventListener(AI_CHAT_OPEN_EVENT, listener);
    try {
      const user = userEvent.setup();
      render(<ExplainPanel explanation={full} open onClose={() => undefined} />);

      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /Hỏi AI về nội dung này/ }));

      expect(received).toEqual([{ prompt: full.aiPrompt, assistantType: 'SAVINGS' }]);
    } finally {
      window.removeEventListener(AI_CHAT_OPEN_EVENT, listener);
    }
  });

  it('can be used on its own with an analytics context', async () => {
    const received: AiChatOpenDetail[] = [];
    const listener = (event: Event) =>
      received.push((event as CustomEvent<AiChatOpenDetail>).detail);
    window.addEventListener(AI_CHAT_OPEN_EVENT, listener);
    try {
      const user = userEvent.setup();
      render(<AskAIAction prompt="Giải thích dự báo của tôi." assistantType="ANALYTICS" />);

      await user.click(screen.getByRole('button', { name: /Hỏi AI về nội dung này/ }));
      expect(received[0]).toEqual({
        prompt: 'Giải thích dự báo của tôi.',
        assistantType: 'ANALYTICS',
      });
    } finally {
      window.removeEventListener(AI_CHAT_OPEN_EVENT, listener);
    }
  });
});
