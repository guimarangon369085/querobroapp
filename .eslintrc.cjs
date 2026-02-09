module.exports = {
  root: true,
  ignorePatterns: ["node_modules", "dist", "build", ".next"],
  env: { es2022: true, node: true },
  extends: ["eslint:recommended"],
  parserOptions: { ecmaVersion: "latest", sourceType: "module" }
};
