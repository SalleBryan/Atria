import { act, render, renderHook, screen } from "@testing-library/react";

import { Pager, usePages } from "./Pager";

const TWELVE = Array.from({ length: 12 }, (_, i) => i + 1);

describe("usePages", () => {
  it("shows one page of the list at a time", () => {
    const { result } = renderHook(() => usePages(TWELVE, 5, "all"));
    expect(result.current.shown).toEqual([1, 2, 3, 4, 5]);
    expect(result.current.pages).toBe(3);
    act(() => result.current.next());
    expect(result.current.shown).toEqual([6, 7, 8, 9, 10]);
    expect([result.current.first, result.current.last, result.current.total]).toEqual([6, 10, 12]);
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.shown).toEqual([11, 12]);
  });

  it("starts again at the first page when the search or filter changes", () => {
    const { result, rerender } = renderHook(({ reset }) => usePages(TWELVE, 5, reset), { initialProps: { reset: "a" } });
    act(() => result.current.next());
    rerender({ reset: "b" });
    expect(result.current.page).toBe(0);
  });

  it("turns to the page holding a chosen item", () => {
    const { result } = renderHook(() => usePages(TWELVE, 5, "all"));
    act(() => result.current.reveal(10));
    expect(result.current.page).toBe(2);
  });
});

describe("Pager", () => {
  it("says which rows are shown and offers the next page only when there is one", () => {
    render(<Pager first={6} last={10} total={12} page={1} pages={3} onPrevious={() => {}} onNext={() => {}} />);
    expect(screen.getByText("6 to 10 of 12")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
  });

  it("offers no page buttons when everything fits on one", () => {
    render(<Pager first={1} last={4} total={4} page={0} pages={1} onPrevious={() => {}} onNext={() => {}} />);
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });
});
