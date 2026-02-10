export type TbrBook = {
  id?: string;
  title: string;
  author: string;
  genre?: string | null;
  status?: string | null;
  page_count?: number | null;
  rating?: number | null;
};

export type TbrFilters = {
  genre: "Any" | "Fantasy" | "Science Fiction" | "History" | "Romance" | "Thriller";
  length: "Any" | "<250" | "250-400" | "400+";
  rating: "Any" | ">=4";
};

export const applyTbrFilters = (books: TbrBook[], filters: TbrFilters) => {
  return books.filter((book) => {
    if (filters.genre !== "Any") {
      if (!book.genre) return false;
      if (book.genre.toLowerCase() !== filters.genre.toLowerCase()) return false;
    }

    if (filters.length !== "Any") {
      const pages = book.page_count ?? null;
      if (!pages) return false;
      if (filters.length === "<250" && pages >= 250) return false;
      if (filters.length === "250-400" && (pages < 250 || pages > 400)) return false;
      if (filters.length === "400+" && pages < 400) return false;
    }

    if (filters.rating !== "Any") {
      const rating = book.rating ?? null;
      if (!rating) return false;
      if (filters.rating === ">=4" && rating < 4) return false;
    }

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

