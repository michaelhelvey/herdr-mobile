// Configuration guide: https://rstack.rs/config
// Rstack is used for linting, formatting, and git hooks only. Bun runs the dev server, bundles
// the app, and runs the tests.
import stylistic from "@stylistic/eslint-plugin";
import { define } from "rstack";

const MULTILINE_DECLARATIONS = [
  "multiline-const",
  "multiline-let",
  "multiline-var",
  "multiline-using",
];

const TOP_LEVEL_STATEMENT = { selector: "Program > :not(ImportDeclaration)" };

// From the `require-readable-spacing` rule of anti-slop:
// https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/require-readable-spacing.ts
// The fix adds only blank lines. Short local bindings, imports, and overload signatures stay in
// groups.
const READABLE_SPACING = [
  { blankLine: "always", prev: "import", next: "*" },
  { blankLine: "always", prev: "*", next: TOP_LEVEL_STATEMENT },
  { blankLine: "always", prev: TOP_LEVEL_STATEMENT, next: "*" },
  { blankLine: "always", prev: "*", next: ["function", "class", "interface", "type"] },
  { blankLine: "always", prev: ["function", "class", "interface", "type"], next: "*" },
  { blankLine: "always", prev: "*", next: MULTILINE_DECLARATIONS },
  { blankLine: "always", prev: MULTILINE_DECLARATIONS, next: "*" },
  { blankLine: "always", prev: "*", next: ["return", "if", "switch", "try", "for", "while", "do"] },
  { blankLine: "always", prev: "block-like", next: "*" },
  { blankLine: "any", prev: "import", next: "import" },
  {
    blankLine: "any",
    prev: {
      selector:
        ':matches(TSDeclareFunction, ExportNamedDeclaration[declaration.type="TSDeclareFunction"])',
    },
    next: {
      selector:
        ':matches(TSDeclareFunction, FunctionDeclaration, ExportNamedDeclaration[declaration.type="TSDeclareFunction"], ExportNamedDeclaration[declaration.type="FunctionDeclaration"])',
    },
  },
];

define.lint(({ js, ts, reactPlugin, reactHooksPlugin, jsxA11yPlugin }) => [
  // Tools write these folders. They are not source code.
  { ignores: [".verify/**", "dist/**"] },
  js.configs.recommended,
  ts.configs.recommendedTypeChecked,
  reactPlugin.configs.recommended,
  reactHooksPlugin.configs.recommended,
  jsxA11yPlugin.configs.recommended,
  {
    // Preact uses the automatic JSX runtime, TypeScript checks the props, and Preact accepts DOM
    // attribute names such as `class`. These React rules do not apply.
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      "react/prop-types": "off",
      "react/no-unknown-property": "off",
      "react/no-deprecated": "off",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  { rules: { "func-style": ["error", "declaration"] } },
  {
    plugins: { "@stylistic": stylistic },
    rules: { "@stylistic/padding-line-between-statements": ["error", ...READABLE_SPACING] },
  },
  {
    languageOptions: {
      parserOptions: { project: ["./tsconfig.json"] },
    },
  },
]);

define.fmt({
  singleQuote: false,
  proseWrap: "always",
  printWidth: 100,
  ignorePatterns: [".verify/**", "dist/**"],
});

define.staged({
  "*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}": ["rs lint --fix", "rs fmt"],
  "*.{json,jsonc,md,mdx,css,html,yml,yaml}": "rs fmt",
});
