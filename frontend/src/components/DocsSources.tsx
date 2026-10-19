import type { DocsSource } from '../types';
import { MAX_DOCS, hostOf, usableDocs } from '../utils/docs';
import { groupByQuery } from '../utils/evidence';

interface DocsSourcesProps {
  sources: DocsSource[] | null | undefined;
}

/**
 * Library docs Tavily found to ground Nemotron, grouped by the query that
 * found them: title, host and query for each. Only http(s) links.
 */
export const DocsSources = ({ sources }: DocsSourcesProps) => {
  const usable = usableDocs(sources).slice(0, MAX_DOCS);
  if (usable.length === 0) return null;
  return (
    <section className="fact" data-testid="docs-sources">
      <h4 className="fact-label">
        Library docs
        <span className="fact-sub">found by Tavily</span>
      </h4>
      <div className="fact-body">
        <ul className="docs">
          {groupByQuery(usable).map((group) => (
            <li key={group.query} className="docs-group">
              {group.query && (
                <p className="docs-query">
                  <span className="docs-query-key">Query</span> <code>{group.query}</code>
                </p>
              )}
              <ul className="docs-links">
                {group.sources.map((source) => {
                  const host = hostOf(source.url);
                  return (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noopener noreferrer">
                        {source.title || host}
                      </a>{' '}
                      <span className="docs-host">{host}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
