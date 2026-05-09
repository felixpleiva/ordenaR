/* ordenaR — Author Manager (vanilla JS, no frameworks)
 * --------------------------------------------------------
 * Single-file SPA that lets researchers manage paper authorship.
 *
 * Two operating modes:
 *   - NORMAL MODE: corresponding author edits a master copy, invites
 *     coauthors, reviews their pending entries, exports to journal formats.
 *   - INVITE MODE (?invite=…): a coauthor lands on a simplified one-author
 *     form that emails their entry back to the corresponding author via
 *     a mailto: link with a fenced JSON payload.
 *
 * Privacy: no network calls at runtime (only Google Fonts CSS in the
 * <link>). All state lives in localStorage + memory.
 *
 * NEW FEATURES (added):
 *   - Spreadsheet import (Excel/CSV via SheetJS CDN)
 *   - Word .docx export (via docx.js CDN)
 */
(function () {
  "use strict";

  /* ============================================================ *
   * 1. Constants & state                                          *
   * ============================================================ */

  const LS_KEY_PREFIX = "ordenaR:project:";
  const LS_LAST_KEY   = "ordenaR:lastTitle";

  /** The 14 official CRediT Contributor Roles Taxonomy roles. */
  const CREDIT_ROLES = [
    { key: "conceptualization",      label: "Conceptualization" },
    { key: "dataCuration",           label: "Data curation" },
    { key: "formalAnalysis",         label: "Formal analysis" },
    { key: "fundingAcquisition",     label: "Funding acquisition" },
    { key: "investigation",          label: "Investigation" },
    { key: "methodology",            label: "Methodology" },
    { key: "projectAdministration",  label: "Project administration" },
    { key: "resources",              label: "Resources" },
    { key: "software",               label: "Software" },
    { key: "supervision",            label: "Supervision" },
    { key: "validation",             label: "Validation" },
    { key: "visualization",          label: "Visualization" },
    { key: "writingOriginalDraft",   label: "Writing — original draft" },
    { key: "writingReviewEditing",   label: "Writing — review & editing" }
  ];

  // One-time migration from old authoRrange keys
  (function migrateKeys() {
    try {
      const oldLast = localStorage.getItem("authoRrange:lastTitle");
      if (oldLast && !localStorage.getItem(LS_LAST_KEY)) {
        const data = localStorage.getItem(oldLast);
        if (data) {
          const newKey = oldLast.replace("authoRrange:", "ordenaR:");
          localStorage.setItem(newKey, data);
          localStorage.setItem(LS_LAST_KEY, newKey);
        }
      }
    } catch (e) { /* ignore migration errors */ }
  })();

  // Markers used in the mailto body so the corresponding author can
  // robustly extract the JSON payload (even after email clients add
  // signatures, quote marks, line wrapping, etc.).
  const MARK_BEGIN = "----- BEGIN ORDENAR ENTRY -----";
  const MARK_END   = "----- END ORDENAR ENTRY -----";

  /**
   * Project state shape:
   *   {
   *     title: string,
   *     authors: [Author],
   *     format: string,         // selected output format id
   *     sortMode: "manual"|"alpha",
   *     keepSeniorEnd: bool,
   *     pending: [Author]       // pending coauthor entries awaiting review
   *   }
   */
  const state = {
    title: "",
    authors: [],
    format: "nature",
    sortMode: "manual",
    keepSeniorEnd: false,
    pending: []
  };

  /* ============================================================ *
   * 2. Utilities                                                  *
   * ============================================================ */

  function uid() { return "a_" + Math.random().toString(36).slice(2, 10); }

  /** Empty author with all fields. */
  function emptyAuthor() {
    return {
      id: uid(),
      firstName: "", middleName: "", lastName: "",
      email: "", orcid: "",
      affiliations: [{ department: "", institution: "", city: "", country: "" }],
      presentAddress: "",
      corresponding: false, equalContribution: false, deceased: false,
      senior: false,
      equalSymbol: "*",
      scholar: "", researchgate: "", github: "",
      bluesky: "", mastodon: "", twitter: "",
      linkedin: "", website: "", osf: "",
      credit: {
        conceptualization: false, dataCuration: false, formalAnalysis: false,
        fundingAcquisition: false, investigation: false, methodology: false,
        projectAdministration: false, resources: false, software: false,
        supervision: false, validation: false, visualization: false,
        writingOriginalDraft: false, writingReviewEditing: false
      }
    };
  }

  function norm(s) { return (s || "").trim().replace(/\s+/g, " "); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function fullName(a) {
    return [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" ").trim();
  }

  function initials(a) {
    const f = (a.firstName || "").trim()[0];
    const l = (a.lastName  || "").trim()[0];
    return [f, l].filter(Boolean).map(c => c.toUpperCase() + ".").join("");
  }

  function toSuper(n) {
    const map = { "0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹" };
    return String(n).split("").map(c => map[c] || c).join("");
  }
  function toLetter(n) {
    let s = "";
    while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
  }

  /** URL-safe base64 (Unicode-safe). */
  function b64encode(s) {
    return btoa(unescape(encodeURIComponent(s)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64decode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return decodeURIComponent(escape(atob(s)));
  }

  /* ============================================================ *
   * 3. Validation                                                 *
   * ============================================================ */

  function validEmail(s) {
    if (!s) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  /**
   * Validate ORCID via ISO 7064 MOD 11-2.
   * total starts at 0; for each of the first 15 digits do
   *   total = (total + digit) * 2
   * remainder = total % 11; computed = (12 - remainder) % 11.
   * "X" denotes the value 10.
   */
  function validORCID(s) {
    if (!s) return null;
    const digits = s.replace(/[^0-9X]/gi, "").toUpperCase();
    if (digits.length !== 16) return false;
    let total = 0;
    for (let i = 0; i < 15; i++) {
      const d = parseInt(digits[i], 10);
      if (isNaN(d)) return false;
      total = (total + d) * 2;
    }
    const remainder = total % 11;
    const check = (12 - remainder) % 11;
    const last = digits[15] === "X" ? 10 : parseInt(digits[15], 10);
    return check === last;
  }
  function formatORCID(s) {
    const d = (s || "").replace(/[^0-9X]/gi, "").toUpperCase();
    if (d.length !== 16) return s;
    return `${d.slice(0,4)}-${d.slice(4,8)}-${d.slice(8,12)}-${d.slice(12,16)}`;
  }

  /* ============================================================ *
   * 4. Affiliation deduplication & numbering                      *
   * ============================================================ */

  function affilKey(af) {
    return [af.department, af.institution, af.city, af.country]
      .map(norm).map(s => s.toLowerCase()).join("||");
  }
  function affilText(af) {
    return [af.department, af.institution, af.city, af.country]
      .map(norm).filter(Boolean).join(", ");
  }

  /**
   * Assign 1-based affiliation indices to each author such that identical
   * affiliations (by normalized institution+city+country+department) share
   * an index. Returns { order, byKey, authorIdx }.
   */
  function buildAffilIndex(authors) {
    const byKey = {};
    const order = [];
    const authorIdx = [];
    authors.forEach(a => {
      const idxList = [];
      (a.affiliations || []).forEach(af => {
        const text = affilText(af);
        if (!text) return;
        const key = affilKey(af);
        if (!(key in byKey)) {
          order.push(key);
          byKey[key] = { idx: order.length, text, key };
        }
        if (!idxList.includes(byKey[key].idx)) idxList.push(byKey[key].idx);
      });
      authorIdx.push(idxList);
    });
    return { order, byKey, authorIdx };
  }

  /* ============================================================ *
   * 5. Sorting                                                    *
   * ============================================================ */

  /**
   * Return a new ordered copy of `authors` according to `mode`.
   * Modes:
   *   "manual" — preserve current order
   *   "alpha"  — sort by lastName, then firstName; equal-contribution groups
   *              (same equalSymbol) stay contiguous and are alphabetized within
   * `keepSeniorEnd` (only when not manual): authors flagged senior are
   * extracted, the rest sorted by mode, then seniors appended (alphabetical
   * among themselves).
   */
  function sortAuthors(authors, mode, keepSeniorEnd) {
    if (!authors || authors.length === 0) return [];
    const arr = authors.slice();

    if (mode === "manual") return arr;

    // For "alpha" we may pull seniors out first.
    let seniors = [];
    let rest = arr;
    if (keepSeniorEnd) {
      seniors = arr.filter(a => a.senior);
      rest    = arr.filter(a => !a.senior);
    }

    if (mode === "alpha") {
      rest = sortAlphaWithEqualGroups(rest);
    }

    seniors.sort(alphaCmp);
    return rest.concat(seniors);
  }

  function alphaCmp(a, b) {
    const la = norm(a.lastName).toLowerCase();
    const lb = norm(b.lastName).toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    const fa = norm(a.firstName).toLowerCase();
    const fb = norm(b.firstName).toLowerCase();
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  }

  /** Alphabetical, but keep equal-contribution groups (same symbol) together
   * and alphabetize within them. We treat the group's earliest alphabetical
   * member as the group's sort key. */
  function sortAlphaWithEqualGroups(arr) {
    // Bucket: equal-contribution groups by symbol vs. solo authors
    const groups = new Map(); // symbol -> array
    const solo = [];
    arr.forEach(a => {
      if (a.equalContribution) {
        const sym = a.equalSymbol || "*";
        if (!groups.has(sym)) groups.set(sym, []);
        groups.get(sym).push(a);
      } else {
        solo.push(a);
      }
    });
    // Sort each group internally
    for (const g of groups.values()) g.sort(alphaCmp);
    // Build a flat list of items {key, members[]} and sort by key
    const items = [];
    solo.forEach(a => items.push({ key: alphaKey(a), members: [a] }));
    for (const [sym, members] of groups.entries()) {
      // Group's sort key = key of its alphabetically-first member.
      items.push({ key: alphaKey(members[0]), members });
    }
    items.sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
    return items.flatMap(it => it.members);
  }
  function alphaKey(a) {
    return (norm(a.lastName) + "|" + norm(a.firstName)).toLowerCase();
  }

  /* ============================================================ *
   * 6. Persistence                                                *
   * ============================================================ */

  function saveState() {
    try {
      const key = LS_KEY_PREFIX + (norm(state.title) || "_untitled");
      // Don't persist pending across sessions to keep state clean? We DO
      // persist them so the corresponding author can review them later.
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem(LS_LAST_KEY, key);
    } catch (e) { console.warn("ordenaR: save failed", e); }
  }
  function loadState() {
    try {
      const lastKey = localStorage.getItem(LS_LAST_KEY);
      if (lastKey) {
        const raw = localStorage.getItem(lastKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          Object.assign(state, parsed);
          state.pending = state.pending || [];
          // Migration: ensure all authors have a credit object
          state.authors.forEach(a => {
            if (!a.credit) a.credit = emptyAuthor().credit;
          });
          state.pending.forEach(a => {
            if (!a.credit) a.credit = emptyAuthor().credit;
          });
          return true;
        }
      }
    } catch (e) { console.warn("ordenaR: load failed", e); }
    return false;
  }

  /* ============================================================ *
   * 7. Output renderers                                           *
   * ============================================================ */

  /** Get the *display order* (sorted) view of the authors.
   * Output formats render the displayed order — what you see is what you ship. */
  function displayedAuthors() {
    return sortAuthors(state.authors, state.sortMode, state.keepSeniorEnd);
  }

  const renderers = {
    nature(s) {
      const authors = displayedAuthors();
      const idx = buildAffilIndex(authors);
      const lines = [];
      const authorLine = authors.map((a, i) => {
        const sup = [
          ...idx.authorIdx[i].map(toSuper),
          ...(a.corresponding ? ["*"] : []),
          ...(a.equalContribution ? [a.equalSymbol || "†"] : []),
          ...(a.deceased ? ["§"] : [])
        ].join(",");
        return fullName(a) + (sup ? sup : "");
      }).join(", ");
      lines.push(authorLine, "");
      idx.order.forEach((k, i) => lines.push(`${toSuper(i + 1)} ${idx.byKey[k].text}`));
      const corr = authors.filter(a => a.corresponding && a.email);
      if (corr.length) {
        lines.push("");
        lines.push("* Corresponding author" + (corr.length > 1 ? "s" : "") +
          ": " + corr.map(a => a.email).join(", "));
      }
      const eq = authors.filter(a => a.equalContribution);
      if (eq.length) {
        const sym = eq[0].equalSymbol || "†";
        lines.push(`${sym} These authors contributed equally to this work.`);
      }
      const dec = authors.filter(a => a.deceased);
      if (dec.length) lines.push("§ Deceased.");
      const present = authors.filter(a => norm(a.presentAddress));
      present.forEach(a => lines.push(`Present address (${fullName(a)}): ${norm(a.presentAddress)}`));
      return lines.join("\n");
    },

    elsevier(s) {
      const authors = displayedAuthors();
      const idx = buildAffilIndex(authors);
      const lines = [];
      const authorLine = authors.map((a, i) => {
        const sup = [
          ...idx.authorIdx[i].map(toLetter),
          ...(a.corresponding ? ["*"] : [])
        ].join(",");
        return fullName(a) + (sup ? sup : "");
      }).join(", ");
      lines.push(authorLine, "");
      idx.order.forEach((k, i) => lines.push(`${toLetter(i + 1)} ${idx.byKey[k].text}`));
      const corr = authors.filter(a => a.corresponding && a.email);
      if (corr.length) {
        lines.push("");
        lines.push("* Corresponding author. E-mail: " + corr.map(a => a.email).join("; "));
      }
      return lines.join("\n");
    },

    elsarticle(s) {
      const authors = displayedAuthors();
      const idx = buildAffilIndex(authors);
      const out = ["% LaTeX — elsarticle author block"];
      authors.forEach((a, i) => {
        const labels = idx.authorIdx[i].map(toLetter).join(",");
        const corref = a.corresponding ? "\\corref{cor1}" : "";
        out.push(`\\author[${labels}]{${fullName(a)}${corref}}`);
        if (a.corresponding && a.email) out.push(`\\ead{${a.email}}`);
        if (norm(a.orcid)) out.push(`% ORCID: ${formatORCID(a.orcid)}`);
      });
      idx.order.forEach((k, i) => {
        out.push(`\\address[${toLetter(i + 1)}]{${idx.byKey[k].text}}`);
      });
      if (authors.some(a => a.corresponding)) out.push("\\cortext[cor1]{Corresponding author}");
      return out.join("\n");
    },

    springer(s) {
      const authors = displayedAuthors();
      const idx = buildAffilIndex(authors);
      const out = ["% LaTeX — Springer svjour3 author block"];
      const authorParts = authors.map((a, i) => {
        const sup = idx.authorIdx[i].join(",");
        return fullName(a) + (sup ? `\\inst{${sup}}` : "");
      });
      out.push(`\\author{${authorParts.join(" \\and ")}}`);
      const insts = idx.order.map(k => idx.byKey[k].text).join(" \\and ");
      out.push(`\\institute{${insts}}`);
      const corr = authors.find(a => a.corresponding);
      if (corr && corr.email) out.push(`% Corresponding author: ${corr.email}`);
      return out.join("\n");
    },

    ieee(s) {
      const authors = displayedAuthors();
      const idx = buildAffilIndex(authors);
      const out = ["% LaTeX — generic / IEEE author block"];
      const blocks = authors.map((a, i) => {
        const affils = idx.authorIdx[i]
          .map(n => idx.byKey[idx.order[n - 1]].text)
          .join(" \\\\ ");
        const email = a.email ? ` \\\\ \\textit{${a.email}}` : "";
        return `\\IEEEauthorblockN{${fullName(a)}}\n\\IEEEauthorblockA{${affils}${email}}`;
      });
      out.push(`\\author{\n${blocks.join("\n\\and\n")}\n}`);
      return out.join("\n");
    },

    quarto(s) {
      const authors = displayedAuthors();
      const idx = buildAffilIndex(authors);
      const lines = ["---"];
      if (s.title) lines.push(`title: "${s.title.replace(/"/g, '\\"')}"`);
      lines.push("author:");
      authors.forEach((a, i) => {
        lines.push(`  - name: ${fullName(a)}`);
        if (a.email) lines.push(`    email: ${a.email}`);
        if (norm(a.orcid)) lines.push(`    orcid: ${formatORCID(a.orcid)}`);
        if (a.corresponding) lines.push(`    corresponding: true`);
        if (a.equalContribution) lines.push(`    equal-contributor: true`);
        const refs = idx.authorIdx[i];
        if (refs.length) {
          lines.push(`    affiliations:`);
          refs.forEach(n => lines.push(`      - ref: aff${n}`));
        }
      });
      lines.push("affiliations:");
      idx.order.forEach((k, i) => {
        lines.push(`  - id: aff${i + 1}`);
        lines.push(`    name: ${idx.byKey[k].text}`);
      });
      lines.push("---");
      return lines.join("\n");
    },

    word(s) {
      const authors = displayedAuthors();
      const idx = buildAffilIndex(authors);
      const author = authors.map((a, i) => {
        const sup = [
          ...idx.authorIdx[i].map(String),
          ...(a.corresponding ? ["*"] : []),
          ...(a.equalContribution ? [a.equalSymbol || "†"] : []),
          ...(a.deceased ? ["§"] : [])
        ].join(",");
        return `${esc(fullName(a))}<sup>${esc(sup)}</sup>`;
      }).join(", ");
      const affils = idx.order.map((k, i) =>
        `<p style="margin:2px 0;"><sup>${i + 1}</sup> ${esc(idx.byKey[k].text)}</p>`
      ).join("\n");
      const corr = authors.filter(a => a.corresponding && a.email)
        .map(a => esc(a.email)).join(", ");
      const corrLine = corr ? `<p><sup>*</sup> Corresponding author: ${corr}</p>` : "";
      return `<div style="font-family:Georgia,serif;line-height:1.5;">
<p style="font-size:1.1em;">${author}</p>
${affils}
${corrLine}
</div>`;
    },

    bibtex(s) {
      const authors = displayedAuthors();
      const parts = authors.map(a => {
        const last = norm(a.lastName) || norm(fullName(a));
        const first = [norm(a.firstName), norm(a.middleName)].filter(Boolean).join(" ");
        return first ? `${last}, ${first}` : last;
      });
      return `author = {${parts.join(" and ")}}`;
    },

    "profiles-md"(s) {
      const authors = displayedAuthors();
      const lines = [
        "| Name | ORCID | Email | Profiles |",
        "|------|-------|-------|----------|"
      ];
      authors.forEach(a => {
        const profiles = [];
        if (a.scholar) profiles.push(`[Scholar](${a.scholar})`);
        if (a.researchgate) profiles.push(`[RG](${a.researchgate})`);
        if (a.github) profiles.push(`[GitHub](https://github.com/${a.github})`);
        if (a.bluesky) profiles.push(`[Bluesky](https://bsky.app/profile/${a.bluesky.replace(/^@/, "")})`);
        if (a.mastodon) profiles.push(`Mastodon: ${a.mastodon}`);
        if (a.twitter) profiles.push(`[X](https://x.com/${a.twitter.replace(/^@/, "")})`);
        if (a.linkedin) profiles.push(`[LinkedIn](${a.linkedin})`);
        if (a.website) profiles.push(`[Website](${a.website})`);
        if (a.osf) profiles.push(`[OSF](${a.osf})`);
        const orcid = norm(a.orcid) ? formatORCID(a.orcid) : "";
        lines.push(`| ${fullName(a)} | ${orcid} | ${a.email || ""} | ${profiles.join(", ")} |`);
      });
      return lines.join("\n");
    },

    /* ---------- Numbered-plain journals (general) ---------- */
    plos(s)            { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true,  separator: "; ", presentLine: true,  equalLine: true }); },
    cell(s)            { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", equalContribMark: "†", emailLine: true, separator: "; ", presentLine: true, equalLine: true, leadContactLine: true }); },
    pnas(s)            { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "letters", correspondingMark: "*", emailLine: true,  separator: ", ", presentLine: true,  equalLine: true }); },
    elife(s)           { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", equalContribMark: "†", emailLine: true, separator: "; ", presentLine: true, equalLine: true }); },
    mdpi(s)            { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true,  separator: "; ", presentLine: true,  equalLine: true, mdpiEmails: true }); },
    wiley(s)           { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true,  separator: ", ", presentLine: true,  equalLine: true }); },
    frontiers(s)       { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true,  separator: ", ", presentLine: true,  equalLine: true }); },
    "royal-society"(s) { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true,  separator: ", ", presentLine: true,  equalLine: true }); },
    "nature-comms"(s)  { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "✉",  equalContribMark: "†", emailLine: true, separator: ", ", presentLine: true,  equalLine: true }); },
    "nature-methods"(s){ return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "✉",  equalContribMark: "†", emailLine: true, separator: ", ", presentLine: true,  equalLine: true }); },
    agu(s)             { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true,  separator: ", ", presentLine: true,  equalLine: true }); },

    apa(s) {
      // APA: full first names retained, ORCID inline next to each author,
      // affiliations as numbered superscripts, and an "Author Note" block at
      // the end with corresponding-author contact + per-author affiliation.
      // (Approximation — the official APA "Author Note" varies by manuscript.)
      const authors = displayedAuthors();
      const idx = buildAffilIndex(authors);
      const lines = [];
      const authorLine = authors.map((a, i) => {
        const sup = [
          ...idx.authorIdx[i].map(toSuper),
          ...(a.corresponding ? ["*"] : []),
          ...(a.equalContribution ? [a.equalSymbol || "†"] : [])
        ].join(",");
        const orcid = norm(a.orcid) ? ` (ORCID: ${formatORCID(a.orcid)})` : "";
        return fullName(a) + (sup ? sup : "") + orcid;
      }).join(", ");
      lines.push(authorLine, "");
      idx.order.forEach((k, i) => lines.push(`${toSuper(i + 1)} ${idx.byKey[k].text}`));
      lines.push("", "Author Note");
      authors.forEach((a, i) => {
        const refs = idx.authorIdx[i].map(n => idx.byKey[idx.order[n - 1]].text).join("; ");
        const orcid = norm(a.orcid) ? ` ORCID: ${formatORCID(a.orcid)}.` : "";
        lines.push(`${fullName(a)}${refs ? " — " + refs : ""}.${orcid}`);
      });
      const corr = authors.filter(a => a.corresponding && a.email);
      if (corr.length) {
        lines.push("");
        lines.push("Correspondence concerning this article should be addressed to " +
          corr.map(a => `${fullName(a)}, ${a.email}`).join("; ") + ".");
      }
      return lines.join("\n");
    },

    vancouver(s) {
      // Vancouver style: Surname Initials, with numbered superscripts
      // referencing affiliations listed as a footnote block.
      // (We emit only the author list portion, not the full citation.)
      const authors = displayedAuthors();
      const idx = buildAffilIndex(authors);
      const lines = [];
      const authorLine = authors.map((a, i) => {
        const last = norm(a.lastName) || norm(fullName(a));
        const ini  = [norm(a.firstName), norm(a.middleName)]
          .filter(Boolean)
          .map(s => s.split(/\s+/).map(w => w[0] ? w[0].toUpperCase() : "").join(""))
          .join("");
        const sup = [
          ...idx.authorIdx[i].map(toSuper),
          ...(a.corresponding ? ["*"] : [])
        ].join(",");
        return `${last}${ini ? " " + ini : ""}${sup}`;
      }).join(", ");
      lines.push(authorLine + ".", "");
      idx.order.forEach((k, i) => lines.push(`${i + 1}. ${idx.byKey[k].text}.`));
      const corr = authors.filter(a => a.corresponding && a.email);
      if (corr.length) {
        lines.push("");
        lines.push("* Correspondence: " + corr.map(a => a.email).join("; ") + ".");
      }
      return lines.join("\n");
    },

    /* ---------- Ecology & Evolution ---------- */
    "ecology-letters"(s)   { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    bes(s)                 { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    esa(s)                 { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    "oikos-nordic"(s)      { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    evolution(s)           { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    "mol-ecol"(s)          { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    jeb(s)                 { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    "am-nat"(s)            { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    tree(s)                { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", equalContribMark: "†", emailLine: true, separator: "; ", presentLine: true, equalLine: true, leadContactLine: true }); },
    gcb(s)                 { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    conservation(s)        { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    "behav-ecol"(s)        { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    "heredity-genetics"(s) { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },
    "bmc-ecol-evol"(s)     { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: "; ", presentLine: true, equalLine: true }); },
    "annual-review"(s)     { return renderNumberedPlain(displayedAuthors(), s, { affiliationStyle: "numbers", correspondingMark: "*", emailLine: true, separator: ", ", presentLine: true, equalLine: true }); },

    /* ---------- Bibliographic / interchange ---------- */
    "csl-json"(s) {
      // CSL JSON (https://citationstyles.org/) — array of author objects
      // with family/given/affiliation. Compatible with Zotero, Mendeley,
      // Pandoc, and most reference managers.
      const authors = displayedAuthors();
      const arr = authors.map(a => {
        const obj = {
          family: norm(a.lastName),
          given:  [norm(a.firstName), norm(a.middleName)].filter(Boolean).join(" ")
        };
        if (norm(a.orcid)) obj.ORCID = `https://orcid.org/${formatORCID(a.orcid)}`;
        const aff = (a.affiliations || [])
          .map(affilText)
          .filter(Boolean)
          .map(t => ({ name: t }));
        if (aff.length) obj.affiliation = aff;
        return obj;
      });
      return JSON.stringify(arr, null, 2);
    },

    "endnote-xml"(s) {
      // EndNote XML export (subset). EndNote/Zotero ingest the
      // <records>/<record>/<contributors>/<authors>/<author> structure.
      const authors = displayedAuthors();
      const xmlEsc = v => String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<xml>",
        "  <records>",
        "    <record>"
      ];
      if (s && s.title) lines.push(`      <titles><title>${xmlEsc(s.title)}</title></titles>`);
      lines.push("      <contributors>", "        <authors>");
      authors.forEach(a => {
        const last  = norm(a.lastName) || norm(fullName(a));
        const first = [norm(a.firstName), norm(a.middleName)].filter(Boolean).join(" ");
        const txt   = first ? `${last}, ${first}` : last;
        lines.push(`          <author>${xmlEsc(txt)}</author>`);
      });
      lines.push("        </authors>", "      </contributors>");
      const affs = [];
      authors.forEach(a => (a.affiliations || []).forEach(af => {
        const t = affilText(af); if (t) affs.push(t);
      }));
      if (affs.length) {
        const uniq = Array.from(new Set(affs));
        lines.push(`      <auth-address>${xmlEsc(uniq.join("; "))}</auth-address>`);
      }
      lines.push("    </record>", "  </records>", "</xml>");
      return lines.join("\n");
    },

    credit(s) {
      const authors = displayedAuthors();
      const lines = [];
      authors.forEach(a => {
        const name = fullName(a) || "(unnamed author)";
        const roles = CREDIT_ROLES
          .filter(r => a.credit && a.credit[r.key])
          .map(r => r.label);
        if (roles.length) lines.push(`${name}: ${roles.join("; ")}.`);
      });
      if (!lines.length) return "(No CRediT roles assigned. Tick roles in each author card.)";
      return `**Author contributions (CRediT)**\n\n${lines.join("\n\n")}`;
    }
  };

  /* ============================================================ *
   * 7b. Shared renderer for numbered-plain journal styles         *
   * ============================================================ *
   * Most journal-specific plain-text formats follow the same
   * shape: an author line with superscripted affiliation indices
   * + optional corresponding/equal/deceased marks, then a numbered
   * (or lettered) affiliation block, then optional footnote lines
   * for corresponding email, equal contribution, deceased, and
   * present-address overrides.
   *
   * Options:
   *   affiliationStyle  : "numbers" | "letters"   (default "numbers")
   *   correspondingMark : symbol marking corresponding author (default "*")
   *   equalContribMark  : fallback for equalContribution (default uses author.equalSymbol || "†")
   *   separator         : separator between authors (default ", ")
   *   emailLine         : whether to print the corresponding-email footer
   *   presentLine       : whether to print "Present address" lines
   *   equalLine         : whether to print the "contributed equally" footer
   *   leadContactLine   : also print a "Lead contact" line for Cell-style journals
   *   mdpiEmails        : MDPI "Correspondence: a@x.com; b@y.com" style
   */
  function renderNumberedPlain(authors, project, opts) {
    opts = opts || {};
    const style   = opts.affiliationStyle === "letters" ? toLetter : toSuper;
    const corrMrk = opts.correspondingMark || "*";
    const sep     = opts.separator || ", ";
    const idx = buildAffilIndex(authors);
    const lines = [];
    const authorLine = authors.map((a, i) => {
      const sup = [
        ...idx.authorIdx[i].map(style),
        ...(a.corresponding ? [corrMrk] : []),
        ...(a.equalContribution ? [opts.equalContribMark || a.equalSymbol || "†"] : []),
        ...(a.deceased ? ["§"] : [])
      ].join(",");
      return fullName(a) + (sup ? sup : "");
    }).join(sep);
    lines.push(authorLine, "");
    idx.order.forEach((k, i) => lines.push(`${style(i + 1)} ${idx.byKey[k].text}`));

    const corr = authors.filter(a => a.corresponding && a.email);
    if (opts.emailLine && corr.length) {
      lines.push("");
      if (opts.mdpiEmails) {
        lines.push("Correspondence: " + corr.map(a => a.email).join("; "));
      } else {
        lines.push(`${corrMrk} Corresponding author` + (corr.length > 1 ? "s" : "") +
          ": " + corr.map(a => a.email).join(", "));
      }
    }
    if (opts.leadContactLine && corr.length) {
      lines.push(`Lead contact: ${corr[0].email}`);
    }
    if (opts.equalLine) {
      const eq = authors.filter(a => a.equalContribution);
      if (eq.length) {
        const sym = opts.equalContribMark || eq[0].equalSymbol || "†";
        lines.push(`${sym} These authors contributed equally to this work.`);
      }
    }
    const dec = authors.filter(a => a.deceased);
    if (dec.length) lines.push("§ Deceased.");
    if (opts.presentLine) {
      authors.filter(a => norm(a.presentAddress))
        .forEach(a => lines.push(`Present address (${fullName(a)}): ${norm(a.presentAddress)}`));
    }
    return lines.join("\n");
  }

  /* ============================================================ *
   * 8. DOM helpers                                                *
   * ============================================================ */

  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  let listEl, emptyEl, previewEl, richEl, formatSel, sortSel, seniorChk, sortNote, pendingListEl, pendingEmptyEl;

  /* Build one author card. `opts.readOnlyOrder` disables the drag handle.
   * `opts.targetList` lets the invite-mode build into a separate list. */
  function buildAuthorCard(author, opts) {
    opts = opts || {};
    const tpl = document.getElementById("author-template");
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = author.id;
    if (opts.readOnlyOrder) node.classList.add("auto-sorted");

    node.querySelectorAll("[data-f]").forEach(el => {
      const f = el.dataset.f;
      if (el.type === "checkbox") {
        el.checked = !!author[f];
      } else {
        el.value = author[f] == null ? "" : author[f];
      }
      el.addEventListener("input", () => {
        if (el.type === "checkbox") {
          author[f] = el.checked;
          if (f === "equalContribution") {
            node.querySelector("[data-equal-symbol-wrap]").hidden = !el.checked;
          }
        } else {
          author[f] = el.value;
        }
        if (f === "email")  validateEmailField(el, node);
        if (f === "orcid")  validateOrcidField(el, node);
        if (["firstName", "middleName", "lastName"].includes(f)) updateAuthorSummary(node, author);
        if (opts.onChange) opts.onChange();
        scheduleSave();
        if (!opts.invite) renderOutput();
        if (!opts.invite && (f === "lastName" || f === "firstName" || f === "senior" || f === "equalContribution" || f === "equalSymbol")) {
          // re-render list to reflect new sort order
          renderAuthors();
        }
      });
    });

    node.querySelector("[data-equal-symbol-wrap]").hidden = !author.equalContribution;

    // Affiliations
    const affilList = node.querySelector("[data-affil-list]");
    function renderAffils() {
      affilList.innerHTML = "";
      author.affiliations.forEach((af, ai) => {
        affilList.appendChild(buildAffilRow(author, af, ai, renderAffils, opts));
      });
    }
    renderAffils();
    node.querySelector(".btn-add-affil").addEventListener("click", () => {
      author.affiliations.push({ department: "", institution: "", city: "", country: "" });
      renderAffils();
      scheduleSave(); if (!opts.invite) renderOutput();
    });

    validateEmailField(node.querySelector('[data-f="email"]'), node);
    validateOrcidField(node.querySelector('[data-f="orcid"]'), node);
    updateAuthorSummary(node, author);

    node.querySelector(".collapse-toggle").addEventListener("click", e => {
      const collapsed = node.classList.toggle("collapsed");
      e.currentTarget.setAttribute("aria-expanded", String(!collapsed));
    });

    // Hide actions in invite mode (single author, no remove/export)
    if (opts.invite) {
      node.querySelectorAll(".btn-remove-author, .btn-export-author").forEach(b => b.remove());
    } else {
      node.querySelector(".btn-remove-author").addEventListener("click", () => {
        if (confirm(`Remove ${fullName(author) || "this author"}?`)) {
          state.authors = state.authors.filter(x => x.id !== author.id);
          renderAuthors(); scheduleSave(); renderOutput();
        }
      });
      node.querySelector(".btn-export-author").addEventListener("click", () => {
        downloadJSON(authorFilename(author), author);
      });
    }

    if (!opts.invite && state.sortMode === "manual") {
      setupDragAndDrop(node, author);
    } else if (!opts.invite) {
      node.querySelector(".drag-handle").title = "Switch sort mode to Manual to drag";
    }

    // CRediT roles checkboxes
    const creditGrid = node.querySelector("[data-credit-grid]");
    if (creditGrid) {
      creditGrid.innerHTML = CREDIT_ROLES.map(r =>
        `<label class="credit-cb"><input type="checkbox" data-credit="${r.key}" /><span>${r.label}</span></label>`
      ).join("");
      creditGrid.querySelectorAll("input[data-credit]").forEach(cb => {
        const k = cb.dataset.credit;
        cb.checked = !!(author.credit && author.credit[k]);
        cb.addEventListener("change", () => {
          if (!author.credit) author.credit = {};
          author.credit[k] = cb.checked;
          scheduleSave();
          if (!opts.invite) renderOutput();
        });
      });
    }

    return node;
  }

  function buildAffilRow(author, af, ai, rerender, opts) {
    const tpl = document.getElementById("affil-template");
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelectorAll("[data-af]").forEach(el => {
      const k = el.dataset.af;
      el.value = af[k] || "";
      el.addEventListener("input", () => {
        af[k] = el.value;
        scheduleSave(); if (!opts || !opts.invite) renderOutput();
      });
    });
    node.querySelector(".btn-remove-affil").addEventListener("click", () => {
      author.affiliations.splice(ai, 1);
      if (author.affiliations.length === 0) {
        author.affiliations.push({ department: "", institution: "", city: "", country: "" });
      }
      rerender(); scheduleSave(); if (!opts || !opts.invite) renderOutput();
    });
    return node;
  }

  function updateAuthorSummary(card, a) {
    const name = fullName(a) || "(unnamed author)";
    const flags = [
      a.corresponding ? "✉ corresponding" : null,
      a.equalContribution ? `${a.equalSymbol || "†"} equal contribution` : null,
      a.senior ? "★ senior" : null,
      a.deceased ? "§ deceased" : null
    ].filter(Boolean).join(" · ");
    card.querySelector(".author-summary").textContent = flags ? `${name} — ${flags}` : name;
  }

  function validateEmailField(input, card) {
    const msg = card.querySelector('[data-msg="email"]');
    const v = validEmail(input.value);
    msg.className = "field-msg " + (v === null ? "" : v ? "ok" : "err");
    msg.textContent = v === null ? "" : v ? "✓ valid email" : "✗ invalid email";
  }
  function validateOrcidField(input, card) {
    const msg = card.querySelector('[data-msg="orcid"]');
    const v = validORCID(input.value);
    msg.className = "field-msg " + (v === null ? "" : v ? "ok" : "err");
    msg.textContent = v === null ? "" : v ? "✓ valid ORCID" : "✗ invalid ORCID checksum";
  }

  /* ------------------------------------------------------------ *
   * 8b. Drag-and-drop                                             *
   * ------------------------------------------------------------ */

  let dragSourceId = null;
  function setupDragAndDrop(card, author) {
    const handle = card.querySelector(".drag-handle");
    handle.addEventListener("dragstart", e => {
      dragSourceId = author.id;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", author.id);
    });
    handle.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      $$(".author-card").forEach(c => c.classList.remove("drag-over"));
      dragSourceId = null;
    });
    card.addEventListener("dragover", e => {
      if (!dragSourceId || dragSourceId === author.id) return;
      e.preventDefault();
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", e => {
      e.preventDefault();
      card.classList.remove("drag-over");
      if (!dragSourceId || dragSourceId === author.id) return;
      const from = state.authors.findIndex(x => x.id === dragSourceId);
      const to   = state.authors.findIndex(x => x.id === author.id);
      if (from < 0 || to < 0) return;
      const [moved] = state.authors.splice(from, 1);
      state.authors.splice(to, 0, moved);
      renderAuthors(); scheduleSave(); renderOutput();
    });
  }

  /* ============================================================ *
   * 9. List & output rendering                                    *
   * ============================================================ */

  function renderAuthors() {
    listEl.innerHTML = "";
    const ordered = displayedAuthors();
    const readOnlyOrder = state.sortMode !== "manual";
    ordered.forEach(a => listEl.appendChild(buildAuthorCard(a, { readOnlyOrder })));
    emptyEl.hidden = state.authors.length > 0;

    // Sort note
    let note = "";
    if (state.sortMode === "alpha") {
      note = "Alphabetical by last name (equal-contribution groups stay together).";
    }
    sortNote.textContent = note;
  }

  function renderOutput() {
    state.format = formatSel.value;
    const fn = renderers[state.format] || renderers.nature;
    const text = fn(state);
    if (state.format === "word") {
      richEl.hidden = false; previewEl.hidden = true; richEl.innerHTML = text;
    } else {
      richEl.hidden = true; previewEl.hidden = false; previewEl.textContent = text;
    }
  }

  /* ============================================================ *
   * 10. Pending entries (review queue)                            *
   * ============================================================ */

  function renderPending() {
    pendingListEl.innerHTML = "";
    const list = state.pending || [];
    pendingEmptyEl.hidden = list.length > 0;
    list.forEach((entry, idx) => pendingListEl.appendChild(buildPendingCard(entry, idx)));
  }

  function buildPendingCard(entry, idx) {
    const tpl = document.getElementById("pending-template");
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector(".pending-name").textContent = fullName(entry) || "(unnamed)";
    const flags = [];
    if (entry.corresponding) flags.push("corresponding");
    if (entry.equalContribution) flags.push("equal contribution");
    if (entry.senior) flags.push("senior");
    if (entry.deceased) flags.push("deceased");
    node.querySelector(".pending-flags").textContent = flags.join(" · ");
    const body = node.querySelector(".pending-body");
    const orcid = entry.orcid ? formatORCID(entry.orcid) : "—";
    const aff = (entry.affiliations || []).map(affilText).filter(Boolean).join(" / ") || "—";
    body.innerHTML = `<dl>
      <dt>Email</dt><dd>${esc(entry.email || "—")}</dd>
      <dt>ORCID</dt><dd>${esc(orcid)}</dd>
      <dt>Affiliations</dt><dd>${esc(aff)}</dd>
    </dl>`;

    // Existing-match warning (by ORCID/email)
    const match = findMatch(entry);
    if (match) {
      const warn = document.createElement("div");
      warn.style.fontSize = "12px"; warn.style.color = "#8a4a00"; warn.style.marginBottom = "6px";
      warn.textContent = `⚠ Existing entry found for ${fullName(match) || match.email || match.orcid}. Approving will replace it.`;
      body.prepend(warn);
    }

    node.querySelector(".btn-pending-approve").addEventListener("click", () => approvePending(idx));
    node.querySelector(".btn-pending-reject").addEventListener("click", () => rejectPending(idx));
    node.querySelector(".btn-pending-edit").addEventListener("click", () => editPending(idx));
    return node;
  }

  /** Find an existing author that matches the incoming entry by ORCID or email. */
  function findMatch(incoming) {
    const orcid = norm(incoming.orcid).toLowerCase();
    const email = norm(incoming.email).toLowerCase();
    return state.authors.find(a =>
      (orcid && norm(a.orcid).toLowerCase() === orcid) ||
      (email && norm(a.email).toLowerCase() === email)
    );
  }

  function approvePending(idx) {
    const entry = state.pending[idx];
    if (!entry) return;
    const incoming = Object.assign(emptyAuthor(), entry);
    incoming.id = uid();
    const match = findMatch(entry);
    if (match) {
      const replace = confirm(`Replace existing entry for ${fullName(match)}?\n\nClick OK to replace, Cancel to add as a new author.`);
      if (replace) {
        const i = state.authors.findIndex(a => a.id === match.id);
        const keepId = match.id;
        state.authors[i] = Object.assign(incoming, { id: keepId });
      } else {
        state.authors.push(incoming);
      }
    } else {
      state.authors.push(incoming);
    }
    state.pending.splice(idx, 1);
    renderAuthors(); renderPending(); scheduleSave(); renderOutput();
  }

  function rejectPending(idx) {
    if (!confirm("Reject and discard this entry?")) return;
    state.pending.splice(idx, 1);
    renderPending(); scheduleSave();
  }

  function editPending(idx) {
    // Promote to authors list; user can then edit normally.
    const entry = state.pending[idx];
    if (!entry) return;
    const incoming = Object.assign(emptyAuthor(), entry, { id: uid() });
    state.authors.push(incoming);
    state.pending.splice(idx, 1);
    renderAuthors(); renderPending(); scheduleSave(); renderOutput();
    // Scroll to it
    const el = document.querySelector(`[data-id="${incoming.id}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ============================================================ *
   * 11. Import/export                                             *
   * ============================================================ */

  function downloadJSON(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    triggerDownload(blob, name);
  }
  function downloadText(name, text, mime = "text/plain") {
    triggerDownload(new Blob([text], { type: mime }), name);
  }
  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }
  function authorFilename(a) {
    const slug = (fullName(a) || "author").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `${slug || "author"}.json`;
  }
  function projectFilename() {
    const slug = (state.title || "paper-authors").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `${slug || "paper-authors"}.json`;
  }

  function toCSV(s) {
    const headers = ["firstName","middleName","lastName","email","orcid",
      "affiliations","presentAddress","corresponding","equalContribution",
      "equalSymbol","senior","deceased",
      "scholar","researchgate","github","bluesky","mastodon",
      "twitter","linkedin","website","osf"];
    const rows = [headers.join(",")];
    displayedAuthors().forEach(a => {
      const aff = (a.affiliations || []).map(affilText).filter(Boolean).join(" | ");
      const row = headers.map(h => {
        let v;
        if (h === "affiliations") v = aff;
        else v = a[h];
        return csvCell(v);
      });
      rows.push(row.join(","));
    });
    return rows.join("\n");
  }
  function csvCell(v) {
    if (v === undefined || v === null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  /**
   * Extract a JSON entry from a possibly-noisy string. If BEGIN/END markers
   * are present, take the text between them. Otherwise try to find a top-level
   * JSON object anywhere in the string. Returns parsed object or throws.
   */
  function extractEntry(raw) {
    const begin = raw.indexOf(MARK_BEGIN);
    const end   = raw.indexOf(MARK_END, begin + MARK_BEGIN.length);
    let payload;
    if (begin >= 0 && end > begin) {
      payload = raw.substring(begin + MARK_BEGIN.length, end);
    } else {
      // Try to find the first { … } that parses cleanly.
      const open = raw.indexOf("{");
      const close = raw.lastIndexOf("}");
      if (open < 0 || close <= open) throw new Error("No JSON found");
      payload = raw.substring(open, close + 1);
    }
    // Clean common email-quote prefixes (>) and stray whitespace.
    payload = payload.split("\n").map(l => l.replace(/^\s*>\s?/, "")).join("\n");
    return JSON.parse(payload);
  }

  /* ============================================================ *
   * 12. Invite mode                                               *
   * ============================================================ */

  /** Read ?invite=… from the URL; return decoded context object or null. */
  function readInvite() {
    const params = new URLSearchParams(location.search);
    const b64 = params.get("invite");
    if (!b64) return null;
    try { return JSON.parse(b64decode(b64)); }
    catch (e) { console.warn("ordenaR: bad invite token"); return null; }
  }

  /** Build the invitation link for the current project. */
  function buildInviteLink() {
    const corr = state.authors.find(a => a.corresponding);
    if (!corr || !corr.email) {
      alert("Please set a corresponding author with a valid email first.");
      return null;
    }
    if (!norm(state.title)) {
      if (!confirm("The project has no title. Continue anyway?")) return null;
    }
    const ctx = {
      mode: "invite",
      title: state.title || "",
      correspondingEmail: corr.email,
      correspondingName: fullName(corr),
      roster: state.authors.map(a => fullName(a) || "(unnamed)").filter(Boolean)
    };
    const token = b64encode(JSON.stringify(ctx));
    const url = location.origin + location.pathname + "?invite=" + token;
    return url;
  }

  /** Build the email body that the coauthor will send back. */
  function buildEntryEmail(ctx, author) {
    const intro = `Hi${ctx.correspondingName ? " " + ctx.correspondingName.split(" ")[0] : ""},

My author entry for "${ctx.title || "this project"}" is below. Please paste it into ordenaR.

${MARK_BEGIN}
${JSON.stringify(author, null, 2)}
${MARK_END}

Thanks!
${fullName(author)}`;
    return intro;
  }

  /** Initialize the invite-mode UI. */
  function initInviteMode(ctx) {
    document.getElementById("normal-view").hidden = true;
    document.getElementById("invite-view").hidden = false;

    document.getElementById("invite-project-title").textContent = ctx.title || "(untitled project)";
    document.getElementById("invite-roster").textContent = (ctx.roster || []).filter(Boolean).join(", ") || "(no other authors yet)";
    document.getElementById("invite-corr-email").textContent = ctx.correspondingEmail;

    // The coauthor's draft entry. Persist locally so they don't lose data on refresh.
    const inviteKey = "ordenaR:invite:" + b64encode(ctx.title + "|" + ctx.correspondingEmail).slice(0, 24);
    let author = emptyAuthor();
    try {
      const raw = localStorage.getItem(inviteKey);
      if (raw) author = Object.assign(author, JSON.parse(raw));
    } catch (e) {}

    const inviteList = document.getElementById("invite-author-list");
    inviteList.innerHTML = "";
    inviteList.appendChild(buildAuthorCard(author, {
      invite: true,
      onChange: () => { try { localStorage.setItem(inviteKey, JSON.stringify(author)); } catch (e) {} }
    }));

    // Send button: open mailto with the body.
    function buildBody() { return buildEntryEmail(ctx, author); }
    function buildMailto() {
      const subject = `[ordenaR] Author entry from ${fullName(author) || "(unnamed)"} for ${ctx.title || "project"}`;
      const body = buildBody();
      return `mailto:${encodeURIComponent(ctx.correspondingEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }
    document.getElementById("btn-invite-send").addEventListener("click", () => {
      try { localStorage.setItem(inviteKey, JSON.stringify(author)); } catch (e) {}
      window.location.href = buildMailto();
      // Reveal fallback after ~600ms in case mailto didn't open.
      setTimeout(() => {
        const det = document.querySelector(".invite-fallback");
        if (det) det.open = true;
        document.getElementById("invite-fallback-text").value = buildBody();
      }, 600);
    });
    document.getElementById("btn-invite-download").addEventListener("click", () => {
      downloadJSON(authorFilename(author), author);
    });
    document.querySelector(".invite-fallback").addEventListener("toggle", (e) => {
      if (e.target.open) document.getElementById("invite-fallback-text").value = buildBody();
    });
    document.getElementById("btn-invite-copy").addEventListener("click", async () => {
      const text = buildBody();
      document.getElementById("invite-fallback-text").value = text;
      try { await navigator.clipboard.writeText(text); flashButton(document.getElementById("btn-invite-copy"), "Copied!"); }
      catch (e) {
        const ta = document.getElementById("invite-fallback-text");
        ta.select(); document.execCommand("copy");
      }
    });
  }

  /* ============================================================ *
   * 13. Wiring (init)                                             *
   * ============================================================ */

  let saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 250); }

  function flashButton(btn, text) {
    const orig = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = orig; }, 1200);
  }

  function init() {
    // Invite mode short-circuit
    const inviteCtx = readInvite();
    if (inviteCtx && inviteCtx.mode === "invite") { initInviteMode(inviteCtx); return; }

    listEl    = $("#authors-list");
    emptyEl   = $("#empty-state");
    previewEl = $("#output-preview");
    richEl    = $("#output-rich");
    formatSel = $("#format-select");
    sortSel   = $("#sort-mode");
    seniorChk = $("#keep-senior-end");
    sortNote  = $("#sort-note");
    pendingListEl   = $("#pending-list");
    pendingEmptyEl  = $("#pending-empty");

    const loaded = loadState();
    if (!loaded || !state.authors || state.authors.length === 0) {
      state.authors = [emptyAuthor()];
    }
    state.pending = state.pending || [];

    // Project title
    const titleInput = $("#project-title");
    titleInput.value = state.title || "";
    titleInput.addEventListener("input", () => { state.title = titleInput.value; scheduleSave(); renderOutput(); });

    // Format selector
    formatSel.value = state.format || "nature";
    formatSel.addEventListener("change", renderOutput);

    // Sort controls
    sortSel.value = state.sortMode || "manual";
    seniorChk.checked = !!state.keepSeniorEnd;
    sortSel.addEventListener("change", () => {
      state.sortMode = sortSel.value;
      // When switching back to manual, freeze current displayed order
      // as the new manual order so users don't lose their auto-sort.
      if (state.sortMode === "manual") {
        state.authors = displayedAuthors();
      }
      renderAuthors(); scheduleSave(); renderOutput();
    });
    seniorChk.addEventListener("change", () => {
      state.keepSeniorEnd = seniorChk.checked;
      renderAuthors(); scheduleSave(); renderOutput();
    });

    // Top buttons
    $("#btn-add-author").addEventListener("click", () => {
      state.authors.push(emptyAuthor());
      renderAuthors(); scheduleSave(); renderOutput();
    });
    $("#btn-reset").addEventListener("click", () => {
      if (!confirm("Clear all authors, pending entries, and reset the project? This cannot be undone.")) return;
      state.title = ""; state.authors = [emptyAuthor()]; state.format = "nature";
      state.sortMode = "manual"; state.keepSeniorEnd = false; state.pending = [];
      $("#project-title").value = ""; formatSel.value = "nature"; sortSel.value = "manual"; seniorChk.checked = false;
      renderAuthors(); renderPending(); scheduleSave(); renderOutput();
    });

    // Backup buttons
    $("#btn-export-project").addEventListener("click", () => downloadJSON(projectFilename(), state));
    $("#btn-import-project").addEventListener("click", () => $("#file-import-project").click());
    $("#file-import-project").addEventListener("change", e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          if (obj && Array.isArray(obj.authors)) {
            state.title = obj.title || state.title;
            state.authors = obj.authors.map(a => Object.assign(emptyAuthor(), a, { id: uid() }));
            if (obj.format) state.format = obj.format;
            if (obj.sortMode) state.sortMode = obj.sortMode;
            if (typeof obj.keepSeniorEnd === "boolean") state.keepSeniorEnd = obj.keepSeniorEnd;
            state.pending = (obj.pending || []).map(p => Object.assign(emptyAuthor(), p, { id: uid() }));
            $("#project-title").value = state.title || "";
            formatSel.value = state.format || "nature";
            sortSel.value = state.sortMode || "manual";
            seniorChk.checked = !!state.keepSeniorEnd;
          } else {
            alert("This file doesn't look like a full project. Use 'Paste from email' or 'Upload JSON file' under Coauthor entries to import a single author.");
            return;
          }
          renderAuthors(); renderPending(); scheduleSave(); renderOutput();
        } catch (err) { alert("Could not parse JSON: " + err.message); }
        e.target.value = "";
      };
      reader.readAsText(file);
    });
    $("#btn-export-csv").addEventListener("click", () => {
      const slug = projectFilename().replace(/\.json$/, ".csv");
      downloadText(slug, toCSV(state), "text/csv");
    });

    // Coauthor entries panel
    $("#btn-paste-entry").addEventListener("click", () => {
      const w = $("#paste-area-wrap"); w.hidden = !w.hidden;
      if (!w.hidden) $("#paste-area").focus();
    });
    $("#btn-paste-cancel").addEventListener("click", () => { $("#paste-area-wrap").hidden = true; $("#paste-area").value = ""; });
    $("#btn-paste-confirm").addEventListener("click", () => {
      const raw = $("#paste-area").value;
      try {
        const entry = extractEntry(raw);
        state.pending.push(Object.assign(emptyAuthor(), entry, { id: uid() }));
        $("#paste-area-wrap").hidden = true; $("#paste-area").value = "";
        renderPending(); scheduleSave();
      } catch (err) { alert("Could not detect a JSON entry. " + err.message); }
    });
    $("#btn-upload-entry").addEventListener("click", () => $("#file-import-author").click());
    $("#file-import-author").addEventListener("change", e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const entry = extractEntry(reader.result);
          state.pending.push(Object.assign(emptyAuthor(), entry, { id: uid() }));
          renderPending(); scheduleSave();
        } catch (err) { alert("Could not parse: " + err.message); }
        e.target.value = "";
      };
      reader.readAsText(file);
    });

    // Invite link generation
    $("#btn-generate-invite").addEventListener("click", () => {
      const url = buildInviteLink();
      if (!url) return;
      $("#invite-link-out").value = url;
      $("#invite-link-result").hidden = false;
    });
    $("#btn-copy-invite").addEventListener("click", async () => {
      const url = $("#invite-link-out").value;
      try { await navigator.clipboard.writeText(url); flashButton($("#btn-copy-invite"), "Copied!"); }
      catch (e) { $("#invite-link-out").select(); document.execCommand("copy"); }
    });
    $("#btn-mail-invite").addEventListener("click", () => {
      const url = $("#invite-link-out").value;
      if (!url) return;
      const corr = state.authors.find(a => a.corresponding);
      const subject = `[ordenaR] Coauthor entry for "${state.title || "our paper"}"`;
      const body = `Hi,

Please open the link below and add your author details for "${state.title || "our project"}". When you're done, click "Send to corresponding author" to email me back your entry.

${url}

This tool runs entirely in your browser — no account needed.

Thanks!
${corr ? fullName(corr) : ""}`;
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });

    // Output buttons
    $("#btn-copy-output").addEventListener("click", async () => {
      const text = state.format === "word" ? richEl.innerHTML : previewEl.textContent;
      try { await navigator.clipboard.writeText(text); flashButton($("#btn-copy-output"), "Copied!"); }
      catch (e) { prompt("Copy:", text); }
    });
    $("#btn-download-output").addEventListener("click", () => {
      const fmt = window.ORDENAR_FORMATS.find(f => f.id === state.format) ||
                  { id: state.format, ext: "txt" };
      const slug = (state.title || "authors").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "authors";
      const name = `${slug}.${fmt.ext}`;
      const text = state.format === "word" ? richEl.innerHTML : previewEl.textContent;
      const mime = state.format === "word" ? "text/html" : "text/plain";
      downloadText(name, text, mime);
    });


    renderAuthors();
    renderPending();
    renderOutput();

    // New feature init calls
    initSpreadsheetImport();
    initDocxExport();
  }

  // Note: the second DOMContentLoaded listener below is removed—
  // a single init() call at the bottom of the IIFE handles startup.

  /* ============================================================ *
   * 14. Spreadsheet import (SheetJS)                             *
   * ============================================================ *
   *
   * Workflow:
   *   1. User clicks "📥 Import from spreadsheet" → file picker opens.
   *   2. File is read as ArrayBuffer and parsed with SheetJS.
   *   3. Column headers are fuzzy-matched to ordenaR fields.
   *   4. A "column mapping" modal lets users confirm / adjust.
   *   5. On confirm, each row becomes an emptyAuthor() object.
   *   6. User chooses append vs. replace; authors are rendered.
   *
   * ordenaR field tokens and their aliases:
   *   firstName     : first, firstname, given, given name, given names
   *   middleName    : middle, middle name, middle names
   *   lastName      : last, surname, family, family name, last name
   *   email         : email, e-mail, email address, emailaddress
   *   orcid         : orcid, orcid id, orcid iD, orcid identifier
   *   institution   : affiliation, primary affiliation, institution
   *   department    : school, department, organisation, organization, details
   *   corresponding : corresponding, corresponding author
   *   twitter       : twitter, x handle, twitter handle, twitter handles
   *   bluesky       : bluesky, bsky, bluesky handle, bluesky handles
   *   order         : order, authorship_order, authorship order, position
   *   includeFlag   : wants, include, wants to be listed
   */

  /** Canonical field definitions for fuzzy column matching. */
  const FIELD_DEFS = [
    { field: "firstName",    label: "First name",    tokens: ["first","firstname","givenname","givennames","given"] },
    { field: "middleName",   label: "Middle name",   tokens: ["middle","middlename","middlenames"] },
    { field: "lastName",     label: "Last name",     tokens: ["last","lastname","surname","family","familyname"] },
    { field: "email",        label: "Email",         tokens: ["email","emailaddress","email address","e-mail","e mail"] },
    { field: "orcid",        label: "ORCID",         tokens: ["orcid","orcidid","orcid id","orcididentifier","orcid identifier"] },
    { field: "institution",  label: "Institution (affiliation)", tokens: ["institution","affiliation","primaryaffiliation","primary affiliation","university","organization","organisation"] },
    { field: "department",   label: "Department",    tokens: ["department","school","dept","school/department/organisation details","organisation details","organization details"] },
    { field: "corresponding",label: "Corresponding author?", tokens: ["corresponding","correspondingauthor","corresponding author"] },
    { field: "twitter",      label: "Twitter/X",     tokens: ["twitter","twitterhandle","twitter handles","xhandle","x handle","x/twitter"] },
    { field: "bluesky",      label: "Bluesky",       tokens: ["bluesky","bsky","bskyhandle","bluesky handle","bluesky handles"] },
    { field: "_order",       label: "Authorship order", tokens: ["order","authorship_order","authorship order","authorshiporder","position","rank"] },
    { field: "_include",     label: "Include as author?", tokens: ["wants","include","wants to be listed","wants to be listed as a co-author","wantstobelisted","coauthor","isauthor"] },
    // CRediT roles
    { field: "credit:conceptualization",     label: "CRediT — Conceptualization",       tokens: ["conceptualization","conceptualisation","concept"] },
    { field: "credit:dataCuration",          label: "CRediT — Data curation",           tokens: ["data curation","datacuration","data-curation","data collection"] },
    { field: "credit:formalAnalysis",        label: "CRediT — Formal analysis",         tokens: ["formal analysis","formal_analysis","formalanalysis","formal analy"] },
    { field: "credit:fundingAcquisition",    label: "CRediT — Funding acquisition",     tokens: ["funding acquisition","fundingacquisition","funding"] },
    { field: "credit:investigation",         label: "CRediT — Investigation",           tokens: ["investigation"] },
    { field: "credit:methodology",           label: "CRediT — Methodology",            tokens: ["methodology","methods"] },
    { field: "credit:projectAdministration", label: "CRediT — Project administration",  tokens: ["project administration","project admin","projectadministration","administration"] },
    { field: "credit:resources",             label: "CRediT — Resources",              tokens: ["resources"] },
    { field: "credit:software",              label: "CRediT — Software",              tokens: ["software"] },
    { field: "credit:supervision",           label: "CRediT — Supervision",           tokens: ["supervision","supervisor"] },
    { field: "credit:validation",            label: "CRediT — Validation",            tokens: ["validation"] },
    { field: "credit:visualization",         label: "CRediT — Visualization",         tokens: ["visualization","visualisation"] },
    { field: "credit:writingOriginalDraft",  label: "CRediT — Writing — original draft", tokens: ["writing original draft","writing-original","original draft","writing original draft preparation","original draft preparation"] },
    { field: "credit:writingReviewEditing",  label: "CRediT — Writing — review & editing", tokens: ["writing review editing","review editing","writing review","review and editing","editing","writing review   editing"] }
  ];

  /**
   * Normalise a column header for fuzzy matching:
   * lowercase, strip non-alphanumeric (except spaces), collapse whitespace.
   */
  function normHeader(s) {
    return String(s || "").toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Fuzzy-match one column header to an ordenaR field.
   * Returns the field name string, or null if no match found.
   */
  function detectField(header) {
    const h = normHeader(header);
    if (!h) return null;
    // Try exact full-string token match first
    for (const def of FIELD_DEFS) {
      for (const tok of def.tokens) {
        if (h === tok) return def.field;
      }
    }
    // Then try starts-with
    for (const def of FIELD_DEFS) {
      for (const tok of def.tokens) {
        if (h.startsWith(tok) || tok.startsWith(h)) return def.field;
      }
    }
    // Then try substring contain
    for (const def of FIELD_DEFS) {
      for (const tok of def.tokens) {
        if (h.includes(tok) || tok.includes(h)) return def.field;
      }
    }
    return null;
  }

  /**
   * Parse a boolean-ish value from a spreadsheet cell.
   * TRUE/yes/1/y/x/✓ → true; anything else (including empty) → false.
   */
  function parseBool(v) {
    if (v === true || v === 1) return true;
    const s = String(v || "").trim().toLowerCase();
    return s === "yes" || s === "true" || s === "1" || s === "y" || s === "x" || s === "✓";
  }

  /**
   * Strip the orcid.org URL prefix and reformat.
   * Returns empty string if value is empty.
   */
  function cleanOrcid(v) {
    if (!v) return "";
    let s = String(v).trim();
    s = s.replace(/https?:\/\/(www\.)?orcid\.org\//i, "");
    return formatORCID(s);
  }

  /** Show the column-mapping modal with populated selects. */
  function openColMapModal(filename, columns, rows) {
    const overlay  = document.getElementById("col-map-overlay");
    const tbody    = document.getElementById("col-map-tbody");
    const summary  = document.getElementById("col-map-summary");
    const importBtn= document.getElementById("btn-col-map-import");

    document.getElementById("col-map-filename").textContent =
      `File: ${filename} — ${rows.length} data rows found`;

    // Build select options list
    const fieldOptions = [
      { value: "(skip)",       label: "(skip)" },
      { value: "firstName",    label: "First name" },
      { value: "middleName",   label: "Middle name" },
      { value: "lastName",     label: "Last name" },
      { value: "email",        label: "Email" },
      { value: "orcid",        label: "ORCID" },
      { value: "institution",  label: "Institution (affiliation)" },
      { value: "department",   label: "Department" },
      { value: "corresponding",label: "Corresponding author" },
      { value: "twitter",      label: "Twitter/X" },
      { value: "bluesky",      label: "Bluesky" },
      { value: "_order",       label: "Authorship order" },
      { value: "_include",     label: "Include as author? (filter)" },
      // CRediT roles
      { value: "credit:conceptualization",     label: "CRediT — Conceptualization" },
      { value: "credit:dataCuration",          label: "CRediT — Data curation" },
      { value: "credit:formalAnalysis",        label: "CRediT — Formal analysis" },
      { value: "credit:fundingAcquisition",    label: "CRediT — Funding acquisition" },
      { value: "credit:investigation",         label: "CRediT — Investigation" },
      { value: "credit:methodology",           label: "CRediT — Methodology" },
      { value: "credit:projectAdministration", label: "CRediT — Project administration" },
      { value: "credit:resources",             label: "CRediT — Resources" },
      { value: "credit:software",              label: "CRediT — Software" },
      { value: "credit:supervision",           label: "CRediT — Supervision" },
      { value: "credit:validation",            label: "CRediT — Validation" },
      { value: "credit:visualization",         label: "CRediT — Visualization" },
      { value: "credit:writingOriginalDraft",  label: "CRediT — Writing — original draft" },
      { value: "credit:writingReviewEditing",  label: "CRediT — Writing — review & editing" }
    ];

    tbody.innerHTML = "";
    const mappingSelects = []; // [{colName, select}]

    columns.forEach(col => {
      const detected = detectField(col);
      const tr = document.createElement("tr");

      const tdCol = document.createElement("td");
      tdCol.textContent = String(col);
      if (detected) tdCol.classList.add("map-detected");
      else tdCol.classList.add("map-skip");
      tr.appendChild(tdCol);

      const tdSel = document.createElement("td");
      const sel = document.createElement("select");
      fieldOptions.forEach(opt => {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
      });
      sel.value = detected || "(skip)";
      sel.addEventListener("change", updateSummary);
      tdSel.appendChild(sel);
      tr.appendChild(tdSel);

      tbody.appendChild(tr);
      mappingSelects.push({ colName: col, select: sel });
    });

    function buildMapping() {
      const m = {};
      mappingSelects.forEach(({ colName, select }) => {
        const v = select.value;
        if (v !== "(skip)") m[colName] = v;
      });
      return m;
    }

    function countImportable() {
      const m = buildMapping();
      const includeCol = Object.keys(m).find(k => m[k] === "_include");
      let skip = 0, total = 0;
      rows.forEach(row => {
        // Skip rows that are completely empty
        const hasData = Object.values(row).some(v => v !== "" && v != null);
        if (!hasData) return;
        total++;
        if (includeCol) {
          const raw = row[includeCol];
          if (!parseBool(raw === undefined || raw === "" ? "yes" : raw) &&
              (raw !== undefined && raw !== "")) {
            skip++;
          }
        }
      });
      return { total, skip, importable: total - skip };
    }

    function updateSummary() {
      const { total, skip, importable } = countImportable();
      summary.textContent =
        `Found ${total} row${total !== 1 ? "s" : ""}. ` +
        `Will import ${importable}` +
        (skip ? ` (skipping ${skip} with “wants to be co-author” = NO)` : "") + ".";
      importBtn.textContent = `Import ${importable} author${importable !== 1 ? "s" : ""}`;
    }
    updateSummary();

    overlay.hidden = false;
    overlay.focus && overlay.focus();

    // Cancel
    document.getElementById("btn-col-map-cancel").onclick = () => {
      overlay.hidden = true;
    };

    // Import
    importBtn.onclick = () => {
      overlay.hidden = true;
      const mapping = buildMapping();
      executeSpreadsheetImport(rows, mapping, filename);
    };
  }

  /**
   * Convert parsed spreadsheet rows to ordenaR authors using the
   * user-confirmed column mapping, then push into state.authors.
   */
  function executeSpreadsheetImport(rows, mapping, filename) {
    const includeCol  = Object.keys(mapping).find(k => mapping[k] === "_include");
    const orderCol    = Object.keys(mapping).find(k => mapping[k] === "_order");
    const instCol     = Object.keys(mapping).find(k => mapping[k] === "institution");
    const deptCol     = Object.keys(mapping).find(k => mapping[k] === "department");

    const imported = [];
    let skippedInclude = 0;
    let badOrcid = 0;

    rows.forEach(row => {
      // Skip entirely empty rows
      const hasData = Object.values(row).some(v => v !== "" && v != null);
      if (!hasData) return;

      // Check include flag
      if (includeCol) {
        const raw = row[includeCol];
        // If the cell has a value and it's falsy, skip
        if (raw !== undefined && raw !== "" && !parseBool(raw)) {
          skippedInclude++;
          return;
        }
      }

      const a = emptyAuthor();

      // Map simple scalar fields
      const scalarFields = ["firstName","middleName","lastName","email","twitter","bluesky"];
      Object.entries(mapping).forEach(([col, field]) => {
        if (scalarFields.includes(field)) {
          const v = String(row[col] || "").trim();
          if (v) a[field] = v;
        }
        if (field === "corresponding") {
          a.corresponding = parseBool(row[col]);
        }
        if (field === "orcid") {
          a.orcid = cleanOrcid(row[col]);
        }
        // CRediT role fields: credit:keyName
        if (field.startsWith("credit:")) {
          const key = field.split(":")[1];
          if (!a.credit) a.credit = emptyAuthor().credit;
          // OR with existing value so multiple columns can set the same key
          a.credit[key] = a.credit[key] || parseBool(row[col]);
        }
      });

      // If only "fullName"-ish column exists (no firstName/lastName),
      // split on last space
      if (!a.firstName && !a.lastName) {
        const nameCol = Object.keys(mapping).find(k =>
          ["name","author","fullname","full name"].includes(normHeader(k))
        );
        if (nameCol) {
          const full = String(row[nameCol] || "").trim();
          const parts = full.split(/\s+/);
          a.lastName  = parts.pop() || "";
          a.firstName = parts.shift() || "";
          a.middleName = parts.join(" ");
        }
      }

      // Skip rows with no name at all
      if (!a.firstName && !a.lastName) return;

      // Combine institution + department into one affiliation entry
      const instVal = instCol ? String(row[instCol] || "").trim() : "";
      const deptVal = deptCol ? String(row[deptCol] || "").trim() : "";
      if (instVal || deptVal) {
        a.affiliations = [{ institution: instVal, department: deptVal, city: "", country: "" }];
      }

      // Store authorship order for later sorting
      if (orderCol) {
        const ord = parseFloat(row[orderCol]);
        a._importOrder = isNaN(ord) ? 9999 : ord;
      } else {
        a._importOrder = imported.length;
      }

      // Validate ORCID
      if (a.orcid && validORCID(a.orcid) === false) badOrcid++;

      imported.push(a);
    });

    // Sort by authorship order if an order column was detected
    if (orderCol) {
      imported.sort((x, y) => (x._importOrder || 0) - (y._importOrder || 0));
    }
    // Remove temp sort key
    imported.forEach(a => { delete a._importOrder; });

    if (imported.length === 0) {
      showToast("⚠️ No importable authors found in the spreadsheet.", "warn");
      return;
    }

    // Decide append vs. replace
    let doReplace = false;
    if (state.authors.length > 0 && !(state.authors.length === 1 && !fullName(state.authors[0]))) {
      const choice = confirm(
        `Append ${imported.length} imported author${imported.length !== 1 ? "s" : ""} to the ` +
        `existing ${state.authors.length} author${state.authors.length !== 1 ? "s" : ""},\n` +
        `or replace all?\n\nOK = Append   Cancel = Replace all`
      );
      doReplace = !choice;
    }

    if (doReplace) {
      state.authors = imported;
    } else {
      state.authors = state.authors.concat(imported);
    }

    renderAuthors();
    scheduleSave();
    renderOutput();

    // Build toast message
    let msg = `✅ Imported ${imported.length} author${imported.length !== 1 ? "s" : ""} from ${filename}.`;
    if (badOrcid)  msg += ` ⚠️ ${badOrcid} ORCID${badOrcid !== 1 ? "s" : ""} failed checksum validation.`;
    if (skippedInclude) msg += ` (${skippedInclude} skipped: not a co-author)`;
    showToast(msg, badOrcid ? "warn" : "success");
  }

  /** Display a toast notification that auto-dismisses after 5 s. */
  function showToast(message, type) {
    const toast = document.getElementById("import-toast");
    toast.textContent = message;
    toast.className = "import-toast" + (type ? " toast-" + type : "");
    toast.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { toast.hidden = true; }, 5000);
  }

  /** Wire up the spreadsheet import button and file input. */
  function initSpreadsheetImport() {
    const btn       = document.getElementById("btn-import-spreadsheet");
    const fileInput = document.getElementById("file-import-spreadsheet");

    if (!btn || !fileInput) return;

    btn.addEventListener("click", () => {
      // Guard: check SheetJS is loaded
      if (typeof window.XLSX === "undefined") {
        alert("⚠️ SheetJS library did not load. Check your internet connection.");
        return;
      }
      fileInput.value = ""; // reset so same file can be re-selected
      fileInput.click();
    });

    fileInput.addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = new Uint8Array(ev.target.result);
          const wb   = window.XLSX.read(data, { type: "array" });
          const sheet= wb.Sheets[wb.SheetNames[0]];

          // Parse to JSON rows; raw: false forces string representation
          const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

          if (!rows || rows.length === 0) {
            alert("⚠️ The spreadsheet appears to be empty.");
            return;
          }

          // Column headers are the keys of the first row object
          const columns = Object.keys(rows[0]);

          // Open the mapping modal
          openColMapModal(file.name, columns, rows);
        } catch (err) {
          alert("⚠️ Could not parse spreadsheet: " + err.message);
        }
        e.target.value = "";
      };
      reader.readAsArrayBuffer(file);
    });
  }


  /* ============================================================ *
   * 15. Word (.docx) export (docx.js)                            *
   * ============================================================ *
   *
   * Builds a properly structured .docx document:
   *   • Heading 1: project title
   *   • Heading 2: Authors — byline with superscript affiliation numbers
   *   • Heading 2: Affiliations — numbered list
   *   • Heading 3: Corresponding author(s) with email
   *   • Heading 2: Author details — table (Name, Email, ORCID, Affiliation)
   *   • Heading 3: Social and academic profiles (if any)
   *   • Legend paragraphs for equal contribution, deceased
   *
   * Fonts: Calibri 11pt body, Calibri 14pt headings (Word default).
   */

  /**
   * Build and trigger download of the Word .docx file.
   * Uses window.docx (loaded from docx@8.5.0 CDN).
   */
  async function downloadDocx() {
    if (typeof window.docx === "undefined") {
      alert("⚠️ docx.js library did not load. Check your internet connection.");
      return;
    }

    const {
      Document, Packer, Paragraph, TextRun, HeadingLevel,
      Table, TableRow, TableCell, WidthType, BorderStyle,
      AlignmentType, UnderlineType, ShadingType
    } = window.docx;

    const authors = displayedAuthors();
    const idx     = buildAffilIndex(authors);
    const title   = norm(state.title) || "";

    /** Helper: Calibri TextRun factory */
    function cr(text, opts) {
      return new TextRun(Object.assign({
        text:    String(text || ""),
        font:    "Calibri",
        size:    22  /* 11pt in half-points */
      }, opts || {}));
    }

    /** Helper: heading paragraph */
    function h(level, text) {
      return new Paragraph({
        heading: level,
        children: [
          new TextRun({ text, font: "Calibri", size: level === HeadingLevel.HEADING_1 ? 28 : 24, bold: true })
        ]
      });
    }

    /** Helper: simple body paragraph */
    function p(runs) {
      return new Paragraph({ children: Array.isArray(runs) ? runs : [runs] });
    }

    /** Helper: blank paragraph spacer */
    function blank() {
      return new Paragraph({ children: [cr("")] });
    }

    // ---- 1. Author byline paragraph ----
    const bylineRuns = [];
    authors.forEach((a, i) => {
      if (i > 0) bylineRuns.push(cr(", "));
      bylineRuns.push(cr(fullName(a)));
      // Affiliation superscripts
      const supParts = [
        ...idx.authorIdx[i].map(String),
        ...(a.corresponding    ? ["*"]               : []),
        ...(a.equalContribution? [a.equalSymbol||"†"] : []),
        ...(a.deceased         ? ["§"]               : [])
      ];
      if (supParts.length) {
        bylineRuns.push(cr(supParts.join(","), { superScript: true, size: 16 }));
      }
    });

    // ---- 2. Affiliations ----
    const affilParas = idx.order.map((k, i) =>
      p([
        cr(String(i + 1), { superScript: true, size: 16 }),
        cr(" " + idx.byKey[k].text)
      ])
    );

    // Present addresses
    const presentParas = authors
      .filter(a => norm(a.presentAddress))
      .map(a => p([
        cr("Present address ("),
        cr(fullName(a), { italics: true }),
        cr("): " + norm(a.presentAddress))
      ]));

    // ---- 3. Corresponding authors ----
    const corrAuthors = authors.filter(a => a.corresponding);
    const corrParas = corrAuthors.map(a =>
      p([
        cr(fullName(a), { bold: true }),
        cr(a.email ? " — " + a.email : "")
      ])
    );

    // ---- 4. Author details table ----
    const tableHeaderRow = new TableRow({
      children: ["Name","Email","ORCID","Affiliation"].map(h2 =>
        new TableCell({
          children: [ p(cr(h2, { bold: true })) ],
          shading: { type: ShadingType.CLEAR, fill: "F4F4FB" }
        })
      ),
      tableHeader: true
    });
    const tableDataRows = authors.map(a => {
      const affilSummary = (a.affiliations || []).map(affilText).filter(Boolean).join(" / ") || "—";
      const orcidText    = norm(a.orcid) ? formatORCID(a.orcid) : "—";
      return new TableRow({
        children: [
          new TableCell({ children: [p(cr(fullName(a)))] }),
          new TableCell({ children: [p(cr(a.email || "—"))] }),
          new TableCell({ children: [p(cr(orcidText))] }),
          new TableCell({ children: [p(cr(affilSummary))] })
        ]
      });
    });
    const detailTable = new Table({
      rows: [tableHeaderRow, ...tableDataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top:          { style: BorderStyle.SINGLE, size: 1, color: "CCC9E8" },
        bottom:       { style: BorderStyle.SINGLE, size: 1, color: "CCC9E8" },
        left:         { style: BorderStyle.SINGLE, size: 1, color: "CCC9E8" },
        right:        { style: BorderStyle.SINGLE, size: 1, color: "CCC9E8" },
        insideH:      { style: BorderStyle.SINGLE, size: 1, color: "CCC9E8" },
        insideV:      { style: BorderStyle.SINGLE, size: 1, color: "CCC9E8" }
      }
    });

    // ---- 5. Social/academic profiles (only if at least one has a profile) ----
    const profileFields = ["scholar","researchgate","github","bluesky","mastodon","twitter","linkedin","website","osf"];
    const profileLabels = {
      scholar:     "Google Scholar", researchgate: "ResearchGate", github: "GitHub",
      bluesky:     "Bluesky",       mastodon:     "Mastodon",     twitter: "X/Twitter",
      linkedin:    "LinkedIn",      website:      "Personal website", osf: "OSF"
    };
    const hasSocial = authors.some(a => profileFields.some(f => norm(a[f])));
    const socialParas = hasSocial
      ? authors.flatMap(a => {
          const parts = profileFields
            .filter(f => norm(a[f]))
            .map(f => profileLabels[f] + ": " + a[f]);
          if (!parts.length) return [];
          return [p([
            cr("• " + fullName(a) + " — ", { bold: true }),
            cr(parts.join("  |  "))
          ])];
        })
      : [];

    // ---- 6. Legend paragraphs ----
    const legendParas = [];
    const equalAuthors = authors.filter(a => a.equalContribution);
    if (equalAuthors.length) {
      const sym = equalAuthors[0].equalSymbol || "†";
      legendParas.push(p(cr(`${sym} These authors contributed equally to this work.`, { italics: true })));
    }
    if (authors.some(a => a.deceased)) {
      legendParas.push(p(cr("† Deceased.", { italics: true })));
    }

    // ---- 7. CRediT author contributions ----
    const creditAuthors = authors.filter(a =>
      a.credit && CREDIT_ROLES.some(r => a.credit[r.key])
    );
    const creditParas = creditAuthors.map(a => {
      const roles = CREDIT_ROLES.filter(r => a.credit && a.credit[r.key]).map(r => r.label);
      return p([
        cr(fullName(a), { bold: true }),
        cr(": " + roles.join("; ") + ".")
      ]);
    });

    // ---- Assemble document ----
    const sections = [];

    if (title) sections.push(h(HeadingLevel.HEADING_1, title));

    sections.push(h(HeadingLevel.HEADING_2, "Authors"));
    sections.push(p(bylineRuns));
    if (legendParas.length) sections.push(...legendParas);
    sections.push(blank());

    sections.push(h(HeadingLevel.HEADING_2, "Affiliations"));
    sections.push(...affilParas);
    if (presentParas.length) sections.push(...presentParas);
    sections.push(blank());

    if (corrAuthors.length) {
      sections.push(h(HeadingLevel.HEADING_3, "Corresponding author" + (corrAuthors.length > 1 ? "s" : "")));
      sections.push(...corrParas);
      sections.push(blank());
    }

    sections.push(h(HeadingLevel.HEADING_2, "Author details"));
    sections.push(detailTable);
    sections.push(blank());

    if (hasSocial) {
      sections.push(h(HeadingLevel.HEADING_3, "Social and academic profiles"));
      sections.push(...socialParas);
      sections.push(blank());
    }

    if (creditParas.length) {
      sections.push(h(HeadingLevel.HEADING_2, "Author contributions (CRediT)"));
      sections.push(...creditParas);
    }

    const doc = new Document({
      sections: [{ properties: {}, children: sections }]
    });

    // Pack and download
    try {
      const blob = await Packer.toBlob(doc);
      const slug = (state.title || "ordenaR-authors").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ordenaR-authors";
      triggerDownload(blob, slug + "-authors.docx");
    } catch (err) {
      alert("⚠️ Could not generate .docx: " + err.message);
      console.error("ordenaR docx error:", err);
    }
  }

  /** Wire the "Download Word (.docx)" button. */
  function initDocxExport() {
    const btn = document.getElementById("btn-download-docx");
    if (!btn) return;
    btn.addEventListener("click", () => {
      downloadDocx().catch(err => {
        alert("⚠️ Unexpected error generating .docx: " + err.message);
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
