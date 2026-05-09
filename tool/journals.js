/* ordenaR — journal/format configuration.
 * Each entry describes how a format is rendered. The actual rendering logic
 * lives in app.js; this file is a registry/config so that contributors can
 * easily add new journal styles via pull requests.
 *
 * To add a new format:
 *   1. Add a new entry below with id, label, ext (file extension), kind
 *      ("plain" | "latex" | "yaml" | "html" | "markdown" | "json" | "xml").
 *   2. Add a corresponding renderer function in app.js (renderers map).
 *      For plain-text journal styles, the easiest path is to call the
 *      shared `renderNumberedPlain(authors, project, opts)` helper with
 *      the appropriate options — see existing entries for examples.
 *   3. Add an <option> in tool/index.html with matching value, under the
 *      appropriate <optgroup>.
 */
window.ORDENAR_FORMATS = [
  // — Plain text — generic publisher styles —
  { id: "nature",          label: "Plain text — Nature/Science",            ext: "txt",  kind: "plain"    },
  { id: "elsevier",        label: "Plain text — Elsevier",                  ext: "txt",  kind: "plain"    },

  // — Plain text — general journal-specific —
  { id: "plos",            label: "PLOS family (plain text)",               ext: "txt",  kind: "plain"    },
  { id: "cell",            label: "Cell Press (plain text)",                ext: "txt",  kind: "plain"    },
  { id: "pnas",            label: "PNAS (plain text)",                      ext: "txt",  kind: "plain"    },
  { id: "elife",           label: "eLife (plain text)",                     ext: "txt",  kind: "plain"    },
  { id: "wiley",           label: "Wiley generic (plain text)",             ext: "txt",  kind: "plain"    },
  { id: "royal-society",   label: "Royal Society (plain text)",             ext: "txt",  kind: "plain"    },
  { id: "nature-comms",    label: "Nature Communications (plain text)",     ext: "txt",  kind: "plain"    },
  { id: "nature-methods",  label: "Nature Methods (plain text)",            ext: "txt",  kind: "plain"    },
  { id: "agu",             label: "AGU journals (plain text)",              ext: "txt",  kind: "plain"    },
  { id: "apa",             label: "APA — psychology (plain text)",          ext: "txt",  kind: "plain"    },
  { id: "vancouver",       label: "Vancouver — medical (plain text)",       ext: "txt",  kind: "plain"    },

  // — Ecology & Evolution —
  { id: "ecology-letters", label: "Ecology Letters",                        ext: "txt",  kind: "plain"    },
  { id: "bes",             label: "British Ecological Society suite",       ext: "txt",  kind: "plain"    },
  { id: "esa",             label: "Ecological Society of America",          ext: "txt",  kind: "plain"    },
  { id: "oikos-nordic",    label: "Oikos / Ecography (Nordic)",             ext: "txt",  kind: "plain"    },
  { id: "evolution",       label: "Evolution / Evolution Letters (SSE)",    ext: "txt",  kind: "plain"    },
  { id: "mol-ecol",        label: "Molecular Ecology",                      ext: "txt",  kind: "plain"    },
  { id: "jeb",             label: "Journal of Evolutionary Biology",        ext: "txt",  kind: "plain"    },
  { id: "am-nat",          label: "The American Naturalist",                ext: "txt",  kind: "plain"    },
  { id: "tree",            label: "Trends in Ecology & Evolution",          ext: "txt",  kind: "plain"    },
  { id: "gcb",             label: "Global Change Biology",                  ext: "txt",  kind: "plain"    },
  { id: "conservation",    label: "Conservation Biology / Bio. Cons.",      ext: "txt",  kind: "plain"    },
  { id: "behav-ecol",      label: "Behavioral Ecology (Oxford)",            ext: "txt",  kind: "plain"    },
  { id: "heredity-genetics", label: "Heredity / Genetics",                  ext: "txt",  kind: "plain"    },
  { id: "bmc-ecol-evol",   label: "BMC Ecology and Evolution",              ext: "txt",  kind: "plain"    },
  { id: "annual-review",   label: "Annual Review of Ecol., Evol. & Syst.",  ext: "txt",  kind: "plain"    },

  // — LaTeX —
  { id: "elsarticle",      label: "LaTeX — elsarticle",                     ext: "tex",  kind: "latex"    },
  { id: "springer",        label: "LaTeX — Springer (svjour3)",             ext: "tex",  kind: "latex"    },
  { id: "ieee",            label: "LaTeX — IEEE / generic",                 ext: "tex",  kind: "latex"    },

  // — Structured / interchange —
  { id: "quarto",          label: "Quarto / RMarkdown YAML",                ext: "yml",  kind: "yaml"     },
  { id: "word",            label: "Word-ready (HTML)",                      ext: "html", kind: "html"     },
  { id: "bibtex",          label: "BibTeX author field",                    ext: "bib",  kind: "plain"    },
  { id: "csl-json",        label: "CSL JSON (Zotero, Mendeley)",            ext: "json", kind: "plain"    },
  { id: "endnote-xml",     label: "EndNote XML",                            ext: "xml",  kind: "plain"    },

  // — Markdown / supplementary —
  { id: "profiles-md",     label: "Author profiles (Markdown)",             ext: "md",   kind: "markdown" },
  { id: "credit",          label: "CRediT statement",                       ext: "md",   kind: "markdown" }
];
