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

test("plain line breaks are visible in a chat reply", () => {
  const lines = ["是打算打算", "1.啊啊啊", "2.啊啊啊", "是多少打算"];
  const source = lines.join("\n");
  assert.equal(markdown(source), `<p>${lines.join("<br>")}</p>\n`);
  assert.equal(answerText(source), source);
});

test("unindented prose after the last numbered item renders as a separate paragraph", () => {
  const list = "啊啊啊啊啊啊\n1. 啊啊啊啊啊啊\n2. 啊啊啊啊啊";
  const tail = "啊啊啊啊啊啊";
  const expected = markdown(list + "\n\n" + tail);
  for (const lineBreak of ["\n", " \n", "  \n", "\\\n"]) {
    const source = list + lineBreak + tail;
    assert.equal(markdown(source), expected);
    assert.equal(answerText(source), source);
  }
});

test("indented continuation stays in the list before a multiline closing paragraph", () => {
  const list = "1. 第一项\n2. 第二项  \n   补充说明";
  const tail = "结尾第一行\n结尾第二行";
  assert.equal(markdown(list + "\n" + tail), markdown(list + "\n\n" + tail));
});

test("numbered list continuations and Markdown examples retain their formatting", () => {
  const list = "1. 第一项\n2. 第二项";
  assert.match(markdown(list + "  \n   补充说明"), /<li>第二项<br>补充说明<\/li>/);
  assert.match(markdown(list + "\n   补充说明"), /<li>第二项<br>补充说明<\/li>/);
  assert.match(markdown(list + " `行内代码  \n下一行`"), /<li>第二项 <code>行内代码\s+下一行<\/code><\/li>/);
  assert.match(markdown("```md\n" + list + "  \n示例\n```"), /<pre><code>1\. 第一项\n2\. 第二项  \n示例<\/code>/);
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
