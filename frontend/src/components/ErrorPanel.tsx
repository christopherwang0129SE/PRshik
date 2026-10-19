import { forwardRef } from 'react';
import type { ErrorHelp } from '../utils/errors';

interface ErrorPanelProps {
  help: ErrorHelp;
  onRetry?: () => void;
}

/** A failed analysis: what happened, why, and the command that fixes it. */
export const ErrorPanel = forwardRef<HTMLHeadingElement, ErrorPanelProps>(({ help, onRetry }, ref) => (
  <section className="error-panel" aria-labelledby="error-heading">
    <h2 id="error-heading" ref={ref} tabIndex={-1}>
      {help.title}
    </h2>
    <p className="error-body">{help.body}</p>
    {help.fix && (
      <div className="error-fix">
        <p>{help.fix.text}</p>
        {help.fix.command && (
          <pre className="command">
            <code>{help.fix.command}</code>
          </pre>
        )}
      </div>
    )}
    {onRetry && (
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        Try again
      </button>
    )}
  </section>
));
ErrorPanel.displayName = 'ErrorPanel';
