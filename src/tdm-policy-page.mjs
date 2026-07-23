import { LICENSE_URL, TDM_META_TAGS, TDM_POLICY_URL } from "./constants.mjs";

// Scaffold only — do not add legal terms here. The body below is a clearly
// marked placeholder pending counsel's draft; this file's job is the route,
// the links, and the machine-readable surface, not the policy language.
export function tdmPolicyHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Text and Data Mining Policy — juanlentino.com</title>
<meta name="description" content="How juanlentino.com licenses text and data mining, AI training, and retrieval access to its content.">
<link rel="canonical" href="${TDM_POLICY_URL}">
${TDM_META_TAGS}
</head>
<body>
<main>
<h1>Text and Data Mining Policy</h1>
<p><strong>Placeholder.</strong> This policy is being drafted with IP counsel and will replace this text when finalized.</p>
<p>Until then, the operative terms are the machine-readable signals this site already publishes: search indexing and AI-assisted retrieval/citation are permitted; AI training is reserved under Article 4 of EU Directive 2019/790, with a conditional attribution licence offered on top of that reservation via the <a href="${LICENSE_URL}">RSL licence file</a>.</p>
</main>
</body>
</html>
`;
}
