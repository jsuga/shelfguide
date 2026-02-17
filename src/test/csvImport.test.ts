import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseLibraryCsv } from "@/lib/csvImport";

describe("parseLibraryCsv", () => {
  it("keeps rows without covers and parses quoted commas", () => {
    const fixturePath = resolve(__dirname, "fixtures", "sample-import-missing-covers.csv");
    const csv = readFileSync(fixturePath, "utf-8");

    const { books, diagnostics } = parseLibraryCsv(csv);

    expect(diagnostics.acceptedRows).toBe(3);
    expect(diagnostics.rejectedRows).toBe(0);

    const noCover = books.find((b) => b.title === "No Cover Book");
    expect(noCover).toBeTruthy();
    expect(noCover?.cover_url).toBeNull();
    expect(noCover?.thumbnail).toBeNull();

    const withComma = books.find((b) => b.title === "A Tale, With Commas");
    expect(withComma?.author).toBe("Smith, Jane");
  });
});
