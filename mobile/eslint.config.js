// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/** Project rules from TEAM_LEAD.md (mobile code style) and the "no CSS uppercase" rule. */
const projectRestrictions = [
  {
    selector: "Property[key.name='textTransform'][value.value='uppercase']",
    message:
      "Never transform text to upper case. Write it upper-case in the translation file, or use toDisplayUpper() for dynamic strings.",
  },
  {
    selector: "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)uppercase(\\s|$)/]",
    message:
      "The `uppercase` class is forbidden. Write the text upper-case in the translation file, or use toDisplayUpper().",
  },
  {
    selector: "JSXAttribute[name.name='className'] TemplateElement[value.raw=/(^|\\s)uppercase(\\s|$)/]",
    message:
      "The `uppercase` class is forbidden. Write the text upper-case in the translation file, or use toDisplayUpper().",
  },
  {
    selector: 'Literal[value=/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
    message: 'No hex colours outside src/theme/tokens.ts — use a token.',
  },
  {
    selector: 'TSAnyKeyword',
    message: '`any` is not allowed (strict TypeScript).',
  },
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'ios/*', 'android/*', 'expo-env.d.ts'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...projectRestrictions],
      'react/jsx-no-literals': [
        'error',
        { noStrings: true, ignoreProps: true, allowedStrings: ['·', '×', '/', '•', '–', '%', '+', ' '] },
      ],
    },
  },
  {
    files: ['src/theme/**', 'src/**/*.test.{ts,tsx}', 'src/fixtures/**'],
    rules: {
      'no-restricted-syntax': ['error', ...projectRestrictions.filter((r) => !r.message.startsWith('No hex'))],
      'react/jsx-no-literals': 'off',
    },
  },
]);
