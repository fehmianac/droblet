import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import '@/i18n';

import { TextField } from './TextField';

function Form({ password }: { password: boolean }) {
  const [value, setValue] = useState('');
  return <TextField testID="field" label="Password" password={password} value={value} onChangeText={setValue} />;
}

describe('TextField', () => {
  it('never writes the text of a password field back from JS (iOS secure fields then keep only the last key)', async () => {
    await render(<Form password />);
    const input = screen.getByTestId('field');
    await fireEvent.changeText(input, 'Sm0keTest2026');
    // The parent state changed, but the native field stays uncontrolled: no `value`, only the starting text.
    expect(screen.getByTestId('field').props.value).toBeUndefined();
    expect(screen.getByTestId('field').props.defaultValue).toBe('');
    expect(screen.getByTestId('field').props.secureTextEntry).toBe(true);
  });

  it('shows and hides the password with the toggle next to it', async () => {
    await render(<Form password />);
    await fireEvent.press(screen.getByTestId('field.toggle'));
    expect(screen.getByTestId('field').props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText('Hide password')).toBeTruthy();
  });

  it('keeps ordinary fields controlled', async () => {
    await render(<Form password={false} />);
    await fireEvent.changeText(screen.getByTestId('field'), 'Damla');
    expect(screen.getByTestId('field').props.value).toBe('Damla');
  });
});
