# ordena**R**

> **Arrange authors, affiliations, and ORCIDs — without the Excel chaos.**

A free, open-source, browser-only tool that helps academic authors generate properly formatted author/affiliation/email/ORCID lists for paper submissions, and reformat them when journals change or affiliations shift during peer review.

🌐 Live site: <https://felixpleiva.github.io/ordenaR/>
📦 Source: <https://github.com/felixpleiva/ordenaR>

---

## Features

- **Import from Excel/CSV.** Already collected author info in a spreadsheet? Upload it (xlsx, xls, csv, tsv, ods) and ordenaR auto-detects the columns and lets you confirm/adjust the mapping before importing.
- **CRediT-aware** — tick the 14 official Contributor Roles per author; outputs a paper-ready statement and includes them in the Word (.docx) download. CRediT columns in your spreadsheet are auto-detected on import.
- **Word (.docx) export.** Download a real Word document with the title, author byline (with proper superscript affiliation numbers), affiliations list, corresponding author info, and a full author details table.
- **Send-one-link workflow.** Corresponding author generates an invitation link; each coauthor opens it, fills their own block, and clicks **Send to corresponding author** — their email client opens with a JSON-payload email pre-addressed to you. No accounts, no logins, no cloud.
- **30+ output formats** at one click. Generic plain text (Nature/Science, Elsevier), journal-specific plain text (PLOS, Cell Press, PNAS, eLife, MDPI, Wiley, Frontiers, Royal Society, Nature Communications, Nature Methods, AGU, APA, Vancouver), an Ecology & Evolution suite, LaTeX (elsarticle, Springer svjour3, IEEE/generic), Quarto/RMarkdown YAML, Word-ready HTML, BibTeX, CSL JSON, EndNote XML, and a Markdown profiles table.
- **ORCID validation** via the official ISO 7064 MOD 11-2 checksum (offline).
- **Affiliation deduplication** — identical affiliations across authors share a superscript automatically.
- **Two sort modes**: manual (drag & drop) or alphabetical by last name. Optional "Keep senior authors at the end".
- **Privacy by design** — no backend, no analytics. All data lives in your browser's `localStorage`.
- **Mobile-friendly** down to 375 px width. Keyboard-navigable.

## Quick start (use the hosted version)

1. Open <https://felixpleiva.github.io/ordenaR/author-manager.html>
2. Enter your project title.
3. Fill in your own author card and tick **Corresponding author**.
4. Click **Generate invitation link**, then **Email it** or **Copy link**. Send to each coauthor.
5. As replies arrive, paste each email body into **Coauthor entries → Paste from email**.
6. Approve each pending entry. Pick a journal format. Copy or download.

## How to cite

If ordena**R** supports your work, please cite the [`CITATION.cff`](CITATION.cff). GitHub will display a "Cite this repository" button at the top right of the repo page.

## License

- Code: [MIT](LICENSE)
- Documentation: [CC-BY 4.0](LICENSE-docs)
