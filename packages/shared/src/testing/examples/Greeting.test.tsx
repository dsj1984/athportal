import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Greeting } from './Greeting';

afterEach(() => {
  cleanup();
});

describe('<Greeting>', () => {
  it('renders the greeting with the provided name', () => {
    render(<Greeting name="Ada Lovelace" />);
    expect(screen.getByTestId('greeting').textContent).toBe('Hello, Ada Lovelace!');
  });

  it('updates when the name prop changes', () => {
    const { rerender } = render(<Greeting name="Ada" />);
    expect(screen.getByTestId('greeting').textContent).toBe('Hello, Ada!');

    rerender(<Greeting name="Grace" />);
    expect(screen.getByTestId('greeting').textContent).toBe('Hello, Grace!');
  });
});
