"""Print the text of a PDF in LAYOUT mode (columns kept apart by spaces), one blank-line-separated page after another.

    python3 pdf-to-text.py "customer data whole pdf.pdf" > customers.txt

The legacy customer master is a Crystal report whose fields sit in columns (`Address Line2 : ... Telephone no: ...`);
only layout mode keeps a field and its label on one line. Needs `pypdf` (`pip install pypdf`). It reads the file and
writes to stdout — it never writes next to the PDF and never keeps a copy.
"""

import sys

try:
    from pypdf import PdfReader
except ImportError:
    sys.stderr.write("pypdf is not installed: run `pip install pypdf` (or `python3 -m venv v && v/bin/pip install pypdf`)\n")
    sys.exit(3)

if len(sys.argv) != 2:
    sys.stderr.write("usage: pdf-to-text.py <file.pdf>\n")
    sys.exit(2)

reader = PdfReader(sys.argv[1])
for page in reader.pages:
    sys.stdout.write(page.extract_text(extraction_mode="layout"))
    sys.stdout.write("\n\n")
