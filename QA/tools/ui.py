#!/usr/bin/env python3
"""uiautomator helper: `ui.py edit N` -> centre of the Nth EditText; `ui.py text "Sign in"` -> centre of the last
clickable node with that text (falls back to any node); `ui.py has-edit` -> exit 0 if an EditText is on screen;
`ui.py texts` -> the visible texts. Reads the dump through adb; prints "x y"."""
import re, subprocess, sys
def dump():
    # uiautomator occasionally answers "could not get idle state" mid-animation; retry rather than report an empty screen
    for _ in range(4):
        subprocess.run(['adb', 'shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], capture_output=True, timeout=30)
        out = subprocess.run(['adb', 'shell', 'cat', '/sdcard/ui.xml'], capture_output=True, text=True, timeout=30).stdout
        if '<hierarchy' in out: return out
        subprocess.run(['adb', 'shell', 'rm', '-f', '/sdcard/ui.xml'], capture_output=True)
    return ''

def centre(node):
    m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
    x1, y1, x2, y2 = map(int, m.groups()); return f'{(x1+x2)//2} {(y1+y2)//2}'
x = dump(); cmd = sys.argv[1]
nodes = re.findall(r'<node [^>]*>', x)
if cmd == 'edit':
    edits = [n for n in nodes if 'class="android.widget.EditText"' in n]
    i = int(sys.argv[2]) - 1
    print(centre(edits[i]) if i < len(edits) else '')
elif cmd == 'text':
    t = sys.argv[2]
    hits = [n for n in nodes if f'text="{t}"' in n or f'content-desc="{t}"' in n]
    click = [n for n in hits if 'clickable="true"' in n]
    print(centre((click or hits)[-1]) if hits else '')
elif cmd == 'has-edit':
    sys.exit(0 if any('class="android.widget.EditText"' in n for n in nodes) else 1)
elif cmd == 'texts':
    print(' | '.join(t for t in re.findall(r'text="([^"]+)"', x))[:600])
