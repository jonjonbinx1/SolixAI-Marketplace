---
name: research
version: "1.1.0"
contributor: base
description: "Search, gather, and synthesize information from multiple sources."
tags:
  - core
  - reasoning
  - information-gathering

inputs:
  - name: question
    type: string
    required: true
    description: "The specific question or information need to research."
  - name: sources
    type: array
    required: false
    items:
      type: string
      enum: [local, web, http, project-inspector]
    description: "Source types to consult. Defaults to all available."
  - name: maxQueries
    type: number
    required: false
    description: "Maximum number of web search queries to issue. Defaults to 3."
    default: 3

outputs:
  question: string
  sourceResults:
    type: array
    items:
      type: object
      properties:
        source: { type: string }
        finding: { type: string }
  synthesis: string
  confidence:
    type: string
    enum: [high, medium, low]
  gaps:
    type: array
    items:
      type: string
    nullable: true

verify: []

config:
  - key: maxQueries
    label: Max Search Queries
    type: number
    default: 3
    min: 1
    max: 20
    step: 1
    description: Maximum number of web search queries to issue per research task.
  - key: preferredSources
    label: Preferred Sources
    type: multiselect
    options:
      - local
      - web
      - http
      - project-inspector
    description: Source types to prioritize during research.
  - key: confidenceThreshold
    label: Min Confidence
    type: select
    options:
      - high
      - medium
      - low
    default: medium
    description: Minimum confidence level required before accepting a finding.
  - key: language
    label: Wikipedia Language
    type: string
    default: en
    description: Two-letter language code for the Wikipedia edition to search (e.g. en, fr, de).
  - key: includeSummary
    label: Include Top-Result Summary
    type: boolean
    default: true
    description: Fetch a plain-text extract for the highest-ranked Wikipedia result.
---

# Research

When you need information that is not already in context, conduct structured research using available tools.

## Process

1. **Define the question.** State precisely what information you need and why.

2. **Choose sources.** Decide where to look:
   - **Local files** — Use `filesystem` to read project files, configs, READMEs.
   - **Web search** — Use `wiki-search` to find encyclopaedic articles, background information, and definitions.
   - **HTTP fetch** — Use `http` to retrieve specific URLs (docs pages, APIs, raw files).
   - **Project inspection** — Use `project-inspector` to understand a codebase's structure.

3. **Execute searches.** Run the appropriate tool(s). Use specific, targeted queries:
   - Prefer exact terms over vague phrases.
   - Include language, framework, or library names when relevant.
   - Use multiple queries if the first does not return useful results.

4. **Evaluate results.** For each result:
   - Is it relevant to the question?
   - Is it current and trustworthy?
   - Does it apply to the specific version or platform in use?

5. **Synthesize findings.** Combine information from multiple sources into a coherent answer:
   - Resolve contradictions by preferring official documentation.
   - Note the source of each key finding.
   - Distinguish facts from opinions.

6. **Summarize.** Use the `summarization` skill to distill findings before acting on them.

## Output Format

```
Question: <what you need to know>

Sources consulted:
1. <source> — <finding>
2. <source> — <finding>

Synthesis:
<combined answer>

Confidence: high | medium | low
Gaps: <anything still unknown>
```

## Guidelines

- Exhaust local sources before searching the web.
- Limit web searches to 2–3 queries. If you cannot find the answer in 3 queries, reassess the question.
- Always verify critical information from at least two sources.
- Do not present search snippets as complete answers — read the full context.
- Attribute information to its source.
