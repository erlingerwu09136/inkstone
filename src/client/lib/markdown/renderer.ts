/** Builds the sanitized Markdown rendering pipeline and its Inkstone-specific syntax extensions. */
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import anchor from 'markdown-it-anchor';
import mark from 'markdown-it-mark';
import DOMPurify from 'dompurify';
import { parseFrontMatter, slugifyHeading } from '@shared/markdown-utils';
import { getLocale, t } from '../i18n';
import { encodeDataValue } from './data-attr';
export interface Heading {
    level: number;
    text: string;
    slug: string;
    line: number;
}
export interface RenderResult {
    html: string;
    headings: Heading[];
    hasMath: boolean;
    hasMermaid: boolean;
    hasEmbeds: boolean;
    frontMatter: Record<string, unknown>;
    frontMatterErrors: string[];
}
interface RenderEnvironment {
    headings: Heading[];
    hasMath: boolean;
    hasMermaid: boolean;
    hasEmbeds: boolean;
    frontMatter: Record<string, unknown>;
    frontMatterErrors: string[];
    taskNonce: string;
    tabSequence: number;
    exampleSequence: number;
    docId: string;
}
export interface WikiTarget {
    raw: string;
    noteTitle: string;
    heading: string | null;
    blockId: string | null;
    alias: string | null;
}
export interface FenceInfo {
    language: string;
    title: string;
    lineNumbers: boolean;
    startLine: number;
    highlightedLines: number[];
}
const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: true,
    typographer: false,
    langPrefix: 'language-',
});
md.use(taskLists, { enabled: true, label: false })
    .use(footnote)
    .use(mark)
    .use(anchor, {
    slugify: slugifyHeading,

    permalink: anchor.permalink.linkInsideHeader({
        symbol: '',
        placement: 'before',
        class: 'heading-anchor',
        ariaHidden: true,
    }),
});

