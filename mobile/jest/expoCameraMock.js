/* global jest */
/**
 * Manual mock of `expo-camera` (12 Parça ekle): there is no camera in Jest.
 *
 * Default: the permission is never resolved (`null`), so a screen with a viewfinder draws its placeholder
 * and its shutter falls back to the system picker — existing screen tests need nothing.
 * A test that wants the live camera, or a denied permission, changes `__camera`:
 *
 *   const { __camera } = jest.requireMock('expo-camera');
 *   __camera.permission = { granted: true, canAskAgain: true };   // live viewfinder
 *   __camera.take.mockResolvedValueOnce({ uri, width, height });   // what the shutter returns
 */
const React = require('react');
const { View } = require('react-native');

const __camera = {
  /** `null` = not read yet · `{ granted, canAskAgain }`. */
  permission: null,
  request: jest.fn(async () => __camera.permission ?? { granted: false, canAskAgain: true }),
  take: jest.fn(async () => ({ uri: 'file:///camera.jpg', width: 1200, height: 1600 })),
};

class CameraView extends React.Component {
  takePictureAsync(options) {
    return __camera.take(options);
  }

  render() {
    return <View testID={this.props.testID} />;
  }
}

module.exports = {
  CameraView,
  useCameraPermissions: () => [__camera.permission, __camera.request, __camera.request],
  __camera,
};
