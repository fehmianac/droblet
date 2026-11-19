import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import { KeyboardAvoider } from './KeyboardAvoider';

// The real avoiding view keeps its props to itself; this stand-in puts them on a host view the test can read.
jest.mock('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View: HostView } = jest.requireActual<typeof import('react-native')>('react-native');
  const Stub = (props: object) => createElement(HostView, { ...props, testID: 'avoiding' });
  return { __esModule: true, default: Stub };
});

type Measurable = { measureInWindow: (cb: (x: number, y: number) => void) => void };

describe('KeyboardAvoider', () => {
  it('hands its real place in the window to the keyboard offset (a header above it, a page sheet)', async () => {
    // Where the wrapper sits in the window: under a 20 pt status bar and a 48 pt header.
    const spy = jest.spyOn(View.prototype as unknown as Measurable, 'measureInWindow').mockImplementation((cb) => cb(0, 68));
    await render(
      <KeyboardAvoider testID="avoider">
        <Text>Form</Text>
      </KeyboardAvoider>,
    );
    const avoiding = () => screen.getByTestId('avoiding');
    expect(avoiding().props.keyboardVerticalOffset).toBe(0);
    await act(async () => {
      fireEvent(screen.getByTestId('avoider.frame'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 599 } } });
    });
    expect(avoiding().props.keyboardVerticalOffset).toBe(68);
    expect(avoiding().props.behavior).toBe('padding');
    expect(screen.getByText('Form')).toBeTruthy();
    spy.mockRestore();
  });
});
