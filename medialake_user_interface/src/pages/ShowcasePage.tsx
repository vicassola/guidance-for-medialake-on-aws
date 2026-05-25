import React, { useState } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Avatar,
  Button,
  TextField,
  MenuItem,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  LinearProgress,
  Stack,
  Divider,
  IconButton,
  Tooltip,
  Alert,
  useTheme,
} from "@mui/material";
import {
  TrendingUp,
  CloudUpload,
  Speed,
  CheckCircle,
  Warning,
  Error as ErrorIcon,
  MoreVert,
  Refresh,
} from "@mui/icons-material";

type Status = "active" | "pending" | "failed";

const mockStats = [
  { label: "Total Assets", value: "12,438", delta: "+8.2%", icon: <CloudUpload /> },
  { label: "Active Pipelines", value: "27", delta: "+3", icon: <Speed /> },
  { label: "Processed Today", value: "1,204", delta: "+12.5%", icon: <TrendingUp /> },
  { label: "Success Rate", value: "98.4%", delta: "+0.3%", icon: <CheckCircle /> },
];

const mockRows: {
  id: string;
  name: string;
  type: string;
  size: string;
  status: Status;
  owner: string;
  progress: number;
}[] = [
  { id: "1", name: "campaign-spring-2026.mp4", type: "Video", size: "1.2 GB", status: "active", owner: "Giovanni N.", progress: 100 },
  { id: "2", name: "product-hero-shot.png", type: "Image", size: "8.4 MB", status: "active", owner: "Marta R.", progress: 100 },
  { id: "3", name: "interview-raw-04.wav", type: "Audio", size: "240 MB", status: "pending", owner: "Alex T.", progress: 64 },
  { id: "4", name: "brand-guidelines.pdf", type: "Document", size: "12 MB", status: "active", owner: "Giovanni N.", progress: 100 },
  { id: "5", name: "drone-footage-uncut.mov", type: "Video", size: "4.8 GB", status: "failed", owner: "Sofia L.", progress: 23 },
];

const statusChip: Record<Status, { color: "success" | "warning" | "error"; icon: React.ReactElement; label: string }> = {
  active: { color: "success", icon: <CheckCircle fontSize="small" />, label: "Active" },
  pending: { color: "warning", icon: <Warning fontSize="small" />, label: "Pending" },
  failed: { color: "error", icon: <ErrorIcon fontSize="small" />, label: "Failed" },
};

const ShowcasePage: React.FC = () => {
  const theme = useTheme();
  const [filter, setFilter] = useState("all");
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const filteredRows = filter === "all" ? mockRows : mockRows.filter((r) => r.status === filter);

  return (
    <Box sx={{ p: 4, maxWidth: 1400, mx: "auto" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={4}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Showcase
          </Typography>
          <Typography variant="body1" color="text.secondary">
            A demo page built with MUI components — no backend, all data is mocked client-side.
          </Typography>
        </Box>
        <Tooltip title="Refresh (does nothing — it's a demo)">
          <IconButton color="primary">
            <Refresh />
          </IconButton>
        </Tooltip>
      </Stack>

      <Alert
        severity="error"
        variant="filled"
        icon={false}
        sx={{ mb: 4, alignItems: "center" }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Chip
            label="DEMO"
            size="small"
            sx={{
              bgcolor: "rgba(255,255,255,0.25)",
              color: "common.white",
              fontWeight: 700,
              letterSpacing: "0.08em",
            }}
          />
          <Typography variant="body2">
            This page is fully mocked — no API calls, no real data. Source: <code>src/pages/ShowcasePage.tsx</code>.
          </Typography>
        </Stack>
      </Alert>

      <Grid container spacing={3} mb={4}>
        {mockStats.map((stat) => (
          <Grid key={stat.label} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
                  <Avatar sx={{ bgcolor: theme.palette.primary.main + "20", color: "primary.main" }}>
                    {stat.icon}
                  </Avatar>
                  <Chip label={stat.delta} size="small" color="success" variant="outlined" />
                </Stack>
                <Typography variant="h5" fontWeight={700}>
                  {stat.value}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {stat.label}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" fontWeight={600}>
                  Recent Assets
                </Typography>
                <TextField
                  select
                  size="small"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  sx={{ minWidth: 160 }}
                >
                  <MenuItem value="all">All statuses</MenuItem>
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="failed">Failed</MenuItem>
                </TextField>
              </Stack>
              <Divider sx={{ mb: 2 }} />
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Size</TableCell>
                    <TableCell>Owner</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Progress</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredRows.map((row) => {
                    const chip = statusChip[row.status];
                    return (
                      <TableRow key={row.id} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>
                            {row.name}
                          </Typography>
                        </TableCell>
                        <TableCell>{row.type}</TableCell>
                        <TableCell>{row.size}</TableCell>
                        <TableCell>{row.owner}</TableCell>
                        <TableCell>
                          <Chip icon={chip.icon} label={chip.label} color={chip.color} size="small" variant="outlined" />
                        </TableCell>
                        <TableCell sx={{ minWidth: 120 }}>
                          <LinearProgress
                            variant="determinate"
                            value={row.progress}
                            color={row.status === "failed" ? "error" : "primary"}
                          />
                        </TableCell>
                        <TableCell>
                          <IconButton size="small">
                            <MoreVert fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Send Feedback
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                A mock form — nothing is sent anywhere.
              </Typography>
              <Stack spacing={2}>
                <TextField label="Subject" size="small" fullWidth defaultValue="Showcase demo" />
                <TextField
                  label="Message"
                  size="small"
                  fullWidth
                  multiline
                  rows={5}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Type something..."
                />
                <Button
                  variant="contained"
                  fullWidth
                  disabled={!feedback.trim()}
                  onClick={() => {
                    setSubmitted(true);
                    setFeedback("");
                    setTimeout(() => setSubmitted(false), 3000);
                  }}
                >
                  Submit
                </Button>
                {submitted && (
                  <Alert severity="success" variant="outlined">
                    Thanks! (not actually sent)
                  </Alert>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ShowcasePage;
