import type { DocsSource } from '../types';

interface DocsSourcesProps {
  sources: DocsSource[];
}

const isHttp = (url: string): boolean => /^https?:\/\//i.test(url);

/** Library docs Tavily found to ground Nemotron. Skips malformed entries. */
export const DocsSources = ({ sources }: DocsSourcesProps) => {
  const usable = sources.filter((s) => s && typeof s.url === 'string' && isHttp(s.url));
  if (usable.length === 0) return null;
  return (
    <div className="docs-sources">
      <p className="docs-title">Docs checked with Tavily</p>
      <ul>
        {usable.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.title || source.url}
            </a>
            {source.query && <span className="docs-query"> for “{source.query}”</span>}
          </li>
        ))}
      </ul>
    </div>
  );
};
