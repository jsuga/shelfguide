type DedupeInput = {
  title: string;
  author: string;
  isbn?: string | null;
  isbn13?: string | null;
  published_year?: number | null;
};

export const normalizeDedupeValue = (value: string) =>
  value.trim().toLowerCase();

export const buildBookDedupeKey = (book: DedupeInput) => {
  const isbn13 = normalizeDedupeValue(book.isbn13 || "");
  if (isbn13) {
    return `isbn13:${isbn13}`;
  }
  const isbn10 = normalizeDedupeValue(book.isbn || "");
  if (isbn10) {
    return `isbn10:${isbn10}`;
  }
  const title = normalizeDedupeValue(book.title || "");
  const author = normalizeDedupeValue(book.author || "");
  const year =
    typeof book.published_year === "number" && Number.isFinite(book.published_year)
      ? String(book.published_year)
      : "unknown";
  return `title_author_year:${title}|${author}|${year}`;
};
