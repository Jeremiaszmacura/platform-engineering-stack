import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { SymbolSearch } from './SymbolSearch';

const INSTRUMENTS = [
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NMS' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NMS' },
];

const renderSearch = () => {
  const onSelect = vi.fn();
  render(<SymbolSearch instruments={INSTRUMENTS} onSelect={onSelect} />);
  return { onSelect, user: userEvent.setup(), input: screen.getByRole('combobox') };
};

it('finds a held instrument by company name and reports its ticker', async () => {
  const { onSelect, user, input } = renderSearch();

  await user.type(input, 'apple');
  await user.click(screen.getByRole('option', { name: /Apple Inc\./ }));

  expect(onSelect).toHaveBeenCalledWith('AAPL');
});

it('offers a ticker nobody has loaded yet, upper-cased', async () => {
  const { onSelect, user, input } = renderSearch();

  await user.type(input, 'tsla');
  expect(screen.getByRole('option', { name: /Fetch from the provider/ })).toBeInTheDocument();
  await user.keyboard('{Enter}');

  expect(onSelect).toHaveBeenCalledWith('TSLA');
});

it('does not offer text that could not be a ticker', async () => {
  const { user, input } = renderSearch();

  await user.type(input, 'apple computer!');

  expect(screen.queryByRole('option')).not.toBeInTheDocument();
  expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
});

it('moves through the suggestions with the arrow keys', async () => {
  const { onSelect, user, input } = renderSearch();

  await user.click(input);
  await user.keyboard('{ArrowDown}{Enter}');

  expect(onSelect).toHaveBeenCalledWith('MSFT');
});

it('empties the box once a company is chosen', async () => {
  const { user, input } = renderSearch();

  await user.type(input, 'msft');
  await user.keyboard('{Enter}');

  expect(input).toHaveValue('');
});
