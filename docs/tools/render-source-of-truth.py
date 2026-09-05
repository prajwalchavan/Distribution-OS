#!/usr/bin/env python3
"""Render docs/22-source-of-truth.md to a self-contained HTML page (Mermaid blocks kept as <pre class="mermaid">).

Usage: python3 docs/tools/render-source-of-truth.py [out.html]
The markdown is canonical; this page is only a view of it. Supports the subset the file uses:
headings, paragraphs, bold/italic/code/links, bullet + numbered lists, pipe tables, ``` fences, --- rules.
"""
import html, re, sys, pathlib

SRC = pathlib.Path(__file__).resolve().parents[1] / '22-source-of-truth.md'
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else SRC.with_suffix('.html')

def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<em>\1</em>', t)
    t = re.sub(r'(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])', r'<em>\1</em>', t)
    t = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', r'<a href="\2">\1</a>', t)
    t = re.sub(r'(?<![">])(https://[^\s<)]+)', r'<a href="\1">\1</a>', t)
    t = t.replace('&lt;br/&gt;', '<br/>')
    return t

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

lines = SRC.read_text().split('\n')
out, i, toc = [], 0, []
para = []
def flush():
    global para
    if para:
        out.append('<p>' + inline(' '.join(x.strip() for x in para)) + '</p>')
        para = []
