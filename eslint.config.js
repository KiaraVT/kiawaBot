import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                console: "readonly",
                process: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                Buffer: "readonly",
                URL: "readonly",
                Map: "readonly",
                Set: "readonly",
                Promise: "readonly",
                Math: "readonly",
                JSON: "readonly",
                Number: "readonly",
                String: "readonly",
                Boolean: "readonly",
                Array: "readonly",
                Object: "readonly",
                Reflect: "readonly",
                Error: "readonly",
                TypeError: "readonly",
                fetch: "readonly",
                WebSocket: "readonly"
            }
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "warn",
            "no-empty": "warn",
            "no-prototype-builtins": "warn",
            "no-redeclare": "warn",
            "no-useless-escape": "warn"
        }
    },
    {
        ignores: ["node_modules/", "data/", "dist/", "scratch/"]
    }
];
