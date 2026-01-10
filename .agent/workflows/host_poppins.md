---
description: How to host Poppins font locally
---

# Hosting Poppins Font Locally

To avoid Content Security Policy (CSP) violations and reliance on Google Servers, follow these steps to host the Poppins font locally.

## Prerequisite
Ensure you have the font files (`.woff2` or `.ttf`) for Poppins weights: 300, 400, 500, 600, 700.
You can download them from [Google Fonts Helper](https://gwfh.mranftl.com/fonts/poppins?subsets=latin).

## Steps

1.  **Create Directory**:
    Create a new directory for fonts in your public assets folder:
    `ui/v2.5/public/fonts/poppins`

2.  **Copy Files**:
    Place the downloaded `.woff2` files in that directory.
    Example names: `poppins-v20-latin-regular.woff2`, `poppins-v20-latin-600.woff2`, etc.

3.  **Define CSS**:
    Create a new SCSS file `ui/v2.5/src/styles/_fonts.scss` and define the `@font-face` rules.

    ```scss
    /* poppins-regular - latin */
    @font-face {
      font-display: swap;
      font-family: 'Poppins';
      font-style: normal;
      font-weight: 400;
      src: url('/fonts/poppins/poppins-v20-latin-regular.woff2') format('woff2');
    }

    /* poppins-600 - latin */
    @font-face {
      font-display: swap;
      font-family: 'Poppins';
      font-style: normal;
      font-weight: 600;
      src: url('/fonts/poppins/poppins-v20-latin-600.woff2') format('woff2');
    }
    // Repeat for other weights (300, 500, 700)
    ```

4.  **Import**:
    Import this file in your main theme file `ui/v2.5/src/styles/_theme.scss`:
    ```scss
    @import 'fonts';
    ```

5.  **Rebuild**:
    Run `make ui` to rebuild the frontend.
