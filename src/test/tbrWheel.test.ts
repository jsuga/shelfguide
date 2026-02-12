import { describe, expect, it, vi } from "vitest";
import {
  applyTbrFilters,
  dedupeCandidatesAgainstOwned,
  pickWinnerIndex,
  sampleForWheel,
} from "@/lib/tbrWheel";

describe("TBR Wheel filters", () => {
  const books = [
    {
      title: "A",
      author: "X",
      genre: "Fantasy",
      status: "tbr",
      is_first_in_series: true,
      page_count: 200,
      rating: 4.2,
    },
    {
      title: "B",
      author: "Y",
      genre: "History",
      status: "reading",
      is_first_in_series: false,
      page_count: 320,
      rating: 3.5,
    },
    {
      title: "C",
      author: "Z",
      genre: "Science Fiction",
      status: "finished",
      is_first_in_series: false,
      page_count: 450,
      rating: 4.5,
    },
  ];

  it("filters by genre", () => {
    const result = applyTbrFilters(books, {
      genres: ["Fantasy", "History"],
      firstInSeries: "any",
      ownership: "library",
      length: "Any",
    });
    expect(result).toHaveLength(2);
  });

  it("filters by length bucket", () => {
    const result = applyTbrFilters(books, {
      genres: ["Any"],
      firstInSeries: "any",
      ownership: "library",
      length: "<250",
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("A");
  });

  it("filters by first in series", () => {
    const result = applyTbrFilters(books, {
      genres: ["Any"],
      firstInSeries: "first_only",
      ownership: "library",
      length: "Any",
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("A");
  });
});

describe("TBR Wheel ownership mode", () => {
  it("dedupes candidates against owned books by isbn13, isbn, then title/author", () => {
    const owned = [
      { title: "Owned 1", author: "Author A", isbn13: "978123" },
      { title: "Owned 2", author: "Author B", isbn: "111" },
      { title: "Owned 3", author: "Author C" },
    ];
    const candidates = [
      { title: "New A", author: "X", isbn13: "978123" },
      { title: "New B", author: "Y", isbn: "111" },
      { title: "Owned 3", author: "Author C" },
      { title: "Fresh", author: "Z", isbn13: "978999" },
      { title: "Fresh", author: "Z", isbn13: "978999" },
    ];

    const result = dedupeCandidatesAgainstOwned(candidates, owned);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Fresh");
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
