/**
 * Minimal Markdown -> HTML for the morning brief.
 *
 * The brief is written by Claude in a known, narrow subset: headings, tables,
 * bold, lists, blockquotes, paragraphs. A full Markdown library would be a large
 * dependency for that, so this covers the subset and escapes everything else.
 */

// Quotes too: the output lands in attributes (link hrefs), not just text, and the
// brief is model-written from inputs that include free text.
function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A link only if the target is a well-formed https URL; otherwise just the text. */
function link(text: string, escapedUrl: string) {
  const raw = escapedUrl.replace(/&amp;/g, "&");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return text;
  }
  if (url.protocol !== "https:") return text;
  return `<a href="${esc(url.href)}" rel="noopener noreferrer" target="_blank">${text}</a>`;
}

function inline(s: string) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+?)\*/g, "$1<em>$2</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((https:\/\/[^)\s]+)\)/g, (_, text, url) => link(text, url));
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // table: a header row followed by a |---| separator
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushPara();
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        body.push(cells(lines[i]));
        i++;
      }
      out.push(
        `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead>` +
          `<tbody>${body
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara();
      const level = Math.min(heading[1].length + 1, 4); // h1 in the brief becomes h2 on the page
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<div class="card warn">${inline(quote.join(" "))}</div>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        let text = lines[i].replace(/^\s*[-*]\s+/, "");
        i++;
        // A wrapped bullet: the lines that follow, up to a blank line or the next
        // block, belong to this item - not to a new paragraph under the list.
        while (i < lines.length && lines[i].trim() && !/^\s*([-*]\s+|#|>|\|)/.test(lines[i])) {
          text += " " + lines[i].trim();
          i++;
        }
        items.push(`<li>${inline(text)}</li>`);
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return out.join("\n");
}

/**
 * The brief's prose for the Coaching tab: every section, including how injuries
 * shaped the day, minus the H1 title (the page already shows the date).
 */
export function briefBody(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !/^#\s/.test(l))
    .join("\n")
    .trim();
}
