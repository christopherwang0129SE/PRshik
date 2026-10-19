import type { DocsSource } from '../types';
import { MAX_DOCS, hostOf, usableDocs } from '../utils/docs';

interface DocsSourcesProps {
  sources: DocsSource[] | null | undefined;
}

/**
 * Library docs Tavily found to ground Nemotron, shown open on the card so the
 * grounding is visible without expanding anything. Only http(s) links.
 */
export const DocsSources = ({ sources }: DocsSourcesProps) => {
  const usable = usableDocs(sources).slice(0, MAX_DOCS);
  if (usable.length === 0) return null;
  return (
    <div className="docs-sources" data-testid="docs-sources">
      <p className="docs-title">Grounded with library docs (Tavily)</p>
      <ul>
        {usable.map((source) => {
          const host = hostOf(source.url);
          return (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title || host}
              </a>
              {source.title && <span className="docs-host">{host}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
