import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { Icon } from "../Shared/Icon";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { SettingSection } from "./SettingSection";
import { Setting } from "./Inputs";
import { useSettings } from "./context";
import {
  faCopy,
  faExclamationTriangle,
  faGlobe,
  faPlay,
  faStop,
  faSyncAlt,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";

interface TunnelStatus {
  running: boolean;
  url: string | null;
  error?: string | null;
}

async function fetchTunnelStatus(): Promise<TunnelStatus> {
  const res = await fetch("/deovr/tunnel/status");
  if (!res.ok) {
    throw new Error(`Failed to fetch tunnel status: ${res.statusText}`);
  }
  return res.json();
}

async function startTunnel(subdomain?: string, localHost?: string): Promise<TunnelStatus> {
  const params = new URLSearchParams();
  if (subdomain) params.set("subdomain", subdomain);
  if (localHost) params.set("local_host", localHost);
  const qs = params.toString();
  const url = qs ? `/deovr/tunnel/start?${qs}` : "/deovr/tunnel/start";
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to start tunnel: ${res.statusText}`);
  }
  return res.json();
}

async function stopTunnel(): Promise<TunnelStatus> {
  const res = await fetch("/deovr/tunnel/stop", { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to stop tunnel: ${res.statusText}`);
  }
  return res.json();
}

