import { Marked, Renderer, type Token, type Tokens } from "marked";
import type { WebSource } from "./types.ts";

const escape = (text: string) => text.replace(/[&<>"']/g, (value) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);
function webLink(href: string, label: string) {
  try {
    const url = new URL(href);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password)
      return `<a href="${escape(url.href)}">${label}</a>`;
  } catch { /* Relative and local paths have no browser navigation target. */ }
  return label;
}

function detachTrailingListParagraph(token: Token): Tokens.Paragraph | undefined {
  if (token.type !== "list" || !token.ordered) return;
  const last: Tokens.ListItem | undefined = token.items.at(-1);
  // A hard break to a single unindented line at the end of a numbered list starts prose in chat.
  if (last?.tokens.length !== 1 || !/^[^\n]+\n\S[^\n]*\n*$/.test(last.raw)) return;
  const [block] = last.tokens;
  if (block.type !== "text" && block.type !== "paragraph") return;
  const inline: Token[] | undefined = block.tokens;
  if (!inline) return;
  const hardBreak = inline.findIndex((token) => token.type === "br");
  if (hardBreak < 1 || hardBreak === inline.length - 1) return;

  const tail = inline.splice(hardBreak).slice(1);
  const text = tail.map((token) => token.raw).join("");
  return { type: "paragraph", raw: text, text, tokens: tail };
}

const parser = new Marked({
  gfm: true,
  hooks: {
    processAllTokens(tokens) {
      for (let index = 0; index < tokens.length; index++) {
        const paragraph = detachTrailingListParagraph(tokens[index]);
        if (paragraph) tokens.splice(index + 1, 0, paragraph);
      }
      return tokens;
    },
  },
  renderer: {
    // Model and web content may contain HTML; it never becomes active DOM.
    html: ({ text }) => escape(text),
    link({ href, tokens }) {
      return webLink(href, this.parser.parseInline(tokens));
    },
    image({ text, href }) {
      // Opening a model-supplied image is explicit, with no background requests.
      return webLink(href, escape(`图片：${text || "查看图片"}`));
    },
    code({ text, lang }) {
      return `<div class="code-block"><div class="code-heading"><span>${escape(lang?.split(/\s/)[0] || "代码")}</span><button type="button" class="copy-code" aria-label="复制代码" title="复制代码">复制</button></div><pre><code>${escape(text)}</code></pre></div>`;
    },
    table(token) { return `<div class="markdown-table">${Renderer.prototype.table.call(this, token)}</div>`; },
  },
});

/** Only redundant source lists backed by actual tool results are omitted. */
export function answerText(text: string, sources: WebSource[] = []): string {
  if (!sources.length || !/(?:^|\n)(?:#{1,6} )?(?:\*\*)?(?:来源|信息来源|参考来源|参考资料|Sources|References)/i.test(text)) return text;
  const known = new Set(sources.map((source) => source.url));
  const label = /^(?:\*\*)?(?:来源|信息来源|参考来源|参考资料|Sources|References)(?:\*\*)?\s*[：:]?\s*/i;
  const linksOnly = (value: string) => {
    let found = false, unknown = false;
    const rest = value.replace(/\[[^\]\n]*\]\((https?:\/\/[^\s)]+)\)|<?(https?:\/\/[^\s<>]+)>?/g, (_match, link, bare) => {
      const url = String(link ?? bare).replace(/[、,，。;；]+$/, "");
      found = true;
      try { if (!known.has(new URL(url).href)) unknown = true; } catch { unknown = true; }
      return "";
    });
    return found && !unknown && !rest.replace(/[\s\d.*_\-+()\[\]<>:：、,，。;；]/g, "");
  };
  const tokens = parser.lexer(text);
  return tokens.filter((token, index) => {
    if (token.type === "paragraph" && label.test(token.text) && linksOnly(token.text.replace(label, ""))) return false;
    if (token.type === "heading" && label.test(token.text) && !token.text.replace(label, "")) {
      let next = index + 1;
      while (tokens[next]?.type === "space") next++;
      if (tokens[next] && linksOnly(tokens[next].raw)) {
        tokens[next].raw = "";
        return false;
      }
    }
    return true;
  }).map((token) => token.raw).join("");
}

export function markdown(text: string): string {
  try { return parser.parse(text, { async: false }); }
  catch { return `<div class="markdown-fallback">${escape(text)}</div>`; }
}
