/**
 * PdfViewer — renders a PDF from a URL using react-pdf (PDF.js).
 *
 * Features:
 * - Page navigation (prev / next / jump to page)
 * - Zoom in / out / fit-to-width
 * - Download button
 * - Loading skeleton while the document loads
 * - Error fallback with a retry button
 *
 * The component is intentionally self-contained so it can be lazy-loaded
 * and only adds weight to the bundle when a Document asset is opened.
 */

import React, { useState, useCallback, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  Box,
  IconButton,
  Tooltip,
  Typography,
  TextField,
  CircularProgress,
  Alert,
  Button,
  useTheme,
} from "@mui/material";
import {
  NavigateBefore as PrevIcon,
  NavigateNext as NextIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  FitScreen as FitIcon,
  GetApp as DownloadIcon,
} from "@mui/icons-material";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Point PDF.js at the worker bundled with pdfjs-dist.
// Vite resolves the ?url suffix to a static asset URL at build time.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  /** Accessible HTTP(S) URL of the PDF (presigned S3 or CloudFront). */
  url: string;
  /** Maximum height of the viewer container. Defaults to 70vh. */
  maxHeight?: string | number;
  /** Original filename used for the download button. */
  filename?: string;
}

const ZOOM_STEP = 0.2;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3.0;
const DEFAULT_ZOOM = 1.0;

const PdfViewer: React.FC<PdfViewerProps> = ({
  url,
  maxHeight = "70vh",
  filename = "document.pdf",
}) => {
  const theme = useTheme();

  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [pageInputValue, setPageInputValue] = useState<string>("1");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Container ref used to calculate fit-to-width zoom
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Document callbacks ────────────────────────────────────────────────────

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      setCurrentPage(1);
      setPageInputValue("1");
      setIsLoading(false);
      setLoadError(null);
    },
    []
  );

  const onDocumentLoadError = useCallback((error: Error) => {
    setLoadError(error.message || "Failed to load PDF");
    setIsLoading(false);
  }, []);

  // ── Navigation ────────────────────────────────────────────────────────────

  const goToPrev = useCallback(() => {
    setCurrentPage((p) => {
      const next = Math.max(1, p - 1);
      setPageInputValue(String(next));
      return next;
    });
  }, []);

  const goToNext = useCallback(() => {
    setCurrentPage((p) => {
      const next = Math.min(numPages, p + 1);
      setPageInputValue(String(next));
      return next;
    });
  }, [numPages]);

  const handlePageInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPageInputValue(e.target.value);
    },
    []
  );

  const handlePageInputBlur = useCallback(() => {
    const parsed = parseInt(pageInputValue, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= numPages) {
      setCurrentPage(parsed);
    } else {
      setPageInputValue(String(currentPage));
    }
  }, [pageInputValue, currentPage, numPages]);

  const handlePageInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        (e.target as HTMLInputElement).blur();
      }
    },
    []
  );

  // ── Zoom ──────────────────────────────────────────────────────────────────

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX_ZOOM, parseFloat((z + ZOOM_STEP).toFixed(1))));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, parseFloat((z - ZOOM_STEP).toFixed(1))));
  }, []);

  const fitToWidth = useCallback(() => {
    if (!containerRef.current) {
      setZoom(DEFAULT_ZOOM);
      return;
    }
    // The Page component renders at 612px (letter width) at scale=1.
    // We calculate the zoom needed to fill the container width.
    const containerWidth = containerRef.current.clientWidth - 32; // subtract padding
    const basePageWidth = 612;
    const newZoom = parseFloat((containerWidth / basePageWidth).toFixed(2));
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom)));
  }, []);

  // ── Download ──────────────────────────────────────────────────────────────

  const handleDownload = useCallback(() => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  }, [url, filename]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert
          severity="error"
          action={
            <Button
              size="small"
              onClick={() => {
                setLoadError(null);
                setIsLoading(true);
              }}
            >
              Retry
            </Button>
          }
        >
          Could not load PDF: {loadError}
        </Alert>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.100",
      }}
    >
      {/* ── Toolbar ── */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1.5,
          py: 0.75,
          bgcolor: "background.paper",
          borderBottom: `1px solid ${theme.palette.divider}`,
          flexWrap: "wrap",
        }}
      >
        {/* Navigation */}
        <Tooltip title="Previous page">
          <span>
            <IconButton
              size="small"
              onClick={goToPrev}
              disabled={currentPage <= 1 || isLoading}
            >
              <PrevIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <TextField
            size="small"
            value={pageInputValue}
            onChange={handlePageInputChange}
            onBlur={handlePageInputBlur}
            onKeyDown={handlePageInputKeyDown}
            disabled={isLoading || numPages === 0}
            inputProps={{
              style: { textAlign: "center", width: 36, padding: "2px 4px" },
              "aria-label": "Page number",
            }}
            sx={{ "& .MuiOutlinedInput-root": { height: 28 } }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            / {numPages || "—"}
          </Typography>
        </Box>

        <Tooltip title="Next page">
          <span>
            <IconButton
              size="small"
              onClick={goToNext}
              disabled={currentPage >= numPages || isLoading}
            >
              <NextIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        {/* Zoom */}
        <Tooltip title="Zoom out">
          <span>
            <IconButton size="small" onClick={zoomOut} disabled={zoom <= MIN_ZOOM || isLoading}>
              <ZoomOutIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Typography variant="caption" sx={{ minWidth: 36, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </Typography>

        <Tooltip title="Zoom in">
          <span>
            <IconButton size="small" onClick={zoomIn} disabled={zoom >= MAX_ZOOM || isLoading}>
              <ZoomInIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Fit to width">
          <span>
            <IconButton size="small" onClick={fitToWidth} disabled={isLoading}>
              <FitIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Box sx={{ width: 8 }} />

        <Tooltip title="Download PDF">
          <IconButton size="small" onClick={handleDownload}>
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* ── PDF canvas area ── */}
      <Box
        ref={containerRef}
        sx={{
          overflowY: "auto",
          overflowX: "auto",
          maxHeight,
          display: "flex",
          justifyContent: "center",
          p: 2,
          position: "relative",
        }}
      >
        {isLoading && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "background.default",
              zIndex: 1,
            }}
          >
            <CircularProgress size={40} />
          </Box>
        )}

        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={null} // we handle loading state ourselves
        >
          <Page
            pageNumber={currentPage}
            scale={zoom}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            loading={null}
          />
        </Document>
      </Box>
    </Box>
  );
};

export default PdfViewer;
