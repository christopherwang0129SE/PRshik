export const advancedView = (): boolean => new URLSearchParams(window.location.search).get('advanced') === '1';
