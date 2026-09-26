import { rank, suggest, type SuggestionGroup } from "./SearchSuggest";
import { byPopularity, packs } from "./FilterMenu";

describe("rank", () => {
  it("prefers the start of the text, then the start of a word, then anywhere", () => {
    expect(rank("Cardiology", "card")).toBe(4);
    expect(rank("Esther Mbarga", "mbar")).toBe(3);
    expect(rank("Paediatrics", "iatr")).toBe(2);
  });

  it("ignores case and accents", () => {
    expect(rank("Yaoundé", "YAOUNDE")).toBe(4);
  });

  it("forgives one slip from four letters on", () => {
    expect(rank("Cardiology", "cardoilogy")).toBe(1);
    expect(rank("Ophthalmology", "opthalmology")).toBe(1);
    expect(rank("Cardiology", "cxr")).toBe(0);
  });

  it("needs every word of the query to match", () => {
    expect(rank("Esther Mbarga", "esther mb")).toBe(3);
    expect(rank("Esther Mbarga", "esther nkoulou")).toBe(0);
  });
});

describe("suggest", () => {
  const group = (items: string[]): SuggestionGroup => ({
    id: "g",
    label: "G",
    items: items.map((label) => ({ id: label, label, onPick: () => {} })),
  });

  it("offers the best few of each category and leaves out empty ones", () => {
    const found = suggest([group(["Dermatology", "Cardiology"]), group(["Medical Outpatient Unit"])], "cardio");
    expect(found).toHaveLength(1);
    expect(found[0]!.items.map((i) => i.label)).toEqual(["Cardiology"]);
  });

  it("offers nothing for an empty query", () => {
    expect(suggest([group(["Cardiology"])], "  ")).toEqual([]);
  });
});

describe("byPopularity", () => {
  it("orders options by how many results each has, then by name", () => {
    const options = byPopularity(["b", "a", "b", "c", "a", "b"], (x) => x);
    expect(options.map((o) => [o.id, o.count])).toEqual([
      ["b", 3],
      ["a", 2],
      ["c", 1],
    ]);
  });
});

describe("packs", () => {
  it("wraps chips onto as many lines as it is allowed", () => {
    expect(packs([50, 50, 50], 160, 5, 1)).toBe(true);
    expect(packs([50, 50, 50, 50], 160, 5, 1)).toBe(false);
    expect(packs([50, 50, 50, 50], 160, 5, 2)).toBe(true);
  });
});
