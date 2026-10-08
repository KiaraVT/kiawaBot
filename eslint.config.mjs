export default [
    {
        languageOptions: {
            ecmaVersion: 2024,
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
