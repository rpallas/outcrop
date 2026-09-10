// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/cdk.out/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.d.ts",
      "**/templates/**",
      "**/layer/**",
      ".changeset/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: "commonjs",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { sourceType: "module" },
  },
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/test/**/*.ts", "**/tests/**/*.ts", "**/*.test.ts", "tools/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "no-console": "off",
    },
  },
  {
    files: ["packages/platform-cdk-cli/src/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
);
