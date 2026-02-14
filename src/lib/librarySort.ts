export type SortMode = "title_az" | "author_az" | "genre_az" | "series_first" | "author_series";

type Sortable = {
  title: string;
  author: string;
  genre?: string | null;
  series_name?: string | null;
};

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export const sortByTitle = <T extends Sortable>(books: T[]): T[] =>
  [...books].sort((a, b) => norm(a.title).localeCompare(norm(b.title)));

export const sortByAuthor = <T extends Sortable>(books: T[]): T[] =>
  [...books].sort((a, b) => norm(a.author).localeCompare(norm(b.author)));

export const sortByGenre = <T extends Sortable>(books: T[]): T[] =>
  [...books].sort((a, b) =>
    (norm(a.genre) || "unknown").localeCompare(norm(b.genre) || "unknown")
  );

export const sortBySeriesFirst = <T extends Sortable>(books: T[]): T[] => {
  const seriesBooks = books.filter((b) => b.series_name);
  const standalones = books.filter((b) => !b.series_name);

  const groups = new Map<string, T[]>();
  for (const book of seriesBooks) {
    const key = norm(book.series_name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(book);
  }

  const sortedGroupKeys = [...groups.keys()].sort();
  const result: T[] = [];
  for (const key of sortedGroupKeys) {
    const group = groups.get(key)!;
    group.sort((a, b) => norm(a.title).localeCompare(norm(b.title)));
    result.push(...group);
  }

  standalones.sort((a, b) => norm(a.title).localeCompare(norm(b.title)));
  result.push(...standalones);
  return result;
};

export const sortByAuthorSeriesTogether = <T extends Sortable>(books: T[]): T[] => {
  const byAuthor = new Map<string, T[]>();
  for (const book of books) {
    const key = norm(book.author);
    if (!byAuthor.has(key)) byAuthor.set(key, []);
    byAuthor.get(key)!.push(book);
  }

  const sortedAuthors = [...byAuthor.keys()].sort();
  const result: T[] = [];

  for (const authorKey of sortedAuthors) {
    const authorBooks = byAuthor.get(authorKey)!;
    const seriesBooks = authorBooks.filter((b) => b.series_name);
    const standalones = authorBooks.filter((b) => !b.series_name);

    const groups = new Map<string, T[]>();
    for (const book of seriesBooks) {
      const key = norm(book.series_name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(book);
    }

    const sortedGroupKeys = [...groups.keys()].sort();
    for (const key of sortedGroupKeys) {
      const group = groups.get(key)!;
      group.sort((a, b) => norm(a.title).localeCompare(norm(b.title)));
      result.push(...group);
    }

    standalones.sort((a, b) => norm(a.title).localeCompare(norm(b.title)));
    result.push(...standalones);
  }

  return result;
};

export const applySort = <T extends Sortable>(books: T[], mode: SortMode): T[] => {
  switch (mode) {
    case "title_az": return sortByTitle(books);
    case "author_az": return sortByAuthor(books);
    case "genre_az": return sortByGenre(books);
    case "series_first": return sortBySeriesFirst(books);
    case "author_series": return sortByAuthorSeriesTogether(books);
    default: return books;
  }
};
