/**
 * Wikipedia search using the official MediaWiki Action API.
 * Docs: https://www.mediawiki.org/wiki/API:Search
 *
 * Two calls are made:
 *  1. Search  — https://en.wikipedia.org/w/api.php?action=query&list=search
 *               returns matching article titles + snippets.
 *  2. Summary — https://en.wikipedia.org/api/rest_v1/page/summary/<title>
 *               fetches a short plain-text extract for the top result.
 *
 * No API key required. Wikipedia asks that you set a descriptive User-Agent
 * per https://www.mediawiki.org/wiki/API:Etiquette.
 */

const SEARCH_API  = "https://en.wikipedia.org/w/api.php";
const SUMMARY_API = "https://en.wikipedia.org/api/rest_v1/page/summary";

const HEADERS = {
  "User-Agent": "SolixAI/1.0 (https://solixai.dev; contact@solixai.dev)",
  Accept: "application/json",
};

/** Fetch up to maxResults matching articles from the MediaWiki search API */
async function searchWikipedia(query, maxResults, language) {
  const url = new URL(SEARCH_API.replace("en.wikipedia", `${language}.wikipedia`));
  url.searchParams.set("action",  "query");
  url.searchParams.set("list",    "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(maxResults));
  url.searchParams.set("srinfo",  "totalhits");
  url.searchParams.set("srprop",  "snippet|titlesnippet|wordcount|timestamp");
  url.searchParams.set("format",  "json");
  url.searchParams.set("origin",  "*");

  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) throw new Error(`Wikipedia search API returned HTTP ${res.status}`);

  const data = await res.json();
  const hits  = data?.query?.search ?? [];
  const total = data?.query?.searchinfo?.totalhits ?? 0;

  const results = hits.map((h) => ({
    type:      "article",
    title:     h.title,
    snippet:   h.snippet.replace(/<\/?[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    url:       `https://${language}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
    wordCount: h.wordcount,
    updated:   h.timestamp,
  }));

  return { results, total };
}

/** Fetch a plain-text summary for a single article title */
async function fetchSummary(title, language) {
  const encoded = encodeURIComponent(title.replace(/ /g, "_"));
  const url     = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  const res     = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;

  const data = await res.json();
  return {
    extract:    data.extract  || null,
    imageUrl:   data.thumbnail?.source || null,
    pageUrl:    data.content_urls?.desktop?.page || null,
    lastEdited: data.timestamp || null,
  };
}

export default {
  name:        "wiki-search",
  version:     "1.0.0",
  contributor: "base",
  description: "Search Wikipedia using the official MediaWiki API. Returns matching articles with snippets and an optional summary of the top result. No API key required.",

  config: [
    {
      key:         "defaultMaxResults",
      label:       "Default Max Results",
      type:        "number",
      default:     10,
      min:         1,
      max:         50,
      step:        1,
      description: "Default maximum number of articles to return per query.",
    },
    {
      key:         "language",
      label:       "Wikipedia Language",
      type:        "string",
      default:     "en",
      placeholder: "en / fr / de / es …",
      description: "Two-letter language code for the Wikipedia edition to search.",
    },
    {
      key:         "includeSummary",
      label:       "Include Top-Result Summary",
      type:        "boolean",
      default:     true,
      description: "Fetch a plain-text extract and thumbnail URL for the highest-ranked result.",
    },
  ],

  run: async ({ input }) => {
    const {
      query,
      maxResults    = 10,
      language      = "en",
      includeSummary = true,
    } = input;

    if (!query || typeof query !== "string") {
      return { ok: false, error: "A non-empty query string is required." };
    }

    try {
      const { results, total } = await searchWikipedia(query, maxResults, language);

      let summary = null;
      if (includeSummary && results.length > 0) {
        summary = await fetchSummary(results[0].title, language);
      }

      return {
        ok: true,
        query,
        language,
        total,
        results,
        ...(summary && { topSummary: summary }),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};

/**
 * Interface contract — consumed by the SolixAI runtime for call validation.
 * Schema format: JSON Schema draft-07.
 * @since 1.0.0
 */
export const spec = {
  name:    "wiki-search",
  version: "1.0.0",
  inputSchema: {
    type:     "object",
    required: ["query"],
    properties: {
      query: {
        type:        "string",
        description: "Search query string.",
      },
      maxResults: {
        type:        "number",
        description: "Maximum number of articles to return. Defaults to 10.",
        minimum:     1,
        maximum:     50,
        default:     10,
      },
      language: {
        type:        "string",
        description: "Two-letter Wikipedia language code. Defaults to \"en\".",
        default:     "en",
      },
      includeSummary: {
        type:        "boolean",
        description: "Fetch a plain-text extract for the top result. Defaults to true.",
        default:     true,
      },
    },
  },
  outputSchema: {
    type:     "object",
    required: ["ok"],
    properties: {
      ok:       { type: "boolean" },
      query:    { type: "string" },
      language: { type: "string" },
      total:    { type: "number", description: "Total matching articles on Wikipedia." },
      results: {
        type:  "array",
        items: {
          type: "object",
          properties: {
            type:      { type: "string", enum: ["article"] },
            title:     { type: "string" },
            snippet:   { type: "string", description: "Short excerpt with search terms highlighted." },
            url:       { type: "string" },
            wordCount: { type: "number" },
            updated:   { type: "string", description: "ISO 8601 timestamp of last edit." },
          },
        },
      },
      topSummary: {
        type: "object",
        description: "Plain-text extract for the highest-ranked result.",
        properties: {
          extract:    { type: ["string", "null"] },
          imageUrl:   { type: ["string", "null"] },
          pageUrl:    { type: ["string", "null"] },
          lastEdited: { type: ["string", "null"] },
        },
      },
      error: { type: "string", description: "Present when ok=false." },
    },
  },
  sideEffects: false,
  verify: [],
};
