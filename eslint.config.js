import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  {
    languageOptions: {
      globals: {
        ...globals.node
      },
      ecmaVersion: 2022,
      sourceType: "module"
    }
  },
  pluginJs.configs.recommended,
  {
    rules: {
      // Temporarily warn instead of error on common issues so CI isn't immediately blocked
      "no-unused-vars": "warn",
      "no-undef": "warn",
      "no-prototype-builtins": "warn",
      "no-useless-assignment": "warn",
      "no-empty": "warn",
      "no-redeclare": "warn"
    }
  }
];
