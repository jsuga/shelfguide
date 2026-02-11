export type GenreTheme =
  | "default"
  | "fantasy"
  | "scifi"
  | "history"
  | "romance"
  | "thriller";

export const themeOptions: { id: GenreTheme; label: string }[] = [
  { id: "default", label: "Classic" },
  { id: "fantasy", label: "Fantasy" },
  { id: "scifi", label: "Science Fiction" },
  { id: "history", label: "History" },
  { id: "romance", label: "Romance" },
  { id: "thriller", label: "Thriller" },
];
