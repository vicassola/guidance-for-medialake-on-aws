import React, { useState, useRef } from "react";
import {
  Box,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Stack,
  Collapse,
  Table,
  TableBody,
  TableRow,
  TableCell,
  LinearProgress,
  TextField,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  CheckCircle,
  Cancel,
  ExpandMore,
  ExpandLess,
  Videocam,
  Image as ImageIcon,
  AudioFile,
  Description,
  TaskAlt,
  Edit as EditIcon,
} from "@mui/icons-material";

type FieldStatus = "pending" | "approved" | "rejected";

type ReviewField = {
  id: string;
  label: string;
  value: string | string[];
  confidence: number;
  status: FieldStatus;
};

type ReviewItem = {
  id: string;
  name: string;
  type: "Video" | "Image" | "Audio" | "Document";
  processedAt: string;
  fields: ReviewField[];
};

const initialItems: ReviewItem[] = [
  {
    id: "1",
    name: "dr-house-s05e12.mp4",
    type: "Video",
    processedAt: "2026-05-25T09:14:00Z",
    fields: [
      { id: "1-1", label: "Genre", value: "Medical drama", confidence: 0.94, status: "pending" },
      { id: "1-2", label: "Tags", value: ["hospital", "procedural", "mystery", "medicine"], confidence: 0.87, status: "pending" },
      { id: "1-3", label: "Content Rating", value: "TV-14", confidence: 0.99, status: "pending" },
      { id: "1-4", label: "Language", value: "English", confidence: 0.99, status: "pending" },
      { id: "1-5", label: "Key Persons", value: ["Hugh Laurie", "Lisa Edelstein", "Omar Epps"], confidence: 0.91, status: "pending" },
    ],
  },
  {
    id: "2",
    name: "breaking-news-italia.mp4",
    type: "Video",
    processedAt: "2026-05-25T08:30:00Z",
    fields: [
      { id: "2-1", label: "Category", value: "News", confidence: 0.98, status: "pending" },
      { id: "2-2", label: "Sentiment", value: "Negative", confidence: 0.76, status: "pending" },
      { id: "2-3", label: "Language", value: "Italian", confidence: 0.99, status: "pending" },
      { id: "2-4", label: "Location", value: "Rome, Italy", confidence: 0.82, status: "pending" },
    ],
  },
  {
    id: "3",
    name: "product-hero-shot.png",
    type: "Image",
    processedAt: "2026-05-25T07:55:00Z",
    fields: [
      { id: "3-1", label: "Style", value: "Commercial photography", confidence: 0.88, status: "pending" },
      { id: "3-2", label: "Color Palette", value: ["#1A2B4C", "#F5F5F5", "#E63946"], confidence: 0.79, status: "pending" },
      { id: "3-3", label: "Subject", value: "Consumer product", confidence: 0.93, status: "pending" },
    ],
  },
  {
    id: "4",
    name: "podcast-ep42.mp3",
    type: "Audio",
    processedAt: "2026-05-25T07:10:00Z",
    fields: [
      { id: "4-1", label: "Genre", value: "Technology", confidence: 0.91, status: "pending" },
      { id: "4-2", label: "Speakers", value: ["Giovanni N.", "Marta R."], confidence: 0.84, status: "pending" },
      { id: "4-3", label: "Topics", value: ["AI", "media management", "automation"], confidence: 0.89, status: "pending" },
    ],
  },
  {
    id: "5",
    name: "brand-guidelines.pdf",
    type: "Document",
    processedAt: "2026-05-24T16:00:00Z",
    fields: [
      { id: "5-1", label: "Category", value: "Brand identity", confidence: 0.97, status: "approved" },
      { id: "5-2", label: "Language", value: "English", confidence: 0.99, status: "approved" },
      { id: "5-3", label: "Tags", value: ["branding", "guidelines", "design system"], confidence: 0.95, status: "approved" },
    ],
  },
];

const typeIcon: Record<ReviewItem["type"], React.ReactElement> = {
  Video: <Videocam fontSize="small" />,
  Image: <ImageIcon fontSize="small" />,
  Audio: <AudioFile fontSize="small" />,
  Document: <Description fontSize="small" />,
};

const typeColor: Record<ReviewItem["type"], string> = {
  Video: "primary",
  Image: "secondary",
  Audio: "warning",
  Document: "default",
};

