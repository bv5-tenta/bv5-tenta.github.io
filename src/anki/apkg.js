/*
 * .apkg-generator (Anki-paket, schema 11 "collection.anki2").
 * Kräver en initierad sql.js-instans (SQL). Samma guid för samma fråga →
 * en ny export uppdaterar befintliga kort i Anki i stället för att skapa dubbletter.
 */

import { sha1Hex } from "../core/text.js";
import { makeZip } from "./zip.js";
import { FIELD_NAMES, CARD_CSS, FRONT_TEMPLATE, BACK_TEMPLATE } from "./cards.js";

// Ny anteckningstyp för de lila, interaktiva korten (den gamla "BV5 Tentafråga" uppdaterades inte alltid vid import).
export const MODEL_ID = 1730000000747;          // fast id för notkortstypen "BV5 Tentafråga (lila)"
export const MODEL_NAME = "BV5 Tentafråga (lila)";

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

async function stableId(text, base) {
  const h = await sha1Hex(text);
  return base + (parseInt(h.slice(0, 12), 16) % 99999999999);
}

function stripHtml(html) {
  return String(html).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function deckJson(id, name, now) {
  return {
    id, name, desc: "", mod: now, usn: -1, collapsed: false, browserCollapsed: false,
    newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
    dyn: 0, conf: 1, extendNew: 10, extendRev: 50,
  };
}

const DCONF = {
  1: {
    id: 1, name: "Default", mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 },
  },
};

/**
 * @param SQL        sql.js-modul (initSqlJs-resultat)
 * @param notes      [{guid, fields, tags, deck, sortText}]
 * @param mediaFiles Map<filnamn, Uint8Array>
 * @returns Uint8Array (zip-fil)
 */
export async function buildApkg(SQL, notes, mediaFiles = new Map()) {
  if (!notes.length) throw new Error("Det finns inga kort att exportera");
  const nowSec = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();
  const db = new SQL.Database();
  try {
    db.run(SCHEMA);

    const decks = { 1: deckJson(1, "Default", nowSec) };
    const deckIds = new Map();
    for (const n of notes) {
      if (!deckIds.has(n.deck)) {
        const id = await stableId(`deck:${n.deck}`, 1500000000000);
        deckIds.set(n.deck, id);
        decks[id] = deckJson(id, n.deck, nowSec);
      }
    }
    const firstDeck = deckIds.values().next().value;

    const model = {
      id: MODEL_ID, name: MODEL_NAME, type: 0, mod: nowSec, usn: -1, sortf: 0, did: firstDeck,
      tmpls: [{ name: "Tentafråga", ord: 0, qfmt: FRONT_TEMPLATE, afmt: BACK_TEMPLATE, did: null, bqfmt: "", bafmt: "" }],
      flds: FIELD_NAMES.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] })),
      css: CARD_CSS,
      latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
      latexPost: "\\end{document}",
      latexsvg: false,
      req: [[0, "any", [0]]],
      tags: [], vers: [],
    };
    const conf = {
      activeDecks: [1], curDeck: 1, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true,
      dueCounts: true, curModel: MODEL_ID, nextPos: notes.length + 1, sortType: "noteFld", sortBackwards: false, addToCur: true,
    };
    db.run("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')", [
      nowSec, nowMs, nowMs, JSON.stringify(conf), JSON.stringify({ [MODEL_ID]: model }), JSON.stringify(decks), JSON.stringify(DCONF),
    ]);

    const insNote = db.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')");
    const insCard = db.prepare("INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')");
    const usedIds = new Set();
    let due = 1;
    for (const n of notes) {
      let nid = await stableId(`note:${n.guid}`, 1300000000000);
      while (usedIds.has(nid)) nid++;
      usedIds.add(nid);
      let cid = await stableId(`card:${n.guid}`, 1400000000000);
      while (usedIds.has(cid)) cid++;
      usedIds.add(cid);
      const sortField = stripHtml(n.sortText || n.fields[0]).slice(0, 200);
      const csum = parseInt((await sha1Hex(stripHtml(n.fields[0]))).slice(0, 8), 16);
      const tags = ` ${n.tags.map((t) => t.replace(/\s+/g, "_")).join(" ")} `;
      insNote.run([nid, n.guid, MODEL_ID, nowSec, tags, n.fields.join("\x1f"), sortField, csum]);
      insCard.run([cid, nid, deckIds.get(n.deck), nowSec, due++]);
    }
    insNote.free();
    insCard.free();

    const collection = db.export();
    const files = [{ name: "collection.anki2", data: collection }];
    const mediaMap = {};
    let i = 0;
    for (const [name, data] of mediaFiles) {
      mediaMap[String(i)] = name;
      files.push({ name: String(i), data });
      i++;
    }
    files.push({ name: "media", data: JSON.stringify(mediaMap) });
    return makeZip(files);
  } finally {
    db.close();
  }
}

/**
 * TSV för Ankis "Importera fil". Två fält (Framsida/Baksida) så att den passar Ankis inbyggda
 * grundtyp i alla språkversioner; lärandemål, länk och källa ligger i baksidan. Rubrikraderna
 * talar om separator, HTML, kortleks-, guid- och taggkolumn så att inget behöver ställas in för hand.
 */
export function buildTsv(notes) {
  // Varje fält citeras ("…" med dubblerade citattecken) så att HTML-attribut som class="x" inte
  // tolkas som fältgränser av Ankis CSV-läsare.
  const clean = (v) => `"${String(v).replace(/[\t\r\n]+/g, " ").replace(/"/g, '""')}"`;
  const lines = [
    "#separator:tab",
    "#html:true",
    "#deck column:1",
    "#guid column:2",
    "#tags column:5",
    "#columns:Kortlek\tGUID\tFramsida\tBaksida\tTaggar",
  ];
  for (const n of notes) {
    const [front, back, lo, link, source] = n.fields;
    const fullBack =
      `${back}<div class="bv5-meta" style="margin-top:14px;padding-top:8px;border-top:1px solid #ccc;font-size:90%">` +
      `<div><b>Lärandemål:</b> ${lo}</div><div>${link}</div><div><b>Källa:</b> ${source}</div></div>`;
    lines.push([n.deck, n.guid, front, fullBack, n.tags.join(" ")].map(clean).join("\t"));
  }
  return lines.join("\n") + "\n";
}

/** Läser tillbaka en .apkg (självtest): antal kort, kortlekar och fält. */
export function inspectApkg(SQL, entries) {
  const col = entries.get("collection.anki2");
  if (!col) throw new Error("collection.anki2 saknas i paketet");
  const db = new SQL.Database(col);
  try {
    const notes = db.exec("SELECT count(*) FROM notes")[0].values[0][0];
    const cards = db.exec("SELECT count(*) FROM cards")[0].values[0][0];
    const [models, decks] = db.exec("SELECT models, decks FROM col")[0].values[0];
    const firstFields = db.exec("SELECT flds FROM notes LIMIT 1")[0]?.values[0][0] || "";
    const media = JSON.parse(new TextDecoder().decode(entries.get("media") || new Uint8Array()) || "{}");
    return {
      notes, cards,
      models: Object.values(JSON.parse(models)).map((m) => m.name),
      decks: Object.values(JSON.parse(decks)).map((d) => d.name).filter((n) => n !== "Default"),
      fieldCount: firstFields.split("\x1f").length,
      mediaCount: Object.keys(media).length,
    };
  } finally {
    db.close();
  }
}
