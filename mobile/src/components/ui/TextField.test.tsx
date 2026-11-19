import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Keyboard } from 'react-native';

import '@/i18n';

import { needsDoneBar, TextField } from './TextField';

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

  it('gives a number field a "Done" bar on iOS that closes the keyboard (the number pad has no Return key)', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    await render(<TextField testID="height" label="Height" value="" keyboardType="number-pad" />);
    const input = screen.getByTestId('height');
    expect(input.props.inputAccessoryViewID).toMatch(/^keyboard-done-/);
    await fireEvent.press(screen.getByTestId('keyboard.done'));
    expect(dismiss).toHaveBeenCalled();
    dismiss.mockRestore();
  });

  it('adds no bar to text fields or on Android', async () => {
    await render(<TextField testID="name" label="Name" value="" />);
    expect(screen.queryByTestId('keyboard.done')).toBeNull();
    expect(needsDoneBar('decimal-pad', 'ios')).toBe(true);
    expect(needsDoneBar('number-pad', 'android')).toBe(false);
    expect(needsDoneBar('email-address', 'ios')).toBe(false);
  });
});
