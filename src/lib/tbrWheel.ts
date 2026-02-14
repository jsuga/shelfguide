export type TbrBook = {
  id?: string;
  title: string;
  author: string;
  genre?: string | null;
  status?: string | null;
  is_first_in_series?: boolean | null;
  isbn?: string | null;
  isbn13?: string | null;
  page_count?: number | null;
};

export const TBR_WHEEL_GENRES = [
  "Fantasy",
  "Romance",
  "Mystery/Thriller",
  "Sci-Fi",
  "Historical Fiction",
  "Nonfiction",
  "Biography/Memoir",
  "YA",
  "Horror",
] as const;

export type TbrWheelGenre = (typeof TBR_WHEEL_GENRES)[number];
export type TbrFirstInSeriesFilter = "any" | "first_only" | "not_first";
export type TbrOwnershipMode = "library" | "not_owned";

export type TbrFilters = {
  genres: ("Any" | string)[];
  firstInSeries: TbrFirstInSeriesFilter;
  ownership: TbrOwnershipMode;
  length: "Any" | "<250" | "250-400" | "400+";
};

const normalize = (value: string) => value.trim().toLowerCase();

const includesGenre = (value: string, genre: string) => {
  const normalizedValue = normalize(value);
  const normalizedGenre = normalize(genre);
  if (normalizedValue === normalizedGenre) return true;
  return normalizedValue.includes(normalizedGenre);
};

export const applyTbrFilters = (books: TbrBook[], filters: TbrFilters) => {
  return books.filter((book) => {
    const selectedGenres = filters.genres.filter((genre) => genre !== "Any");
    if (selectedGenres.length > 0) {
      if (!book.genre) return false;
      const matchesGenre = selectedGenres.some((genre) =>
        includesGenre(book.genre || "", genre)
      );
      if (!matchesGenre) return false;
    }

    if (filters.firstInSeries !== "any") {
      const isFirst = book.is_first_in_series === true;
      if (filters.firstInSeries === "first_only" && !isFirst) return false;
      if (filters.firstInSeries === "not_first" && isFirst) return false;
    }

    if (filters.length !== "Any") {
      const pages = book.page_count ?? null;
      if (!pages) return false;
      if (filters.length === "<250" && pages >= 250) return false;
      if (filters.length === "250-400" && (pages < 250 || pages > 400)) return false;
      if (filters.length === "400+" && pages < 400) return false;
    }

    return true;
  });
};

export const isBookOwned = (book: TbrBook, owned: TbrBook[]) => {
  const ownedKeys = new Set<string>();
  owned.forEach((entry) => {
    if (entry.isbn13) ownedKeys.add(`isbn13:${normalize(entry.isbn13)}`);
    if (entry.isbn) ownedKeys.add(`isbn:${normalize(entry.isbn)}`);
    ownedKeys.add(`title:${normalize(entry.title)}|${normalize(entry.author)}`);
  });

  const candidateKeys = [
    book.isbn13 ? `isbn13:${normalize(book.isbn13)}` : null,
    book.isbn ? `isbn:${normalize(book.isbn)}` : null,
    `title:${normalize(book.title)}|${normalize(book.author)}`,
  ].filter(Boolean) as string[];

  return candidateKeys.some((key) => ownedKeys.has(key));
};

export const dedupeCandidatesAgainstOwned = (candidates: TbrBook[], owned: TbrBook[]) => {
  const seen = new Set<string>();
  return candidates.filter((book) => {
    const key =
      (book.isbn13 && `isbn13:${normalize(book.isbn13)}`) ||
      (book.isbn && `isbn:${normalize(book.isbn)}`) ||
      `title:${normalize(book.title)}|${normalize(book.author)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (isBookOwned(book, owned)) return false;
    return true;
  });
};

export const sampleForWheel = (books: TbrBook[], max = 30) => {
  if (books.length <= max) return books;
  const copy = [...books];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, max);
};

export const pickWinnerIndex = (count: number) => {
  if (count <= 0) return -1;
  return Math.floor(Math.random() * count);
};

export const getDistinctGenres = (books: TbrBook[]): string[] => {
  const genreSet = new Map<string, string>();
  for (const book of books) {
    if (!book.genre) continue;
    const trimmed = book.genre.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!genreSet.has(key)) {
      genreSet.set(key, trimmed);
    }
  }
  return [...genreSet.values()].sort((a, b) => a.localeCompare(b));
};
