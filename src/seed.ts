export const SEED_ROOT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Canvas</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/paper.min.css">
</head>
<body>
<main>
  <h1>Canvas</h1>
  <p>Suggest a change in the chat.</p>
</main>
</body>
</html>`;

export const NEW_PAGE_SEED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>New page</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/paper.min.css">
</head>
<body>
<main>
  <h1>New page</h1>
  <p>This page is empty. Suggest content in the chat.</p>
</main>
</body>
</html>`;

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' wss: ws: https://fonts.googleapis.com; frame-ancestors 'none'; base-uri 'self'; form-action 'none'";

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export const WIDGET_SCRIPT_TAG = '<script src="/widget.js" defer></script>';

export function injectWidgetScript(html: string): string {
  if (html.includes("</head>")) {
    return html.replace("</head>", `${WIDGET_SCRIPT_TAG}</head>`);
  }
  if (html.includes("<body>")) {
    return html.replace("<body>", `<body>${WIDGET_SCRIPT_TAG}`);
  }
  return `${WIDGET_SCRIPT_TAG}${html}`;
}
