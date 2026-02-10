import { describe, expect, it, vi } from "vitest";
import { applyTbrFilters, pickWinnerIndex, sampleForWheel } from "@/lib/tbrWheel";

describe("TBR Wheel filters", () => {
  const books = [
    { title: "A", author: "X", genre: "Fantasy", page_count: 200, rating: 4.2 },
    { title: "B", author: "Y", genre: "History", page_count: 320, rating: 3.5 },
    { title: "C", author: "Z", genre: "Fantasy", page_count: 450, rating: 4.5 },
  ];

  it("filters by genre", () => {
    const result = applyTbrFilters(books, { genre: "Fantasy", length: "Any", rating: "Any" });
    expect(result).toHaveLength(2);
  });

  it("filters by length bucket", () => {
    const result = applyTbrFilters(books, { genre: "Any", length: "<250", rating: "Any" });
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("A");
  });

  it("filters by rating threshold", () => {
    const result = applyTbrFilters(books, { genre: "Any", length: "Any", rating: ">=4" });
    expect(result).toHaveLength(2);
  });
});

describe("TBR Wheel selection", () => {
  it("picks a winner index deterministically", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.6);
    expect(pickWinnerIndex(5)).toBe(3);
    vi.restoreAllMocks();
  });

  it("samples down to max size", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ title: `Book ${i}`, author: "A" }));
    const sample = sampleForWheel(items, 30);
    expect(sample).toHaveLength(30);
  });
});