md.block.ruler.before('hr', 'front_matter', (state, startLine, _endLine, silent) => {
    if (startLine !== 0)
        return false;
    const parsed = parseFrontMatter(state.src);
    if (!parsed.lineOffset)
        return false;
    if (silent)
        return true;
    const token = state.push('front_matter', 'section', 0);
    token.block = true;
    token.map = [0, parsed.lineOffset];
    token.meta = { data: parsed.data, errors: parsed.errors };
    const env = renderEnv(state.env);
    env.frontMatter = parsed.data;
    env.frontMatterErrors = parsed.errors;
    state.line = parsed.lineOffset;
    return true;
});
md.renderer.rules.front_matter = (tokens, index) => {
    const meta = tokens[index]!.meta as {
        data: Record<string, unknown>;
        errors: string[];
    };
    if (meta.errors.length) {
        const details = meta.errors.map((error) => `<li>${escapeHtml(localizeFrontMatterError(error))}</li>`).join('');
        return `<aside class="frontmatter-error" data-line="0"><strong>${escapeHtml(t("markdown.invalid_front_matter"))}</strong><ul>${details}</ul></aside>`;
    }
    const entries = Object.entries(meta.data);
    if (!entries.length)
        return '';
    const rows = entries
        .map(([key, value]) => `<div class="frontmatter-row"><dt>${escapeHtml(key)}</dt><dd>${renderFrontMatterValue(value)}</dd></div>`)
        .join('');
    return `<details class="frontmatter-properties" data-line="0"><summary>${escapeHtml(t("markdown.properties"))}</summary><dl>${rows}</dl></details>`;
};
md.block.ruler.before('fence', 'modern_container', (state, startLine, endLine, silent) => {
    const source = blockLine(state, startLine);
    const legacyMatch = /^(:{3,})[ \t]+(details|tabs)\b(?:[ \t]+(.*))?$/.exec(source);
    const directiveMatch = /^(:{3,})\{(tab-set)\}[ \t]*(.*)$/.exec(source);
    if (!legacyMatch && !directiveMatch)
        return false;
    const markerLength = (legacyMatch?.[1] ?? directiveMatch![1]!).length;
    const end = findContainerEnd(state, startLine, endLine, markerLength);
    if (end < 0)
        return false;
    if (silent)
        return true;
    const kind = legacyMatch?.[2] ?? directiveMatch![2]!;
    if (kind === 'details') {
        const rawInfo = (legacyMatch?.[3] ?? '').trim();
        const open = /^(?:open|\+)\b/.test(rawInfo);
        const title = stripBracketTitle(rawInfo.replace(/^(?:open|\+)\b[ \t]*/, '')) || t("markdown.details");
        const openToken = state.push('details_open', 'details', 1);
        openToken.block = true;
        openToken.map = [startLine, end + 1];
        openToken.meta = { open };
        const summary = state.push('details_summary', 'summary', 0);
        summary.content = title;
        state.md.block.tokenize(state, startLine + 1, end);
        state.push('details_close', 'details', -1).block = true;
    }
    else {
        const tabs = findTabSegments(state, startLine + 1, end);
        if (!tabs.length) {
            state.line = end + 1;
            return true;
        }
        const env = renderEnv(state.env);
        const id = `${env.docId}-tabs-${++env.tabSequence}`;
        const selectedIndex = Math.max(0, tabs.findIndex((tab) => tab.selected));
        const openToken = state.push('tabs_open', 'div', 1);
        openToken.block = true;
        openToken.map = [startLine, end + 1];
        openToken.meta = { id, titles: tabs.map((tab) => tab.title), selectedIndex };
        tabs.forEach((tab, tabIndex) => {
            const panelOpen = state.push('tab_panel_open', 'section', 1);
            panelOpen.block = true;
            panelOpen.meta = { id, tabIndex, selected: tabIndex === selectedIndex };
            state.md.block.tokenize(state, tab.start, tab.end);
            const panelClose = state.push('tab_panel_close', 'section', -1);
            panelClose.block = true;
            panelClose.meta = { id, tabIndex };
        });
        state.push('tabs_close', 'div', -1).block = true;
    }
    state.line = end + 1;
    return true;
});
md.renderer.rules.details_open = (tokens, index) => {
    const sourceLine = tokens[index]!.map?.[0];
    const open = Boolean((tokens[index]!.meta as {
        open?: boolean;
    })?.open);
    return `<details class="markdown-details"${sourceLine === undefined ? '' : ` data-line="${sourceLine}"`}${open ? ' open' : ''}>`;
};
md.renderer.rules.details_summary = (tokens, index) => `<summary>${escapeHtml(tokens[index]!.content)}</summary>`;
md.renderer.rules.details_close = () => '</details>';
md.renderer.rules.tabs_open = (tokens, index) => {
    const sourceLine = tokens[index]!.map?.[0];
    const { id, titles, selectedIndex } = tokens[index]!.meta as {
        id: string;
        titles: string[];
        selectedIndex: number;
    };
    const buttons = titles
        .map((title, tabIndex) => `<button type="button" role="tab" id="${id}-tab-${tabIndex}" aria-controls="${id}-panel-${tabIndex}" aria-selected="${tabIndex === selectedIndex ? 'true' : 'false'}" tabindex="${tabIndex === selectedIndex ? '0' : '-1'}" data-tab-button="${tabIndex}">${escapeHtml(title)}</button>`)
        .join('');
    return `<div class="markdown-tabs" data-tabs${sourceLine === undefined ? '' : ` data-line="${sourceLine}"`}><div class="tab-list" role="tablist" aria-label="${escapeAttr(t("common.tabs"))}">${buttons}</div>`;
};
md.renderer.rules.tabs_close = () => '</div>';
md.renderer.rules.tab_panel_open = (tokens, index) => {
    const { id, tabIndex, selected } = tokens[index]!.meta as {
        id: string;
        tabIndex: number;
        selected: boolean;
    };
    return `<section class="tab-panel" role="tabpanel" id="${id}-panel-${tabIndex}" aria-labelledby="${id}-tab-${tabIndex}" data-tab-panel="${tabIndex}"${selected ? '' : ' hidden'}>`;
};
md.renderer.rules.tab_panel_close = () => '</section>';
const MATH_INLINE = /^\$(?!\s)((?:[^$\\]|\\.)+?)(?<!\s)\$/;
md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$')
        return false;
    const match = MATH_INLINE.exec(state.src.slice(state.pos));
    if (!match)
        return false;
    if (!silent) {
        const token = state.push('math_inline', 'span', 0);
        token.content = match[1]!;
        token.markup = '$';
        renderEnv(state.env).hasMath = true;
    }
    state.pos += match[0].length;
    return true;
});
md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const line = blockLine(state, startLine);
    if (!/^\$\$/.test(line))
        return false;
    const firstLine = line.slice(2);
    let content = '';
    let next = startLine;
    let found = false;
    if (firstLine.trim().endsWith('$$')) {
        content = firstLine.trim().slice(0, -2);
        found = true;
    }
    else {
        while (!found && ++next < endLine) {
            const text = blockLine(state, next);
            if (text.trim().endsWith('$$')) {
                content += text.slice(0, text.lastIndexOf('$$'));
                found = true;
            }
            else {
                content += `${text}\n`;
            }
        }
        if (firstLine.trim())
            content = `${firstLine}\n${content}`;
    }
    if (!found)
        return false;
    if (silent)
        return true;
    const token = state.push('math_block', 'div', 0);
    token.content = content.trim();
    token.map = [startLine, next + 1];
    token.markup = '$$';
    renderEnv(state.env).hasMath = true;
    state.line = next + 1;
    return true;
});
md.renderer.rules.math_inline = (tokens, index) => `<span class="math-inline" data-math="${escapeAttr(encodeDataValue(tokens[index]!.content))}"></span>`;
md.renderer.rules.math_block = (tokens, index) => {
    const token = tokens[index]!;
    const line = token.map ? ` data-line="${token.map[0]}"` : '';
    return `<div class="math-block"${line} data-math="${escapeAttr(encodeDataValue(token.content))}"></div>`;
};
const WIKI_RE = /^\[\[([^\[\]\n]{1,400})\]\]/;
const EMBED_RE = /^!\[\[([^\[\]\n]{1,400})\]\]/;
const BLOCK_REF_RE = /^\(\(([A-Za-z0-9][A-Za-z0-9_-]{0,63})\)\)/;
const TAG_RE = /^#([\p{L}\p{N}_\-/·]{1,60})(?![\p{L}\p{N}_\-/·])/u;
md.inline.ruler.before('image', 'note_embed', (state, silent) => {
    if (!state.src.startsWith('![[', state.pos))
        return false;
    const match = EMBED_RE.exec(state.src.slice(state.pos));
    if (!match)
        return false;
    if (!silent) {
        const token = state.push('note_embed', 'div', 0);
        token.content = match[1]!.trim();
        renderEnv(state.env).hasEmbeds = true;
    }
    state.pos += match[0].length;
    return true;
});
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    if (!state.src.startsWith('[[', state.pos))
        return false;
    const match = WIKI_RE.exec(state.src.slice(state.pos));
    if (!match)
        return false;
    if (!silent) {
        const token = state.push('wikilink', 'a', 0);
        token.content = match[1]!.trim();
    }
    state.pos += match[0].length;
    return true;
});
md.inline.ruler.before('text', 'block_reference', (state, silent) => {
    if (!state.src.startsWith('((', state.pos))
        return false;
    const match = BLOCK_REF_RE.exec(state.src.slice(state.pos));
    if (!match)
        return false;
    if (!silent) {
        const token = state.push('block_reference', 'a', 0);
        token.content = match[1]!;
    }
    state.pos += match[0].length;
    return true;
});
md.inline.ruler.before('text', 'inline_tag', (state, silent) => {
    if (state.src[state.pos] !== '#')
        return false;
    const previous = state.pos > 0 ? state.src[state.pos - 1]! : ' ';
    if (!/[\s(\uff08[\u3010>\u300c\u300e\uff0c,\u3001;\uff1b]/.test(previous) && state.pos !== 0)
        return false;
    const match = TAG_RE.exec(state.src.slice(state.pos));
    if (!match)
        return false;
    if (!silent) {
        const token = state.push('inline_tag', 'span', 0);
        token.content = match[1]!;
    }
    state.pos += match[0].length;
    return true;
});
md.renderer.rules.note_embed = (tokens, index) => {
    const parsed = parseWikiTarget(tokens[index]!.content);
    const label = parsed.alias || parsed.raw;
    return `<div class="note-embed loading" data-embed-target="${escapeAttr(encodeDataValue(parsed.raw))}"><span class="note-embed-head">${escapeHtml(label)}</span><div class="note-embed-body" aria-busy="true">${escapeHtml(t("common.loading"))}</div></div>`;
};
md.renderer.rules.wikilink = (tokens, index) => {
    const parsed = parseWikiTarget(tokens[index]!.content);
    const label = parsed.alias || parsed.raw;
    return `<a class="wikilink" data-wikilink="${escapeAttr(encodeDataValue(parsed.raw))}" href="#">${escapeHtml(label)}</a>`;
};
md.renderer.rules.block_reference = (tokens, index) => {
    const id = tokens[index]!.content;
    return `<a class="block-reference" data-block-ref="${escapeAttr(id)}" href="#%5E${escapeAttr(id)}">((${escapeHtml(id)}))</a>`;
};
md.renderer.rules.inline_tag = (tokens, index) => `<span class="inline-tag" data-tag="${escapeAttr(encodeDataValue(tokens[index]!.content))}" role="link" tabindex="0">#${escapeHtml(tokens[index]!.content)}</span>`;
md.core.ruler.before('github-task-lists', 'obsidian_blocks', (state) => {
    const seenBlockIds = new Set<string>();
    for (let index = 0; index < state.tokens.length; index++) {
        const inline = state.tokens[index]!;
        if (inline.type !== 'inline')
            continue;
        expandBlockReferences(inline, state.Token);
        const opening = findOpeningToken(state.tokens, index);
        if (!opening)
            continue;
        let content = inline.content;
        const block = /(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s*$/.exec(content);
        if (block) {
            let id = block[1]!;
            const original = id;
            let suffix = 2;
            while (seenBlockIds.has(id))
                id = `${original}-${suffix++}`;
            seenBlockIds.add(id);
            setTokenAttribute(opening, 'id', `^${id}`);
            setTokenAttribute(opening, 'data-block-id', id);
            content = content.slice(0, block.index).trimEnd();
        }
        if (content !== inline.content)
            reparseInline(inline, content, state.md, state.env);
    }
    return true;
});
md.core.ruler.after('github-task-lists', 'obsidian_callouts', (state) => {
    for (let index = 0; index < state.tokens.length; index++) {
        const open = state.tokens[index]!;
        if (open.type !== 'blockquote_open')
            continue;
        const paragraphOpen = state.tokens[index + 1];
        const inline = state.tokens[index + 2];
        if (paragraphOpen?.type !== 'paragraph_open' || inline?.type !== 'inline')
            continue;
        const firstBreak = inline.content.indexOf('\n');
        const firstLine = firstBreak >= 0 ? inline.content.slice(0, firstBreak) : inline.content;
        const marker = /^\[!([A-Za-z][A-Za-z0-9_-]{0,31})\]([+-])?(?:[ \t]+(.+?))?[ \t]*$/.exec(firstLine);
        if (!marker)
            continue;
        const closeIndex = matchingClose(state.tokens, index, 'blockquote_open', 'blockquote_close');
        if (closeIndex < 0)
            continue;
        const type = normalizeCalloutType(marker[1]!);
        const fold = marker[2] ?? '';
        const title = marker[3]?.trim() || calloutDefaultTitle(type);
        open.type = 'callout_open';
        open.tag = fold ? 'details' : 'aside';
        open.meta = { type, title, fold };
        const close = state.tokens[closeIndex]!;
        close.type = 'callout_close';
        close.tag = open.tag;
        close.meta = { fold };
        const remaining = firstBreak >= 0 ? inline.content.slice(firstBreak + 1) : '';
        if (remaining.trim()) {
            reparseInline(inline, remaining, state.md, state.env);
        }
        else {
            const paragraphClose = state.tokens[index + 3];
            if (paragraphClose?.type === 'paragraph_close')
                state.tokens.splice(index + 1, 3);
        }
    }
    return true;
});
md.renderer.rules.callout_open = (tokens, index) => {
    const sourceLine = tokens[index]!.map?.[0];
    const line = sourceLine === undefined ? '' : ` data-line="${sourceLine}"`;
    const { type, title, fold } = tokens[index]!.meta as {
        type: string;
        title: string;
        fold: string;
    };
    if (fold) {
        return `<details class="callout callout-${escapeAttr(type)}" data-callout="${escapeAttr(type)}"${line}${fold === '+' ? ' open' : ''}><summary class="callout-title">${escapeHtml(title)}</summary><div class="callout-content">`;
    }
    return `<aside class="callout callout-${escapeAttr(type)}" data-callout="${escapeAttr(type)}"${line}><div class="callout-title">${escapeHtml(title)}</div><div class="callout-content">`;
};
md.renderer.rules.callout_close = (tokens, index) => `</div>${(tokens[index]!.meta as {
    fold: string;
}).fold ? '</details>' : '</aside>'}`;
md.core.ruler.after('github-task-lists', 'trusted_task_placeholders', (state) => {
    const env = renderEnv(state.env);
    for (let index = 2; index < state.tokens.length; index++) {
        const inline = state.tokens[index]!;
        const paragraph = state.tokens[index - 1]!;
        const item = state.tokens[index - 2]!;
        if (inline.type !== 'inline' ||
            paragraph.type !== 'paragraph_open' ||
            item.type !== 'list_item_open' ||
            !inline.children?.length) {
            continue;
        }
        const checkboxIndex = inline.children.findIndex((child) => child.type === 'html_inline' && /task-list-item-checkbox/.test(child.content));
        if (checkboxIndex < 0)
            continue;
        const checkbox = inline.children[checkboxIndex]!;
        const checked = /\schecked(?:=|\s|>)/.test(checkbox.content);
        const sourceLine = item.map?.[0];
        if (sourceLine == null)
            continue;
        checkbox.content = `<span class="task-checkbox-placeholder" data-task-placeholder="${env.taskNonce}" data-task-line="${sourceLine}" data-task-checked="${checked ? '1' : '0'}"></span>`;
        const labelOpen = new state.Token('html_inline', '', 0);
        labelOpen.content = '<span class="task-label">';
        const labelClose = new state.Token('html_inline', '', 0);
        labelClose.content = '</span>';
        inline.children.splice(checkboxIndex + 1, 0, labelOpen);
        inline.children.push(labelClose);
        setTokenAttribute(item, 'data-task-line', String(sourceLine));
        if (checked)
            appendTokenClass(item, 'done');
    }
    return true;
});
md.core.ruler.after('trusted_task_placeholders', 'block_note_embeds', (state) => {
    for (let index = 1; index < state.tokens.length - 1; index++) {
        const inline = state.tokens[index]!;
        const open = state.tokens[index - 1]!;
        const close = state.tokens[index + 1]!;
        if (inline.type !== 'inline' || open.type !== 'paragraph_open' || close.type !== 'paragraph_close' ||
            !inline.children?.some((child) => child.type === 'note_embed')) {
            continue;
        }
        open.type = 'note_embed_paragraph_open';
        open.tag = 'div';
        open.attrJoin('class', 'note-embed-paragraph');
        close.type = 'note_embed_paragraph_close';
        close.tag = 'div';
    }
    return true;
});
md.renderer.rules.fence = (tokens, index, _options, rendererEnv) => {
    const token = tokens[index]!;
    const info = parseFenceInfo(token.info);
    const line = token.map ? ` data-line="${token.map[0]}"` : '';
    if (info.language === 'md-example' || info.language === 'markdown-example') {
        const parentEnv = renderEnv(rendererEnv);
        const exampleId = ++parentEnv.exampleSequence;
        const childEnv = emptyEnvironment();
        childEnv.taskNonce = parentEnv.taskNonce;
        childEnv.tabSequence = parentEnv.tabSequence;
        childEnv.exampleSequence = parentEnv.exampleSequence;
        childEnv.docId = `${parentEnv.docId}-example-${exampleId}`;
        const preview = md.render(stripObsidianComments(token.content), childEnv).replace(/ data-line="\d+"/g, '');
        parentEnv.hasMath ||= childEnv.hasMath;
        parentEnv.hasMermaid ||= childEnv.hasMermaid;
        parentEnv.hasEmbeds ||= childEnv.hasEmbeds;
        parentEnv.tabSequence = childEnv.tabSequence;
        parentEnv.exampleSequence = Math.max(parentEnv.exampleSequence, childEnv.exampleSequence);
        const title = info.title || t("markdown.markdown_example");
        const titleId = `${parentEnv.docId}-markdown-example-${exampleId}`;
        return [
            `<section class="markdown-example"${line} aria-labelledby="${titleId}">`,
            `<div class="markdown-example-head"><span class="markdown-example-title" id="${titleId}">${escapeHtml(title)}</span></div>`,
            `<div class="markdown-example-grid">`,
            `<section class="markdown-example-preview" aria-label="${escapeAttr(t("common.preview"))}" data-markdown-example-id="${exampleId}" data-markdown-example="${escapeAttr(encodeDataValue(token.content))}">`,
            `<div class="markdown-example-preview-body">${preview}</div>`,
            `</section>`,
            `<section class="markdown-example-source" aria-label="Markdown">`,
            `<div class="code-block markdown-example-code" data-lang="markdown" data-code-start="1">`,
            `<button class="code-copy markdown-example-copy" data-copy type="button" aria-label="${escapeAttr(t("markdown.copy_code"))}">${escapeHtml(t("common.copy"))}</button>`,
            `<pre><code>${escapeHtml(token.content)}</code></pre>`,
            `</div>`,
            `</section>`,
            `</div>`,
            `</section>`,
        ].join('');
    }
    if (info.language === 'mermaid') {
        renderEnv(rendererEnv).hasMermaid = true;
        return `<div class="mermaid-block loading"${line} data-mermaid="${escapeAttr(encodeDataValue(token.content))}" aria-busy="true">${escapeHtml(t("markdown.rendering_diagram"))}</div>`;
    }
    const title = info.title || info.language || t("markdown.code");
    return [
        `<div class="code-block"${line} data-lang="${escapeAttr(info.language)}" data-code-start="${info.startLine}"${info.lineNumbers ? ' data-line-numbers="true"' : ''}${info.highlightedLines.length ? ` data-highlight-lines="${info.highlightedLines.join(',')}"` : ''}>`,
        `<div class="code-block-head">`,
        `<span class="code-title">${escapeHtml(title)}</span>`,
        info.title && info.language ? `<span class="code-lang">${escapeHtml(info.language)}</span>` : '',
        `<button class="code-copy" data-copy type="button" aria-label="${escapeAttr(t("markdown.copy_code"))}">${escapeHtml(t("common.copy"))}</button>`,
        `</div>`,
        `<pre><code>${escapeHtml(token.content)}</code></pre>`,
        `</div>`,
    ].join('');
};
md.renderer.rules.table_open = (tokens, index) => {
    const line = tokens[index]!.map ? ` data-line="${tokens[index]!.map![0]}"` : '';
    return `<div class="table-wrap"${line}><table>`;
};
md.renderer.rules.table_close = () => '</table></div>';
const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index]!;
    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    token.attrSet('referrerpolicy', 'no-referrer');
    const title = token.attrGet('title');
    const rendered = defaultImage
        ? defaultImage(tokens, index, options, env, self)
        : self.renderToken(tokens, index, options);
    return title ? `<figure>${rendered}<figcaption>${escapeHtml(title)}</figcaption></figure>` : rendered;
};
const defaultLink = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = tokens[index]!.attrGet('href') ?? '';
    if (/^https?:/i.test(href)) {
        tokens[index]!.attrSet('target', '_blank');
        tokens[index]!.attrSet('rel', 'noopener noreferrer');
    }
    return defaultLink
        ? defaultLink(tokens, index, options, env, self)
        : self.renderToken(tokens, index, options);
};
md.core.ruler.push('source_lines', (state) => {
    for (const token of state.tokens) {
        if (token.map && token.type.endsWith('_open') && token.level === 0) {
            token.attrSet('data-line', String(token.map[0]));
        }
    }
    return true;
});
md.core.ruler.push('collect_headings', (state) => {
    const env = renderEnv(state.env);
    env.headings = [];
    for (let index = 0; index < state.tokens.length; index++) {
        const token = state.tokens[index]!;
        if (token.type !== 'heading_open')
            continue;
        const inline = state.tokens[index + 1];
        const text = inline ? plainInline(inline) : '';
        env.headings.push({
            level: Number(token.tag.slice(1)),
            text,
            slug: token.attrGet('id') ?? slugifyHeading(text),
            line: token.map?.[0] ?? 0,
        });
    }
    return true;
});
const PURIFY_CONFIG = {
    ADD_ATTR: [
        'data-line',
        'data-math',
        'data-mermaid',
        'data-wikilink',
        'data-embed-target',
        'data-block-ref',
        'data-block-id',
        'data-tag',
        'data-lang',
        'data-copy',
        'data-task-placeholder',
        'data-task-line',
        'data-task-checked',
        'data-tabs',
        'data-tab-button',
        'data-tab-panel',
        'data-callout',
        'data-code-start',
        'data-line-numbers',
        'data-highlight-lines',
        'data-markdown-example',
        'data-markdown-example-id',
        'target',
        'loading',
        'decoding',
        'referrerpolicy',
        'align',
        'colspan',
        'open',
        'hidden',
        'role',
        'aria-busy',
        'aria-label',
        'aria-selected',
        'aria-controls',
        'aria-labelledby',
        'tabindex',
        'width',
        'height',
        'lang',
        'dir',
    ],
    ADD_TAGS: ['figure', 'figcaption', 'details', 'summary'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'base'],
    FORBID_ATTR: [
        'style',
        'onerror',
        'onload',
        'onclick',
        'onchange',
        'oninput',
        'onfocus',
        'srcdoc',
        'formaction',
        'action',
    ],
    ALLOW_DATA_ATTR: true,
};
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'A' && node.getAttribute('target')?.toLowerCase() === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
    }
});
export interface MarkdownBlock {
    startLine: number;
    endLine: number;
    html: string;
}

