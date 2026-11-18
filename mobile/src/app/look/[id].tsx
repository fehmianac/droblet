import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * A saved look opens in the builder's edit mode (15). A dedicated look detail is not part of this
 * slice; deep links to `/look/{id}` keep working through this redirect.
 */
export default function LookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/look/new', params: { id } }} />;
}
