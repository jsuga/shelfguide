import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, X, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type ScannedBook = {
  title: string;
  author: string;
  genre: string;
  isbn: string;
  isbn13: string;
  description: string;
  thumbnail: string;
  page_count: number | null;
  published_year: number | null;
};

type BookScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBookScanned: (book: ScannedBook) => void;
  existingIsbns: Set<string>;
};

const normalizeIsbn = (raw: string) =>
  raw.replace(/[^0-9xX]/g, "").trim();

const lookupByIsbn = async (isbn: string): Promise<ScannedBook | null> => {
  const query = isbn.length === 13 ? `isbn:${isbn}` : `isbn:${isbn}`;
  const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1&printType=books`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.items?.[0]?.volumeInfo;
    if (!item) return null;
    const identifiers = item.industryIdentifiers || [];
    const isbn13Entry = identifiers.find((i: any) => i.type === "ISBN_13");
    const isbn10Entry = identifiers.find((i: any) => i.type === "ISBN_10");
    const cover =
      item.imageLinks?.thumbnail ||
      item.imageLinks?.smallThumbnail ||
      "";
    return {
      title: item.title || "",
      author: (item.authors || []).join(", "),
      genre: (item.categories || [])[0] || "",
      isbn: isbn10Entry?.identifier || (isbn.length === 10 ? isbn : ""),
      isbn13: isbn13Entry?.identifier || (isbn.length === 13 ? isbn : ""),
      description: item.description || "",
      thumbnail: cover ? cover.replace(/^http:\/\//i, "https://") : "",
      page_count: item.pageCount || null,
      published_year: item.publishedDate
        ? parseInt(item.publishedDate.slice(0, 4), 10) || null
        : null,
    };
  } catch {
    return null;
  }
};

const BookScanner = ({
  open,
  onOpenChange,
  onBookScanned,
  existingIsbns,
}: BookScannerProps) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [mode, setMode] = useState<"choose" | "camera" | "manual">("choose");
  const [manualIsbn, setManualIsbn] = useState("");
  const [looking, setLooking] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const containerId = "book-scanner-container";

  const cleanup = () => {
    if (scannerRef.current) {
      scannerRef.current
        .stop()
        .catch(() => {})
        .finally(() => {
          scannerRef.current?.clear();
          scannerRef.current = null;
        });
    }
  };

  useEffect(() => {
    if (!open) {
      cleanup();
      setMode("choose");
      setManualIsbn("");
      setCameraError(null);
      setLooking(false);
    }
  }, [open]);

  const handleIsbnDetected = async (rawIsbn: string) => {
    const isbn = normalizeIsbn(rawIsbn);
    if (!isbn || isbn.length < 10) {
      toast.error("Invalid barcode. Try again or enter ISBN manually.");
      return;
    }
    if (existingIsbns.has(isbn)) {
      toast.info("This book is already in your library.");
      return;
    }
    setLooking(true);
    cleanup();
    const book = await lookupByIsbn(isbn);
    setLooking(false);
    if (!book) {
      toast.error("Couldn't find book metadata. Try entering ISBN manually.");
      setMode("manual");
      setManualIsbn(isbn);
      return;
    }
    onBookScanned(book);
    onOpenChange(false);
    toast.success(`Found: "${book.title}" — review and add to library.`);
  };

  const startCamera = async () => {
    setMode("camera");
    setCameraError(null);
    // Wait for DOM
    await new Promise((r) => setTimeout(r, 300));
    try {
      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 280, height: 150 } },
        (decodedText) => {
          void handleIsbnDetected(decodedText);
        },
        () => {}
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (
        msg.includes("NotAllowedError") ||
        msg.includes("Permission") ||
        msg.includes("denied")
      ) {
        setCameraError(
          "Camera permission denied. Please allow camera access or enter ISBN manually."
        );
      } else {
        setCameraError(
          "Could not start camera. Try entering ISBN manually instead."
        );
      }
      setMode("manual");
    }
  };

  const handleManualSubmit = () => {
    const isbn = normalizeIsbn(manualIsbn);
    if (!isbn || isbn.length < 10) {
      toast.error("Enter a valid ISBN (10 or 13 digits).");
      return;
    }
    void handleIsbnDetected(isbn);
  };

  const isMobileish =
    typeof navigator !== "undefined" &&
    /android|iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Scan Book</DialogTitle>
        </DialogHeader>

        {mode === "choose" && (
          <div className="grid gap-3 py-2">
            {isMobileish ? (
              <Button onClick={startCamera} className="gap-2">
                <Camera className="w-4 h-4" /> Scan barcode with camera
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Camera scanning works best on mobile. Use manual ISBN entry
                below.
              </p>
            )}
            <Button
              variant="outline"
              onClick={() => setMode("manual")}
              className="gap-2"
            >
              <Keyboard className="w-4 h-4" /> Enter ISBN manually
            </Button>
          </div>
        )}

        {mode === "camera" && (
          <div className="grid gap-3">
            <div
              id={containerId}
              className="w-full min-h-[220px] rounded-lg overflow-hidden bg-muted"
            />
            {looking && (
              <p className="text-sm text-muted-foreground animate-pulse">
                Looking up book...
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                cleanup();
                setMode("manual");
              }}
            >
              Switch to manual entry
            </Button>
          </div>
        )}

        {mode === "manual" && (
          <div className="grid gap-3">
            {cameraError && (
              <p className="text-sm text-destructive">{cameraError}</p>
            )}
            <div className="grid gap-2">
              <Label htmlFor="manual-isbn">ISBN</Label>
              <Input
                id="manual-isbn"
                value={manualIsbn}
                onChange={(e) => setManualIsbn(e.target.value)}
                placeholder="978-0-06-112008-4"
                onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
              />
            </div>
            <Button onClick={handleManualSubmit} disabled={looking}>
              {looking ? "Looking up..." : "Look up book"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default BookScanner;