/** Parse once with the full document environment so reference links retain their targets. */
export function renderMarkdownBlocks(source: string): { blocks: MarkdownBlock[]; headings: Heading[] } {
    const env = emptyEnvironment();
    const tokens = md.parse(stripObsidianComments(source), env);
    const blocks: MarkdownBlock[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (!token.map || token.level !== 0 || token.nesting === -1) continue;
        let end = i + 1;
        if (token.nesting === 1) {
            let depth = 1;
            while (end < tokens.length && depth > 0) depth += tokens[end++]!.nesting;
        }
        const raw = md.renderer.render(tokens.slice(i, end), md.options, env);
        const html = materializeTrustedTasks(DOMPurify.sanitize(raw, PURIFY_CONFIG), env.taskNonce);
        if (html.trim()) blocks.push({ startLine: token.map[0], endLine: token.map[1], html });
        i = end - 1;
    }
    return { blocks, headings: env.headings };
}

export function renderMarkdown(source: string): RenderResult {
    const env = emptyEnvironment();
    const raw = md.render(stripObsidianComments(source), env);
    const sanitized = DOMPurify.sanitize(raw, PURIFY_CONFIG);
    const html = materializeTrustedTasks(sanitized, env.taskNonce);
    return {
        html,
        headings: env.headings,
        hasMath: env.hasMath,
        hasMermaid: env.hasMermaid,
        hasEmbeds: env.hasEmbeds,
        frontMatter: env.frontMatter,
        frontMatterErrors: env.frontMatterErrors,
    };
}

