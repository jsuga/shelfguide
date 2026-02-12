type DedupeInput = {
  title: string;
  author: string;
  isbn13?: string | null;
};

export const normalizeDedupeValue = (value: string) =>
  value.trim().toLowerCase();

export const buildBookDedupeKey = (book: DedupeInput) => {
  const isbn13 = normalizeDedupeValue(book.isbn13 || "");
  if (isbn13) {
    return `isbn13:${isbn13}`;
  }
  const title = normalizeDedupeValue(book.title || "");
  const author = normalizeDedupeValue(book.author || "");
  return `title_author:${title}|${author}`;
};

