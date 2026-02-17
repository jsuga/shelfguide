export type CsvImportDiagnostics = {
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  rejectedByReason: Record<string, number>;
  missingRequiredColumns?: boolean;
};

export type ParsedLibraryBook = {
  title: string;
  author: string;
  genre: string;
  series_name: string | null;
  is_first_in_series: boolean;
  status: string;
  isbn: string | null;
  isbn13: string | null;
  goodreads_book_id: string | null;
  default_library_id: number | null;
  published_year: number | null;
  rating: number | null;
  thumbnail: string | null;
  cover_url: string | null;
  source: string | null;
};

const increment = (bucket: Record<string, number>, key: string) => {
  bucket[key] = (bucket[key] ?? 0) + 1;
};

const normalizeHeader = (value: string) =>
  value.trim().toLowerCase().replace(/^"|"$/g, "");

const parseCsvRows = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuote = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\"") {
      const next = text[i + 1];
      if (inQuote && next === "\"") {
        cell += "\"";
        i += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (ch === "," && !inQuote) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuote) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    cell += ch;
  }

  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) {
    rows.push(row);
  }

  return rows;
};

const parseInteger = (value: string | undefined | null) => {
  const parsed = Number.parseInt((value || "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseRating = (value: string | undefined | null) => {
  const parsed = Number.parseFloat((value || "").trim());
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0.5) return null;
  if (parsed > 5) return 5;
  return Math.round(parsed * 2) / 2;
};

const cleanIsbn = (value: string | undefined | null) =>
  (value || "").trim().replace(/^="?|"$/g, "") || null;

const cleanText = (value: string | undefined | null) => (value || "").trim();

const parseBoolean = (value: string | undefined | null) => {
  const raw = (value || "").trim().toLowerCase();
  return raw === "true" || raw === "yes" || raw === "1";
};

export const parseLibraryCsv = (text: string) => {
  const clean = text.replace(/^\uFEFF/, "");
  const rows = parseCsvRows(clean);

  const diagnostics: CsvImportDiagnostics = {
    totalRows: 0,
    acceptedRows: 0,
    rejectedRows: 0,
    rejectedByReason: {},
  };

  if (rows.length === 0) {
    return { books: [] as ParsedLibraryBook[], diagnostics };
  }

  const headers = rows[0].map(normalizeHeader);
  const colMap: Record<string, number> = {};
  headers.forEach((header, index) => {
    if (header) colMap[header] = index;
  });

  const col = (name: string, ...aliases: string[]) => {
    if (colMap[name] !== undefined) return colMap[name];
    for (const alias of aliases) {
      if (colMap[alias] !== undefined) return colMap[alias];
    }
    return -1;
  };

  const titleCol = col("title", "book title");
  const authorCol = col("author", "authors");
  const genreCol = col("genre", "genre(s)", "bookshelves");
  const seriesCol = col("series_name", "series", "series name");
  const firstCol = col("is_first_in_series", "first_in_series", "first in series");
  const statusCol = col("status", "exclusive shelf");
  const isbnCol = col("isbn", "isbn10", "isbn_10");
  const isbn13Col = col("isbn13", "isbn_13");
  const goodreadsIdCol = col("goodreads_book_id", "book id", "goodreads id");
  const defaultLibraryIdCol = col("library_id", "default_library_id");
  const publishedYearCol = col("published_year", "publication year", "original publication year", "year");
  const ratingCol = col("rating", "my rating");
  const coverUrlCol = col("cover_url", "cover", "cover url", "image", "image_url", "image url");
  const thumbnailCol = col("thumbnail", "thumb", "small_thumbnail", "small thumbnail");

  if (titleCol === -1 || authorCol === -1) {
    diagnostics.missingRequiredColumns = true;
    return { books: [] as ParsedLibraryBook[], diagnostics };
  }

  const books: ParsedLibraryBook[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const title = cleanText(row[titleCol]);
    const author = cleanText(row[authorCol]);

    diagnostics.totalRows += 1;

    if (!title || !author) {
      diagnostics.rejectedRows += 1;
      increment(diagnostics.rejectedByReason, "missing_title_or_author");
      continue;
    }

    const rating = parseRating(row[ratingCol]);
    const cover_url = cleanText(row[coverUrlCol]) || null;
    const thumbnail = cleanText(row[thumbnailCol]) || null;

    books.push({
      title,
      author,
      genre: cleanText(row[genreCol]),
      series_name: cleanText(row[seriesCol]) || null,
      is_first_in_series: parseBoolean(row[firstCol]),
      status: cleanText(row[statusCol]) || "tbr",
      isbn: cleanIsbn(row[isbnCol]),
      isbn13: cleanIsbn(row[isbn13Col]),
      goodreads_book_id: cleanText(row[goodreadsIdCol]) || null,
      default_library_id: parseInteger(row[defaultLibraryIdCol]),
      published_year: parseInteger(row[publishedYearCol]),
      rating,
      thumbnail,
      cover_url,
      source: "csv_import",
    });
    diagnostics.acceptedRows += 1;
  }

  return { books, diagnostics };
};