while i < len(lines):
    ln = lines[i]
    if ln.startswith('```'):
        flush(); lang = ln[3:].strip(); buf = []; i += 1
        while i < len(lines) and not lines[i].startswith('```'):
            buf.append(lines[i]); i += 1
        body = '\n'.join(buf)
        if lang == 'mermaid':
            out.append('<div class="diagram"><pre class="mermaid">' + html.escape(body, quote=False) + '</pre></div>')
        else:
            out.append('<pre><code>' + html.escape(body) + '</code></pre>')
        i += 1; continue
    m = re.match(r'^(#{1,3}) (.*)', ln)
    if m:
        flush(); lvl = len(m.group(1)); text = m.group(2)
        sid = slug(text)
        if lvl == 2: toc.append((sid, text))
        out.append(f'<h{lvl} id="{sid}">{inline(text)}</h{lvl}>'); i += 1; continue
    if ln.strip() == '---':
        flush(); out.append('<hr/>'); i += 1; continue
    if ln.startswith('|'):
        flush(); rows = []
        while i < len(lines) and lines[i].startswith('|'):
            rows.append(lines[i]); i += 1
        cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
        head, body = cells[0], [r for r in cells[2:]] if len(cells) > 1 and set(''.join(cells[1])) <= set('-| :') else (None, cells)
        t = ['<div class="tablewrap"><table>']
        if head:
            t.append('<thead><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in head) + '</tr></thead>')
        t.append('<tbody>')
        for r in body:
            t.append('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>')
        t.append('</tbody></table></div>')
        out.append('\n'.join(t)); continue
    m = re.match(r'^(\s*)([-*]|\d+\.) (.*)', ln)
    if m:
        flush(); ordered = m.group(2)[0].isdigit(); items = []
        while i < len(lines):
            m2 = re.match(r'^(\s*)([-*]|\d+\.) (.*)', lines[i])
            if m2:
                items.append(m2.group(3)); i += 1
            elif lines[i].startswith('   ') and items:
                items[-1] += ' ' + lines[i].strip(); i += 1
            else:
                break
        tag = 'ol' if ordered else 'ul'
        out.append(f'<{tag}>' + ''.join(f'<li>{inline(x)}</li>' for x in items) + f'</{tag}>'); continue
    if ln.strip() == '':
        flush(); i += 1; continue
    para.append(ln); i += 1
flush()

NUM = re.compile(r'^\d+\. ')
nav = ''.join('<a href="#%s">%s</a>' % (s, html.escape(NUM.sub('', t))) for s, t in toc)
page = f'''<title>Distribution OS Source of Truth</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{{--bg:#f6f7f5;--surface:#ffffff;--ink:#1b2320;--muted:#5c6764;--rule:#d5dbd7;--accent:#0f6b5b;--accent-soft:#e3f0ec;--code:#eef1ef;--no:#b42318;color-scheme:light}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#111716;--surface:#171e1c;--ink:#e6ebe8;--muted:#9aa6a1;--rule:#2b3532;--accent:#5cc4ac;--accent-soft:#1c2f2a;--code:#1f2825;--no:#ff8a7a;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#111716;--surface:#171e1c;--ink:#e6ebe8;--muted:#9aa6a1;--rule:#2b3532;--accent:#5cc4ac;--accent-soft:#1c2f2a;--code:#1f2825;--no:#ff8a7a;color-scheme:dark}}
body{{background:var(--bg);color:var(--ink);font:16px/1.55 "IBM Plex Sans",system-ui,-apple-system,Segoe UI,sans-serif;margin:0}}
main{{max-width:1080px;margin:0 auto;padding:32px 24px 80px}}
header{{border-bottom:1px solid var(--rule);padding-bottom:20px;margin-bottom:24px}}
.eyebrow{{font:500 12px/1 "IBM Plex Mono",ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}}
h1{{font:600 34px/1.15 "IBM Plex Serif",Georgia,serif;margin:8px 0 6px;text-wrap:balance}}
h2{{font:600 24px/1.2 "IBM Plex Serif",Georgia,serif;margin:44px 0 12px;padding-top:20px;border-top:1px solid var(--rule);text-wrap:balance}}
h3{{font:600 17px/1.3 "IBM Plex Sans",system-ui,sans-serif;margin:24px 0 8px}}
p{{max-width:78ch;margin:0 0 12px}}
li{{max-width:78ch;margin:4px 0}}
a{{color:var(--accent)}}
code{{font:.92em "IBM Plex Mono",ui-monospace,Menlo,monospace;background:var(--code);padding:1px 5px;border-radius:3px}}
pre code{{background:none;padding:0}}
pre{{background:var(--code);padding:12px;overflow-x:auto;border-radius:4px}}
hr{{border:0;border-top:1px solid var(--rule);margin:28px 0}}
nav.toc{{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:14px;margin-top:14px}}
nav.toc a{{text-decoration:none;color:var(--muted)}}
nav.toc a:hover,nav.toc a:focus{{color:var(--accent);text-decoration:underline}}
.canon{{background:var(--accent-soft);border-left:3px solid var(--accent);padding:10px 14px;font-size:14px;margin:14px 0 0;max-width:none}}
.tablewrap{{overflow-x:auto;margin:12px 0 18px;border:1px solid var(--rule);border-radius:4px;background:var(--surface)}}
table{{border-collapse:collapse;width:100%;font-size:14px}}
th,td{{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--rule)}}
th{{font-weight:600;background:var(--code);white-space:nowrap}}
tbody tr:last-child td{{border-bottom:0}}
td:first-child{{white-space:nowrap;font-variant-numeric:tabular-nums}}
.diagram{{overflow-x:auto;background:var(--surface);border:1px solid var(--rule);border-radius:4px;padding:12px;margin:14px 0 18px}}
.diagram pre.mermaid{{background:none;padding:0;margin:0;font:13px/1.4 "IBM Plex Mono",ui-monospace,monospace;color:var(--ink)}}
.diagram svg{{max-width:100%;height:auto}}
strong{{font-weight:600}}
:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
@media (prefers-reduced-motion: reduce){{*{{scroll-behavior:auto}}}}
@media (max-width:640px){{main{{padding:20px 14px 60px}}h1{{font-size:28px}}h2{{font-size:21px}}}}
</style>
<main>
<header>
<div class="eyebrow">Distribution OS · reference</div>
<h1>Single source of truth</h1>
<p class="canon">This page is a rendered view. The canonical file is <code>docs/22-source-of-truth.md</code> in the repository
(<a href="https://github.com/prajwalchavan/Distribution-OS/blob/main/docs/22-source-of-truth.md">view on GitHub</a>); it is updated in the same turn
as any founder decision and this page is republished from it.</p>
<nav class="toc" aria-label="Sections">{nav}</nav>
</header>
{chr(10).join(out[1:] if out and out[0].startswith('<h1') else out)}
</main>
'''
OUT.write_text(page)
print(f'wrote {OUT} ({len(page)} bytes, {len(toc)} sections)')