function itemSummary(fields: ReviewField[]) {
  const pending = fields.filter((f) => f.status === "pending").length;
  const total = fields.length;
  return { pending, total, complete: pending === 0 };
}

function formatProcessedAt(iso: string) {
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ReviewPage: React.FC = () => {
  const theme = useTheme();
  const [items, setItems] = useState<ReviewItem[]>(initialItems);
  const [expandedId, setExpandedId] = useState<string | null>("1");
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (field: ReviewField) => {
    setEditingFieldId(field.id);
    setDraftValue(Array.isArray(field.value) ? field.value.join(", ") : field.value);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitEdit = (itemId: string, fieldId: string, isArray: boolean) => {
    const trimmed = draftValue.trim();
    if (trimmed) {
      const newValue: string | string[] = isArray
        ? trimmed.split(",").map((v) => v.trim()).filter(Boolean)
        : trimmed;
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? { ...item, fields: item.fields.map((f) => (f.id === fieldId ? { ...f, value: newValue } : f)) }
            : item
        )
      );
    }
    setEditingFieldId(null);
  };

  const setFieldStatus = (itemId: string, fieldId: string, status: FieldStatus) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, fields: item.fields.map((f) => (f.id === fieldId ? { ...f, status } : f)) }
          : item
      )
    );
  };

  const totalPending = items.reduce((acc, item) => acc + itemSummary(item.fields).pending, 0);
  const itemsPending = items.filter((item) => !itemSummary(item.fields).complete).length;

  return (
    <Box sx={{ p: 4, maxWidth: 1100, mx: "auto" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Review
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {itemsPending > 0
              ? `${itemsPending} asset in attesa di revisione · ${totalPending} campi da approvare`
              : "Tutti gli asset sono stati revisionati."}
          </Typography>
        </Box>
      </Stack>

      <Box
        sx={{
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        {items.map((item, idx) => {
          const { pending, total, complete } = itemSummary(item.fields);
          const reviewed = total - pending;
          const isExpanded = expandedId === item.id;

          return (
            <Box
              key={item.id}
              sx={{
                borderBottom:
                  idx < items.length - 1 ? `1px solid ${theme.palette.divider}` : "none",
              }}
            >
              {/* Row header */}
              <Stack
                direction="row"
                alignItems="center"
                spacing={2}
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                sx={{
                  px: 3,
                  py: 2,
                  cursor: "pointer",
                  bgcolor: isExpanded
                    ? alpha(theme.palette.primary.main, 0.04)
                    : "background.paper",
                  "&:hover": {
                    bgcolor: alpha(theme.palette.primary.main, 0.06),
                  },
                  transition: "background-color 0.15s",
                }}
              >
                {/* Expand icon */}
                <Box sx={{ color: "text.secondary", display: "flex" }}>
                  {isExpanded ? <ExpandLess /> : <ExpandMore />}
                </Box>

                {/* Asset type chip */}
                <Chip
                  icon={typeIcon[item.type]}
                  label={item.type}
                  size="small"
                  color={typeColor[item.type] as any}
                  variant="outlined"
                  sx={{ minWidth: 90 }}
                />

                {/* Name */}
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{ flex: 1, fontFamily: "monospace" }}
                >
                  {item.name}
                </Typography>

                {/* Processed at */}
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                  {formatProcessedAt(item.processedAt)}
                </Typography>

                {/* Status */}
                {complete ? (
                  <Chip
                    icon={<TaskAlt fontSize="small" />}
                    label="Completo"
                    size="small"
                    color="success"
                    variant="outlined"
                    sx={{ minWidth: 100 }}
                  />
                ) : (
                  <Box sx={{ minWidth: 160 }}>
                    <Stack direction="row" justifyContent="space-between" mb={0.5}>
                      <Typography variant="caption" color="text.secondary">
                        {reviewed}/{total} revisionati
                      </Typography>
                      <Typography variant="caption" color="warning.main" fontWeight={600}>
                        {pending} in attesa
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={(reviewed / total) * 100}
                      color="warning"
                      sx={{ height: 4, borderRadius: 2 }}
                    />
                  </Box>
                )}
              </Stack>

              {/* Expanded detail */}
              <Collapse in={isExpanded} unmountOnExit>
                <Box
                  sx={{
                    px: 3,
                    pb: 2,
                    pt: 1,
                    bgcolor: alpha(theme.palette.background.default, 0.5),
                    borderTop: `1px solid ${theme.palette.divider}`,
                  }}
                >
                  <Table size="small">
                    <TableBody>
                      {item.fields.map((field) => {
                        const isApproved = field.status === "approved";
                        const isRejected = field.status === "rejected";

                        return (
                          <TableRow
                            key={field.id}
                            sx={{
                              bgcolor: isApproved
                                ? alpha(theme.palette.success.main, 0.07)
                                : isRejected
                                ? alpha(theme.palette.error.main, 0.07)
                                : "transparent",
                              "&:last-child td": { border: 0 },
                              transition: "background-color 0.2s",
                            }}
                          >
                            {/* Label */}
                            <TableCell sx={{ width: 160, fontWeight: 600, color: "text.secondary" }}>
                              {field.label}
                            </TableCell>

                            {/* Value */}
                            <TableCell sx={{ flex: 1 }}>
                              {editingFieldId === field.id ? (
                                <TextField
                                  inputRef={inputRef}
                                  size="small"
                                  fullWidth
                                  value={draftValue}
                                  onChange={(e) => setDraftValue(e.target.value)}
                                  onBlur={() => commitEdit(item.id, field.id, Array.isArray(field.value))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitEdit(item.id, field.id, Array.isArray(field.value));
                                    if (e.key === "Escape") setEditingFieldId(null);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  helperText={Array.isArray(field.value) ? "Valori separati da virgola" : undefined}
                                  sx={{ "& .MuiInputBase-root": { fontSize: "0.875rem" } }}
                                />
                              ) : Array.isArray(field.value) ? (
                                <Stack direction="row" flexWrap="wrap" gap={0.5} alignItems="center">
                                  {field.value.map((v) => (
                                    <Chip
                                      key={v}
                                      label={v}
                                      size="small"
                                      sx={{
                                        textDecoration: isRejected ? "line-through" : "none",
                                        opacity: isRejected ? 0.6 : 1,
                                      }}
                                    />
                                  ))}
                                  {field.status === "pending" && (
                                    <Tooltip title="Modifica">
                                      <IconButton
                                        size="small"
                                        onClick={(e) => { e.stopPropagation(); startEdit(field); }}
                                        sx={{ color: "text.disabled", "&:hover": { color: "text.primary" } }}
                                      >
                                        <EditIcon sx={{ fontSize: 14 }} />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                </Stack>
                              ) : (
                                <Stack direction="row" alignItems="center" gap={0.5}>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      textDecoration: isRejected ? "line-through" : "none",
                                      opacity: isRejected ? 0.6 : 1,
                                    }}
                                  >
                                    {field.value}
                                  </Typography>
                                  {field.status === "pending" && (
                                    <Tooltip title="Modifica">
                                      <IconButton
                                        size="small"
                                        onClick={(e) => { e.stopPropagation(); startEdit(field); }}
                                        sx={{ color: "text.disabled", "&:hover": { color: "text.primary" } }}
                                      >
                                        <EditIcon sx={{ fontSize: 14 }} />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                </Stack>
                              )}
                            </TableCell>

                            {/* Confidence */}
                            <TableCell sx={{ width: 60, textAlign: "right" }}>
                              <Typography
                                variant="caption"
                                color={
                                  field.confidence >= 0.9
                                    ? "success.main"
                                    : field.confidence >= 0.75
                                    ? "warning.main"
                                    : "error.main"
                                }
                                fontWeight={600}
                              >
                                {Math.round(field.confidence * 100)}%
                              </Typography>
                            </TableCell>

                            {/* Actions */}
                            <TableCell sx={{ width: 96, textAlign: "right" }}>
                              <Tooltip title="Approva">
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFieldStatus(
                                      item.id,
                                      field.id,
                                      isApproved ? "pending" : "approved"
                                    );
                                  }}
                                  sx={{
                                    color: isApproved
                                      ? "success.main"
                                      : alpha(theme.palette.success.main, 0.35),
                                    "&:hover": { color: "success.main" },
                                  }}
                                >
                                  <CheckCircle fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Rifiuta">
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFieldStatus(
                                      item.id,
                                      field.id,
                                      isRejected ? "pending" : "rejected"
                                    );
                                  }}
                                  sx={{
                                    color: isRejected
                                      ? "error.main"
                                      : alpha(theme.palette.error.main, 0.35),
                                    "&:hover": { color: "error.main" },
                                  }}
                                >
                                  <Cancel fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default ReviewPage;