export const SettingsDeoVRTunnelPanel: React.FC = () => {
  const intl = useIntl();
  const { general } = useSettings();
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subdomain, setSubdomain] = useState<string>("");
  const [localHost, setLocalHost] = useState<string>("");

  const refreshStatus = useCallback(async () => {
    try {
      const s = await fetchTunnelStatus();
      setStatus(s);
      if (s.error) {
        setError(s.error);
      }
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll every 2 seconds whenever the tunnel is running but no URL yet
  useEffect(() => {
    if (!status?.running || status?.url) return;
    const interval = setInterval(refreshStatus, 2000);
    return () => clearInterval(interval);
  }, [status?.running, status?.url, refreshStatus]);

  // Initial load
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleStart = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const result = await startTunnel(subdomain || undefined, localHost || undefined);
      if ("error" in result && result.error) {
        setError(result.error);
      }
      // Will trigger the polling effect above
      setStatus(result);
    } catch (e: any) {
      setError(e.message ?? "Failed to start tunnel");
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const s = await stopTunnel();
      setStatus(s);
    } catch (e: any) {
      setError(e.message ?? "Failed to stop tunnel");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !status) {
    return <LoadingIndicator />;
  }

  return (
    <SettingSection headingID="config.deovr_tunnel.heading">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        <FormattedMessage id="config.deovr_tunnel.description" />
      </Typography>

      {/* Security warning — shown when no authentication is configured */}
      {!general?.username && (
        <Alert severity="warning" sx={{ mb: 2 }} icon={<Icon icon={faExclamationTriangle} />}>
          <FormattedMessage id="config.deovr_tunnel.security_warning" />
        </Alert>
      )}

      {/* Node.js requirement notice */}
      <Alert severity="info" sx={{ mb: 2 }}>
        <FormattedMessage id="config.deovr_tunnel.node_requirement" />
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Status card */}
      <Paper
        variant="outlined"
        sx={{
          p: 3,
          mb: 3,
          display: "flex",
          alignItems: "center",
          gap: 2,
          bgcolor: status?.running ? "success.dark" : "background.default",
          borderColor: status?.running ? "success.main" : "divider",
        }}
      >
        <Box
          sx={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            bgcolor: status?.running ? "success.light" : "text.disabled",
            boxShadow: status?.running
              ? "0 0 8px rgba(76, 175, 80, 0.6)"
              : "none",
            flexShrink: 0,
          }}
        />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {status?.running ? (
              <FormattedMessage id="config.deovr_tunnel.status_running" />
            ) : (
              <FormattedMessage id="config.deovr_tunnel.status_stopped" />
            )}
          </Typography>
          {status?.url && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
              <Icon icon={faGlobe} />
              <Typography
                variant="body2"
                component="a"
                href={status.url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ color: "primary.light", wordBreak: "break-all" }}
              >
                {status.url}
              </Typography>
              <Chip
                label={<FormattedMessage id="config.deovr_tunnel.active" />}
                size="small"
                color="success"
              />
            </Box>
          )}
        </Box>
        {actionLoading && <CircularProgress size={24} />}
      </Paper>

      {/* Prominent HTTPS URL display — shown when tunnel is active */}
      {status?.url && (
        <Paper
          variant="outlined"
          sx={{
            p: 3,
            mb: 3,
            bgcolor: "success.dark",
            borderColor: "success.main",
            borderWidth: 2,
            textAlign: "center",
          }}
        >
          <Typography variant="overline" color="success.light" fontWeight={700} letterSpacing={1}>
            <FormattedMessage id="config.deovr_tunnel.your_tunnel_url" />
          </Typography>
          <Box
            sx={{
              mt: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
            }}
          >
            <Typography
              variant="h6"
              component="code"
              sx={{
                color: "#fff",
                fontWeight: 700,
                wordBreak: "break-all",
                fontFamily: "monospace",
                fontSize: "1.1rem",
                bgcolor: "rgba(0,0,0,0.25)",
                px: 2,
                py: 1,
                borderRadius: 1,
                userSelect: "all",
              }}
            >
              {status.url}
            </Typography>
            <Button
              size="small"
              variant="contained"
              color="info"
              sx={{ minWidth: 40, px: 1 }}
              onClick={() => {
                navigator.clipboard.writeText(status.url!);
              }}
            >
              <Icon icon={faCopy} />
            </Button>
          </Box>
          <Typography variant="caption" color="success.light" sx={{ mt: 1, display: "block" }}>
            <FormattedMessage id="config.deovr_tunnel.copy_hint" />
          </Typography>
        </Paper>
      )}

      {/* URL builder — shown when tunnel is stopped */}
      {!status?.running && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
            <FormattedMessage id="config.deovr_tunnel.url_builder_heading" />
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              fullWidth
              size="small"
              label={<FormattedMessage id="config.deovr_tunnel.subdomain_label" />}
              placeholder="my-vr-library"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
              helperText={<FormattedMessage id="config.deovr_tunnel.subdomain_helper" />}
            />
            <TextField
              fullWidth
              size="small"
              label={<FormattedMessage id="config.deovr_tunnel.local_host_label" />}
              placeholder="localhost"
              value={localHost}
              onChange={(e) => setLocalHost(e.target.value)}
              helperText={<FormattedMessage id="config.deovr_tunnel.local_host_helper" />}
            />
          </Box>

          {/* Live URL preview */}
          <Paper
            variant="outlined"
            sx={{
              mt: 2,
              p: 1.5,
              bgcolor: "background.default",
              borderColor: "divider",
              textAlign: "center",
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              <FormattedMessage id="config.deovr_tunnel.preview_label" />
            </Typography>
            <Typography
              variant="body2"
              component="code"
              sx={{
                fontFamily: "monospace",
                fontSize: "0.9rem",
                color: "primary.light",
                wordBreak: "break-all",
                userSelect: "all",
              }}
            >
              {subdomain
                ? `https://${subdomain}.loca.lt`
                : "https://<random>.loca.lt"}
            </Typography>
          </Paper>
        </Paper>
      )}

      <Box sx={{ display: "flex", gap: 2 }}>
        {status?.running ? (
          <Button
            variant="contained"
            color="error"
            startIcon={<Icon icon={faStop} />}
            onClick={handleStop}
            disabled={actionLoading}
          >
            <FormattedMessage id="config.deovr_tunnel.stop_tunnel" />
          </Button>
        ) : (
          <Button
            variant="contained"
            color="success"
            startIcon={<Icon icon={faPlay} />}
            onClick={handleStart}
            disabled={actionLoading}
          >
            <FormattedMessage id="config.deovr_tunnel.start_tunnel" />
          </Button>
        )}
        <Button
          variant="outlined"
          startIcon={<Icon icon={faSyncAlt} />}
          onClick={refreshStatus}
          disabled={loading || actionLoading}
        >
          <FormattedMessage id="actions.refresh" />
        </Button>
      </Box>

      {/* Usage guidance */}
      {status?.url && (
        <SettingSection headingID="config.deovr_tunnel.usage_heading">
          <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: "info.dark", borderColor: "info.main" }}>
            <Typography variant="body2">
              <FormattedMessage id="config.deovr_tunnel.reminder_note" />
            </Typography>
          </Paper>
          <Setting
            heading={
              <FormattedMessage id="config.deovr_tunnel.usage_step1_heading" />
            }
          >
            <FormattedMessage id="config.deovr_tunnel.usage_step1_desc" />
          </Setting>
          <Setting
            heading={
              <FormattedMessage id="config.deovr_tunnel.usage_step2_heading" />
            }
          >
            <FormattedMessage id="config.deovr_tunnel.usage_step2_desc" />
          </Setting>
          <Setting
            heading={
              <FormattedMessage id="config.deovr_tunnel.usage_step3_heading" />
            }
          >
            <FormattedMessage id="config.deovr_tunnel.usage_step3_desc" />
          </Setting>
        </SettingSection>
      )}
    </SettingSection>
  );
};

export default SettingsDeoVRTunnelPanel;