/// <reference types="node" />

import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';

/**
 * Lint configuration for the risk pipeline.
 *
 * Stricter than the sibling packages on purpose: this package's engineering
 * standard (plan §10) makes three things hard errors rather than warnings —
 * `any`, missing return types, and missing documentation on the public surface.
 * A standard that is only advisory drifts; one enforced by the lint gate does not.
 */
export default defineConfig(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/', 'node_modules/', 'scraper/', 'logs/'],
  },
  {
    files: ['**/*.ts'],
    plugins: { jsdoc },
    settings: {
      // `typescript` mode teaches the plugin the TS-specific tags this codebase
      // uses, notably `@inheritDoc` when an implementation restates an
      // interface contract.
      jsdoc: { mode: 'typescript' },
    },
    rules: {
      // §10.2 — zero `any`. Sibling packages run this as `warn`; here it is an error.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  {
    /**
     * Documentation is enforced on the **library surface** (`src/`), which is
     * what a consumer reads and what §10.4 requires.
     *
     * Deliberately not enforced in `test/` or `scripts/`: those are not consumed
     * as an API, and requiring JSDoc on every fixture shape and inline object
     * method there would produce padding rather than clarity. The library is
     * where an undocumented export is a real defect.
     */
    files: ['src/**/*.ts'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            // Interfaces, type aliases and object-literal members are documented
            // with leading doc comments by convention (see every schema in
            // `types.ts`), not detected by this rule. Enabling them here makes the
            // plugin flag zod schema *fields* — `name: z.string().min(1)` reads as
            // a function expression — which produces noise rather than coverage.
            MethodDefinition: false,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
        },
      ],
      // Destructured object parameters are documented as a whole, and their
      // properties are documented once on the named interface they come from.
      // Enumerating each property in `@param` would restate the type signature in
      // prose and drift from it, so per-property checking is off while the object
      // parameter itself is still required and its name still validated.
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      'jsdoc/require-returns': 'error',
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'jsdoc/check-tag-names': 'error',
      'jsdoc/no-blank-block-descriptions': 'error',
    },
  },
);
