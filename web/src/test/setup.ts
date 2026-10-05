import "@testing-library/jest-dom/vitest";

// jsdom has no layout, so window.scrollTo only logs "not implemented". Screens
// scroll to the top on navigation (layout/scrollTop.ts); a no-op keeps tests quiet.
window.scrollTo = (() => {}) as typeof window.scrollTo;