function stripObsidianComments(source: string): string {
    const lines = source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean) ?? [];
    let inComment = false;
    let fenceChar = '';
    let fenceLength = 0;
    return lines.map((line) => {
        const ending = /\r\n$|[\r\n]$/.exec(line)?.[0] ?? '';
        const body = ending ? line.slice(0, -ending.length) : line;
        const fence = !inComment ? /^ {0,3}(`{3,}|~{3,})/.exec(body) : null;
        if (fence) {
            const marker = fence[1]!;
            if (!fenceChar) {
                fenceChar = marker[0]!;
                fenceLength = marker.length;
            }
            else if (marker[0] === fenceChar && marker.length >= fenceLength) {
                fenceChar = '';
                fenceLength = 0;
            }
            return line;
        }
        if (fenceChar)
            return line;
        let output = '';
        let inlineTicks = 0;
        for (let index = 0; index < body.length;) {
            if (body[index] === '`' && !inComment) {
                let end = index + 1;
                while (body[end] === '`')
                    end++;
                const ticks = end - index;
                if (!inlineTicks || inlineTicks === ticks)
                    inlineTicks = inlineTicks ? 0 : ticks;
                output += body.slice(index, end);
                index = end;
                continue;
            }
            const marker = body.startsWith('%%', index) && body[index - 1] !== '\\';
            if (marker && !inlineTicks) {
                inComment = !inComment;
                output += '  ';
                index += 2;
                continue;
            }
            output += inComment ? ' ' : body[index]!;
            index++;
        }
        return output + ending;
    }).join('');
}
export function parseWikiTarget(source: string): WikiTarget {
    const pipe = source.indexOf('|');
    const rawTarget = (pipe >= 0 ? source.slice(0, pipe) : source).trim();
    const alias = pipe >= 0 ? source.slice(pipe + 1).trim() || null : null;
    let noteTitle = rawTarget;
    let heading: string | null = null;
    let blockId: string | null = null;
    if (rawTarget.startsWith('^')) {
        noteTitle = '';
        blockId = rawTarget.slice(1);
    }
    else {
        const hash = rawTarget.indexOf('#');
        if (hash >= 0) {
            noteTitle = rawTarget.slice(0, hash).trim();
            const fragment = rawTarget.slice(hash + 1).trim();
            if (fragment.startsWith('^'))
                blockId = fragment.slice(1);
            else
                heading = fragment || null;
        }
    }
    return { raw: rawTarget, noteTitle, heading, blockId, alias };
}
export function parseFenceInfo(source: string): FenceInfo {
    let rest = source.trim();
    let language = '';
    let title = '';
    let lineNumbers = false;
    let startLine = 1;
    const highlighted = new Set<number>();
    const leadingCodeOptions = /^\{([^{}]+)\}/.exec(rest);
    if (leadingCodeOptions && !/^\d[\d,\s-]*$/.test(leadingCodeOptions[1]!.trim())) {
        const classes = [...leadingCodeOptions[1]!.matchAll(/(?:^|\s)\.([A-Za-z][\w-]{0,63})/g)]
            .map((match) => match[1]!);
        language = classes.find((className) => !isReservedCodeClass(className))?.toLowerCase() ?? '';
        lineNumbers = classes.some(isReservedCodeClass);
        title = codeMetadataValue(leadingCodeOptions[1]!, 'title') ?? '';
        const startAttribute = codeMetadataValue(leadingCodeOptions[1]!, 'start', 'startfrom');
        if (startAttribute && /^\d+$/.test(startAttribute))
            startLine = clamp(Number(startAttribute), 1, 100000);
        const highlightAttribute = codeMetadataValue(leadingCodeOptions[1]!, 'hl_lines', 'highlight');
        if (highlightAttribute)
            parseLineSpec(highlightAttribute).forEach((line) => highlighted.add(line));
        rest = rest.slice(leadingCodeOptions[0].length).trim();
    }
    if (!language) {
        const lang = /^([^\s{]+)/.exec(rest);
        if (lang) {
            language = lang[1]!.toLowerCase();
            rest = rest.slice(lang[0].length).trim();
        }
    }
    const titleMatch = /(?:^|\s)title=(?:"([^"]*)"|'([^']*)'|([^\s]+))/.exec(rest);
    if (titleMatch)
        title = titleMatch[1] ?? titleMatch[2] ?? titleMatch[3] ?? '';
    const bracketTitle = /(?:^|\s)\[([^\]\n]+)\]/.exec(rest);
    if (!title && bracketTitle)
        title = bracketTitle[1]!.trim();
    lineNumbers = lineNumbers || /(?:^|\s)(?:line-numbers|linenos|numberLines)(?=\s|$)/.test(rest);
    const start = /(?:^|\s)(?:start|startFrom)=(?:"(\d+)"|'(\d+)'|(\d+))/.exec(rest);
    if (start)
        startLine = clamp(Number(start[1] ?? start[2] ?? start[3]), 1, 100000);
    const highlight = /(?:^|\s)\{(\d[\d,\s-]*)\}/.exec(rest);
    if (highlight)
        parseLineSpec(highlight[1]!).forEach((line) => highlighted.add(line));
    const highlightNamed = /(?:^|\s)(?:hl_lines|highlight)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/.exec(rest);
    if (highlightNamed) {
        parseLineSpec(highlightNamed[1] ?? highlightNamed[2] ?? highlightNamed[3] ?? '').forEach((line) => highlighted.add(line));
    }
    return {
        language,
        title,
        lineNumbers,
        startLine,
        highlightedLines: [...highlighted].sort((a, b) => a - b),
    };
}
function emptyEnvironment(): RenderEnvironment {
    const nonce = createNonce();
    return {
        headings: [],
        hasMath: false,
        hasMermaid: false,
        hasEmbeds: false,
        frontMatter: {},
        frontMatterErrors: [],
        taskNonce: nonce,
        tabSequence: 0,
        exampleSequence: 0,
        docId: `ink-${nonce}`,
    };
}
function renderEnv(value: unknown): RenderEnvironment {
    return value as RenderEnvironment;
}
function createNonce(): string {
    const secureCrypto = globalThis.crypto;
    if (secureCrypto && typeof secureCrypto.randomUUID === 'function')
        return secureCrypto.randomUUID();
    if (secureCrypto && typeof secureCrypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        secureCrypto.getRandomValues(bytes);
        return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function materializeTrustedTasks(html: string, nonce: string): string {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll<HTMLElement>('[data-task-placeholder]').forEach((placeholder) => {
        if (placeholder.dataset.taskPlaceholder !== nonce)
            return;
        const line = placeholder.dataset.taskLine;
        if (!line || !/^\d+$/.test(line))
            return;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'task-list-item-checkbox';
        input.checked = placeholder.dataset.taskChecked === '1';
        if (input.checked)
            input.setAttribute('checked', '');
        if (placeholder.closest('.markdown-example-preview')) {
            input.disabled = true;
            input.setAttribute('aria-label', t("markdown.the_tasks_in_the_example_are_read_only"));
        }
        else {
            input.dataset.taskLine = line;
            input.setAttribute('aria-label', input.checked ? t("markdown.mark_incomplete") : t("markdown.mark_complete"));
        }
        placeholder.replaceWith(input);
    });
    return template.innerHTML;
}
function renderFrontMatterValue(value: unknown): string {
    if (value == null)
        return '<span class="frontmatter-empty">—</span>';
    if (Array.isArray(value)) {
        return value.map((item) => `<span class="frontmatter-chip">${escapeHtml(formatScalar(item))}</span>`).join('');
    }
    if (typeof value === 'object')
        return `<code>${escapeHtml(JSON.stringify(value))}</code>`;
    return escapeHtml(formatScalar(value));
}
function formatScalar(value: unknown): string {
    if (value instanceof Date)
        return value.toISOString();
    return String(value);
}
function blockLine(state: {
    src: string;
    bMarks: number[];
    tShift: number[];
    eMarks: number[];
}, line: number): string {
    const from = state.bMarks[line]! + state.tShift[line]!;
    return state.src.slice(from, state.eMarks[line]!);
}
function findContainerEnd(state: {
    src: string;
    bMarks: number[];
    tShift: number[];
    eMarks: number[];
}, startLine: number, endLine: number, markerLength: number): number {
    let depth = 1;
    let fence: {
        char: string;
        length: number;
    } | null = null;
    for (let line = startLine + 1; line < endLine; line++) {
        const text = blockLine(state, line);
        const fenceMatch = /^(`{3,}|~{3,})/.exec(text);
        if (fenceMatch) {
            const marker = fenceMatch[1]!;
            if (!fence)
                fence = { char: marker[0]!, length: marker.length };
            else if (marker[0] === fence.char && marker.length >= fence.length)
                fence = null;
            continue;
        }
        if (fence)
            continue;
        if (new RegExp(`^:{${markerLength},}(?:\\s+(?:details|tabs)\\b|\\{tab-set\\})`).test(text))
            depth++;
        else if (new RegExp(`^:{${markerLength},}\\s*$`).test(text) && --depth === 0)
            return line;
    }
    return -1;
}
function findTabSegments(state: {
    src: string;
    bMarks: number[];
    tShift: number[];
    eMarks: number[];
}, start: number, end: number): Array<{
    title: string;
    start: number;
    end: number;
    selected: boolean;
}> {
    const directiveTabs = findDirectiveTabSegments(state, start, end);
    if (directiveTabs.length)
        return directiveTabs;
    const markers: Array<{
        line: number;
        title: string;
    }> = [];
    let fence: {
        char: string;
        length: number;
    } | null = null;
    for (let line = start; line < end; line++) {
        const text = blockLine(state, line);
        const fenceMatch = /^(`{3,}|~{3,})/.exec(text);
        if (fenceMatch) {
            const marker = fenceMatch[1]!;
            if (!fence)
                fence = { char: marker[0]!, length: marker.length };
            else if (marker[0] === fence.char && marker.length >= fence.length)
                fence = null;
            continue;
        }
        if (fence)
            continue;
        const tab = /^@tab[ \t]+(.+?)[ \t]*$/.exec(text);
        if (tab)
            markers.push({ line, title: stripBracketTitle(tab[1]!) || t("common.tabs") });
    }
    return markers.map((marker, index) => ({
        title: marker.title,
        start: marker.line + 1,
        end: markers[index + 1]?.line ?? end,
        selected: false,
    }));
}
function findDirectiveTabSegments(state: {
    src: string;
    bMarks: number[];
    tShift: number[];
    eMarks: number[];
}, start: number, end: number): Array<{
    title: string;
    start: number;
    end: number;
    selected: boolean;
}> {
    const tabs: Array<{ title: string; start: number; end: number; selected: boolean }> = [];
    for (let line = start; line < end;) {
        const match = /^(:{3,})(?:\{tab-item\}|[ \t]+tab-item)(?:[ \t]+(.*?))?[ \t]*$/.exec(blockLine(state, line));
        if (!match) {
            line++;
            continue;
        }
        const close = findColonFenceEnd(state, line + 1, end, match[1]!.length);
        if (close < 0)
            return [];
        let contentStart = line + 1;
        let selected = false;
        while (contentStart < close) {
            const option = /^:([a-z][a-z0-9_-]*):(?:[ \t]+.*)?$/i.exec(blockLine(state, contentStart));
            if (!option)
                break;
            if (option[1]!.toLowerCase() === 'selected')
                selected = true;
            contentStart++;
        }
        if (contentStart < close && !blockLine(state, contentStart).trim())
            contentStart++;
        tabs.push({
            title: stripBracketTitle(match[2] ?? '') || t("common.tabs"),
            start: contentStart,
            end: close,
            selected,
        });
        line = close + 1;
    }
    return tabs;
}
function findColonFenceEnd(state: {
    src: string;
    bMarks: number[];
    tShift: number[];
    eMarks: number[];
}, start: number, end: number, markerLength: number): number {
    let fence: { char: string; length: number } | null = null;
    for (let line = start; line < end; line++) {
        const text = blockLine(state, line);
        const codeFence = /^(`{3,}|~{3,})/.exec(text);
        if (codeFence) {
            const marker = codeFence[1]!;
            if (!fence)
                fence = { char: marker[0]!, length: marker.length };
            else if (marker[0] === fence.char && marker.length >= fence.length)
                fence = null;
            continue;
        }
        if (!fence && new RegExp(`^:{${markerLength},}\\s*$`).test(text))
            return line;
    }
    return -1;
}
function stripBracketTitle(value: string): string {
    const trimmed = value.trim();
    return /^\[[\s\S]*\]$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
}
function matchingClose(tokens: Token[], start: number, openType: string, closeType: string): number {
    let depth = 0;
    for (let index = start; index < tokens.length; index++) {
        if (tokens[index]!.type === openType)
            depth++;
        else if (tokens[index]!.type === closeType && --depth === 0)
            return index;
    }
    return -1;
}
function normalizeCalloutType(value: string): string {
    const type = value.toLowerCase();
    const aliases: Record<string, string> = {
        summary: 'abstract',
        tldr: 'abstract',
        hint: 'tip',
        important: 'tip',
        check: 'success',
        done: 'success',
        help: 'question',
        faq: 'question',
        caution: 'warning',
        attention: 'warning',
        fail: 'failure',
        missing: 'failure',
        error: 'danger',
        bug: 'danger',
        cite: 'quote',
    };
    return (aliases[type] ?? type.replace(/[^a-z0-9_-]/g, '')) || 'note';
}
function calloutDefaultTitle(type: string): string {
    const names: Record<string, string> = {
        note: t("markdown.note"),
        abstract: t("markdown.abstract"),
        info: t("markdown.info"),
        todo: t("markdown.todo"),
        tip: t("markdown.tip"),
        success: t("markdown.success"),
        question: t("markdown.question"),
        warning: t("markdown.warning"),
        failure: t("markdown.failure"),
        danger: t("markdown.danger"),
        example: t("markdown.example"),
        quote: t("common.quote"),
    };
    return names[type] ?? type;
}
function findOpeningToken(tokens: Token[], inlineIndex: number): Token | null {
    const previous = tokens[inlineIndex - 1];
    if (previous && ['paragraph_open', 'heading_open'].includes(previous.type))
        return previous;
    return null;
}
function expandBlockReferences(inline: Token, TokenConstructor: new (type: string, tag: string, nesting: -1 | 0 | 1) => Token): void {
    if (!inline.children)
        return;
    const expanded: Token[] = [];
    for (const child of inline.children) {
        if (child.type !== 'text' || !child.content.includes('((')) {
            expanded.push(child);
            continue;
        }
        let cursor = 0;
        const pattern = /\(\(([A-Za-z0-9][A-Za-z0-9_-]{0,63})\)\)/g;
        for (const match of child.content.matchAll(pattern)) {
            if (match.index! > cursor) {
                const textToken = new TokenConstructor('text', '', 0);
                textToken.content = child.content.slice(cursor, match.index);
                expanded.push(textToken);
            }
            const reference = new TokenConstructor('block_reference', 'a', 0);
            reference.content = match[1]!;
            expanded.push(reference);
            cursor = match.index! + match[0].length;
        }
        if (cursor < child.content.length) {
            const textToken = new TokenConstructor('text', '', 0);
            textToken.content = child.content.slice(cursor);
            expanded.push(textToken);
        }
    }
    inline.children = expanded;
}
function reparseInline(token: Token, content: string, markdown: MarkdownIt, env: unknown): void {
    const children: Token[] = [];
    markdown.inline.parse(content, markdown, env, children);
    token.content = content;
    token.children = children;
}
function setTokenAttribute(token: Token, name: string, value: string): void {
    if (name === 'class') {
        value.split(/\s+/).filter(Boolean).forEach((className) => appendTokenClass(token, className));
    }
    else {
        token.attrSet(name, value);
    }
}
function appendTokenClass(token: Token, className: string): void {
    const current = token.attrGet('class')?.split(/\s+/).filter(Boolean) ?? [];
    if (!current.includes(className))
        current.push(className);
    token.attrSet('class', current.join(' '));
}
function parseLineSpec(source: string): number[] {
    const lines = new Set<number>();
    for (const part of source.split(/[ ,]+/).filter(Boolean).slice(0, 200)) {
        const range = /^(\d+)-(\d+)$/.exec(part);
        if (range) {
            const from = clamp(Number(range[1]), 1, 100000);
            const to = clamp(Number(range[2]), from, Math.min(100000, from + 1000));
            for (let line = from; line <= to; line++)
                lines.add(line);
        }
        else if (/^\d+$/.test(part)) {
            lines.add(clamp(Number(part), 1, 100000));
        }
    }
    return [...lines];
}
function isReservedCodeClass(value: string): boolean {
    return ['numberlines', 'line-numbers', 'linenos'].includes(value.toLowerCase());
}
function codeMetadataValue(source: string, ...names: string[]): string | null {
    const wanted = new Set(names.map((name) => name.toLowerCase()));
    const pattern = /(?:^|\s)([A-Za-z][\w-]*)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
    for (const match of source.matchAll(pattern)) {
        if (wanted.has(match[1]!.toLowerCase()))
            return (match[2] ?? match[3] ?? match[4] ?? '').slice(0, 512);
    }
    return null;
}
function localizeFrontMatterError(error: string): string {
    if (error === 'Front Matter exceeds the 64 KiB safety limit')
        return t("markdown.front_matter_exceeds_the_64_kib_safety_limit");
    if (error === 'Front Matter root must be a YAML mapping')
        return t("markdown.the_front_matter_root_must_be_a_yaml_mapping");
    return getLocale() === 'zh-CN' ? t("markdown.invalid_yaml_check_indentation_quotes_and_duplicate_keys") : error;
}
function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.trunc(value) : min));
}
function plainInline(token: Token): string {
    if (token.type !== 'inline' || !token.children)
        return token.content;
    return token.children
        .filter((child) => ['text', 'code_inline', 'inline_tag', 'wikilink', 'block_reference'].includes(child.type))
        .map((child) => child.content)
        .join('')
        .trim();
}
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function escapeAttr(text: string): string {
    return escapeHtml(text).replace(/'/g, '&#39;').replace(/\n/g, '&#10;');
}
