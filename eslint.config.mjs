import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Dev-only design-exploration galleries (rendered under /dev, which returns
    // notFound() in production). Throwaway prototypes, not shipped surfaces, so
    // they must not gate the production build's lint step.
    ignores: [
      "src/app/dev/**",
      "src/components/dashboard/chrome/**",
      "src/components/dashboard/sidebars/**",
    ],
  },
];

export default eslintConfig;
