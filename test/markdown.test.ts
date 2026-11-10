import assert from "node:assert/strict";
import { test } from "node:test";
import { answerText, markdown } from "../src/markdown.ts";

const sources = [{ url: "https://example.com/source", title: "来源", siteName: "Example" }];

test("Markdown renders headings, emphasis, lists, quotes, tables, and unfinished code fences", () => {
  const html = markdown("## 标题\n\n**重点**、`代码`\n\n- 第一项\n- 第二项\n\n> 引用\n\n| 列 | 值 |\n| --- | --- |\n| a | b |\n\n```ts\nconst a = '<安全>';\n");
  for (const tag of ["h2", "strong", "code", "ul", "blockquote", "table", "pre"]) assert.ok(html.includes(`<${tag}`), tag);
  assert.match(html, /复制代码/);
  assert.match(html, /&lt;安全&gt;/);
});

test("model HTML, unsafe links, image alt text, and code cannot become executable markup", () => {
  const html = markdown('<script>alert(1)</script>\n\n<img src="https://example.com/x" onerror="alert(1)">\n\n[x](javascript:alert%281%29) [file](file:///etc/hosts) [encoded](jav&#x61;script:alert%281%29)\n\n![<img onerror=x>](https://example.com/image)\n\n```html\n<button onclick="bad()">x</button>\n```');
  assert.doesNotMatch(html, /<(?:script|img|iframe|style)\b|href="(?:javascript|file|data):|<button onclick/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/example.com\/image"/);
});

test("only redundant source lists backed by tool metadata are removed", () => {
  const answer = "回答见[原文](https://example.com/source)。\n\n";
  for (const footer of ["来源：<https://example.com/source>\n", "来源：[原文](https://example.com/source)\n", "## 参考资料\n\n- [原文](https://example.com/source)\n"]) {
    const result = answerText(answer + footer, sources);
    assert.equal(result.trim(), answer.trim());
  }
  for (const text of ["来源：这是正文里的解释。", "来源：<https://other.example.com/page>", "```\n来源：<https://example.com/source>\n```", "- 来源：<https://example.com/source>"]) {
    assert.equal(answerText(text, sources), text);
  }
  assert.equal(answerText(answer + "来源：<https://example.com/source>"), answer + "来源：<https://example.com/source>");
});
