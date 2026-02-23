import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, Keyboard, Search, RotateCcw } from "lucide-react";
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
import {
  normalizeScannedCode,
  resolveBookMetadataFromBarcode,
  searchBookByTitleAuthor,
  type ScannedBookMeta,
} from "@/lib/isbnUtils";

type BookScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBookScanned: (book: ScannedBookMeta) => void;
  existingIsbns: Set<string>;
};

type ScanPhase =
  | "choose"
  | "camera"
  | "manual_isbn"
  | "lookup_loading"
  | "lookup_fallback"
  | "metadata_found"
  | "saving";

const BookScanner = ({
  open,
  onOpenChange,
  onBookScanned,
  existingIsbns,
}: BookScannerProps) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [phase, setPhase] = useState<ScanPhase>("choose");
  const [scannedCode, setScannedCode] = useState("");
  const [manualIsbn, setManualIsbn] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("");

  // Fallback manual search fields
  const [fbTitle, setFbTitle] = useState("");
  const [fbAuthor, setFbAuthor] = useState("");
  const [fbSearching, setFbSearching] = useState(false);

  // Found book (for confirmation)
  const [foundBook, setFoundBook] = useState<ScannedBookMeta | null>(null);

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

  const resetState = () => {
    setPhase("choose");
    setScannedCode("");
    setManualIsbn("");
    setCameraError(null);
    setLoadingMessage("");
    setFbTitle("");
    setFbAuthor("");
    setFbSearching(false);
    setFoundBook(null);
  };

  useEffect(() => {
    if (!open) {
      cleanup();
      resetState();
    }
  }, [open]);

  // ── Dedupe check ──────────────────────────────────────────────────────────

  const isDuplicate = (code: string): boolean => {
    const n = normalizeScannedCode(code);
    return n.length >= 10 && existingIsbns.has(n);
  };

  // ── Core lookup pipeline ──────────────────────────────────────────────────

  const runLookup = async (code: string) => {
    const normalized = normalizeScannedCode(code);
    if (!normalized || normalized.length < 10) {
      toast.error("Barcode too short. Enter a valid ISBN (10 or 13 digits).");
      setPhase("manual_isbn");
      setManualIsbn(code);
      return;
    }

    if (isDuplicate(normalized)) {
      toast.info("This book is already in your library.");
      setPhase("choose");
      return;
    }

    setScannedCode(normalized);
    setPhase("lookup_loading");
    setLoadingMessage("Finding book details…");

    const result = await resolveBookMetadataFromBarcode(normalized);

    switch (result.status) {
      case "success":
        setFoundBook(result.book);
        setPhase("metadata_found");
        break;
      case "partial":
        setFoundBook(result.book);
        setPhase("metadata_found");
        toast.info("Found partial details — you can edit before saving.");
        break;
      case "not_found":
        setPhase("lookup_fallback");
        break;
      case "network_error":
        toast.error(result.message);
        setPhase("lookup_fallback");
        break;
    }
  };

  // ── Camera ────────────────────────────────────────────────────────────────

  const startCamera = async () => {
    setPhase("camera");
    setCameraError(null);
    await new Promise((r) => setTimeout(r, 300));
    try {
      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 280, height: 150 } },
        (decodedText) => {
          cleanup();
          void runLookup(decodedText);
        },
        () => {}
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("NotAllowedError") || msg.includes("Permission") || msg.includes("denied")) {
        setCameraError("Camera permission denied. Please allow camera access or enter ISBN manually.");
      } else {
        setCameraError("Could not start camera. Try entering ISBN manually instead.");
      }
      setPhase("manual_isbn");
    }
  };

  // ── Manual ISBN submit ────────────────────────────────────────────────────

  const handleManualSubmit = () => {
    const isbn = normalizeScannedCode(manualIsbn);
    if (!isbn || isbn.length < 10) {
      toast.error("Enter a valid ISBN (10 or 13 digits).");
      return;
    }
    void runLookup(isbn);
  };

  // ── Fallback title/author search ──────────────────────────────────────────

  const handleFallbackSearch = async () => {
    if (!fbTitle.trim()) {
      toast.error("Title is required to search.");
      return;
    }
    setFbSearching(true);
    const result = await searchBookByTitleAuthor(fbTitle, fbAuthor);
    setFbSearching(false);
    if (result && result.title) {
      // Preserve the scanned ISBN if the search result doesn't have one
      if (scannedCode && !result.isbn13 && !result.isbn) {
        if (scannedCode.length === 13) result.isbn13 = scannedCode;
        else if (scannedCode.length === 10) result.isbn = scannedCode;
      }
      setFoundBook(result);
      setPhase("metadata_found");
    } else {
      toast.info("No match found. You can save with manual details.");
    }
  };

  // ── Save manually (no metadata) ──────────────────────────────────────────

  const handleSaveManual = () => {
    if (!fbTitle.trim()) {
      toast.error("Title is required.");
      return;
    }
    const manual: ScannedBookMeta = {
      title: fbTitle.trim(),
      author: fbAuthor.trim() || "Unknown Author",
      genre: "",
      isbn: scannedCode.length === 10 ? scannedCode : "",
      isbn13: scannedCode.length === 13 ? scannedCode : "",
      description: "",
      thumbnail: "",
      page_count: null,
      published_year: null,
    };
    onBookScanned(manual);
    onOpenChange(false);
  };

  // ── Confirm found book ────────────────────────────────────────────────────

  const handleConfirmBook = () => {
    if (!foundBook) return;
    // Fill ISBN from scan if missing on the result
    const book = { ...foundBook };
    if (scannedCode && !book.isbn13 && scannedCode.length === 13) book.isbn13 = scannedCode;
    if (scannedCode && !book.isbn && scannedCode.length === 10) book.isbn = scannedCode;
    onBookScanned(book);
    onOpenChange(false);
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

        {/* ── Choose mode ──────────────────────────────────────────── */}
        {phase === "choose" && (
          <div className="grid gap-3 py-2">
            {isMobileish ? (
              <Button onClick={startCamera} className="gap-2">
                <Camera className="w-4 h-4" /> Scan barcode with camera
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Camera scanning works best on mobile. Use manual ISBN entry below.
              </p>
            )}
            <Button variant="outline" onClick={() => setPhase("manual_isbn")} className="gap-2">
              <Keyboard className="w-4 h-4" /> Enter ISBN manually
            </Button>
          </div>
        )}

        {/* ── Camera ───────────────────────────────────────────────── */}
        {phase === "camera" && (
          <div className="grid gap-3">
            <div
              id={containerId}
              className="w-full min-h-[220px] rounded-lg overflow-hidden bg-muted"
            />
            <p className="text-sm text-muted-foreground animate-pulse">
              Point camera at the book barcode…
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                cleanup();
                setPhase("manual_isbn");
              }}
            >
              Switch to manual entry
            </Button>
          </div>
        )}

        {/* ── Manual ISBN ──────────────────────────────────────────── */}
        {phase === "manual_isbn" && (
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
            <Button onClick={handleManualSubmit}>
              Look up book
            </Button>
          </div>
        )}

        {/* ── Loading ──────────────────────────────────────────────── */}
        {phase === "lookup_loading" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{loadingMessage}</p>
          </div>
        )}

        {/* ── Fallback: manual title/author search ─────────────────── */}
        {phase === "lookup_fallback" && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              We couldn't find details automatically for code <span className="font-mono text-foreground">{scannedCode}</span>. Enter the title and author to search, or save manually.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="fb-title">Title</Label>
              <Input
                id="fb-title"
                value={fbTitle}
                onChange={(e) => setFbTitle(e.target.value)}
                placeholder="Book title"
                onKeyDown={(e) => e.key === "Enter" && handleFallbackSearch()}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fb-author">Author</Label>
              <Input
                id="fb-author"
                value={fbAuthor}
                onChange={(e) => setFbAuthor(e.target.value)}
                placeholder="Author name (optional)"
                onKeyDown={(e) => e.key === "Enter" && handleFallbackSearch()}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={handleFallbackSearch} disabled={fbSearching} className="gap-2">
                <Search className="w-4 h-4" /> {fbSearching ? "Searching…" : "Search"}
              </Button>
              <Button variant="outline" onClick={handleSaveManual}>
                Save manually
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void runLookup(scannedCode)}
                className="gap-1"
              >
                <RotateCcw className="w-3 h-3" /> Retry lookup
              </Button>
              {isMobileish && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    resetState();
                    void startCamera();
                  }}
                >
                  Rescan
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Found: confirm ───────────────────────────────────────── */}
        {phase === "metadata_found" && foundBook && (
          <div className="grid gap-3">
            <div className="flex gap-3">
              {foundBook.thumbnail && (
                <img
                  src={foundBook.thumbnail}
                  alt="Cover"
                  className="w-16 h-24 rounded object-cover shrink-0"
                />
              )}
              <div className="min-w-0">
                <p className="font-semibold truncate">{foundBook.title}</p>
                <p className="text-sm text-muted-foreground truncate">{foundBook.author}</p>
                {foundBook.genre && (
                  <p className="text-xs text-muted-foreground mt-1">{foundBook.genre}</p>
                )}
                {foundBook.published_year && (
                  <p className="text-xs text-muted-foreground">{foundBook.published_year}</p>
                )}
              </div>
            </div>
            <Button onClick={handleConfirmBook}>Add to library</Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPhase("lookup_fallback")}
            >
              Not the right book? Search again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default BookScanner;
