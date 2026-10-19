interface CodeBlockProps {
  code: string;
  /** Accessible name for the scrollable region. */
  label: string;
  /** Show 1-based line numbers in a gutter (CSS counters, so copy stays clean). */
  numbered?: boolean;
  /** 1-based lines to mark, e.g. the assert that failed. */
  marked?: number[];
  /** Mark lines that start with `E ` or `>` (pytest failure output). */
  markFailures?: boolean;
}

const isFailureLine = (line: string): boolean => /^(E\s|>)/.test(line);

/**
 * Code or test output in its own horizontally scrollable block, so long
 * lines never widen the page. Focusable so keyboard users can scroll it.
 */
export const CodeBlock = ({ code, label, numbered = false, marked = [], markFailures = false }: CodeBlockProps) => {
  const lines = code.replace(/\n$/, '').split('\n');
  const marks = new Set(marked);
  return (
    <pre className="code" role="region" tabIndex={0} aria-label={label} data-numbered={numbered || undefined}>
      <code>
        {lines.map((line, index) => {
          const n = index + 1;
          const hit = marks.has(n) || (markFailures && isFailureLine(line));
          return (
            <span key={n} className="code-line" data-marked={hit || undefined}>
              {line}
              {'\n'}
            </span>
          );
        })}
      </code>
    </pre>
  );
};
