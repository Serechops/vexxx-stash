import React, { useState, useEffect } from "react";
import {
    Box,
    FormControl,
    FormHelperText,
    InputLabel,
    MenuItem,
    Select,
    Tab,
    Tabs,
    TextField,
    Typography,
    Grid
} from "@mui/material";

interface CronInputProps {
    value: string;
    onChange: (value: string) => void;
}

const PRESETS = [
    { label: "Every Hour", value: "0 0 * * * *" },
    { label: "Every 6 Hours", value: "0 0 */6 * * *" },
    { label: "Every 12 Hours", value: "0 0 */12 * * *" },
    { label: "Daily at Midnight", value: "0 0 0 * * *" },
    { label: "Daily at 3 AM", value: "0 0 3 * * *" },
    { label: "Weekly (Sunday at Midnight)", value: "0 0 0 * * 0" },
    { label: "Monthly (1st at Midnight)", value: "0 0 0 1 * *" },
];

const DAYS = [
    { value: 0, label: "Sunday" },
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
];

export const CronInput: React.FC<CronInputProps> = ({ value, onChange }) => {
    const [activeTab, setActiveTab] = useState<string>("presets");

    // Interval state
    const [intervalMinutes, setIntervalMinutes] = useState(60);

    // Daily state
    const [dailyTime, setDailyTime] = useState("03:00");

    // Weekly state
    const [weeklyDay, setWeeklyDay] = useState(0);
    const [weeklyTime, setWeeklyTime] = useState("03:00");

    useEffect(() => {
        // Attempt to detect mode from value
        const preset = PRESETS.find(p => p.value === value);
        if (preset) {
            setActiveTab("presets");
            return;
        }

        // Check if interval (0 */N * * * *)
        const intervalMatch = value.match(/^0 \*\/(\d+) \* \* \* \*$/);
        if (intervalMatch) {
            setActiveTab("interval");
            setIntervalMinutes(parseInt(intervalMatch[1]));
            return;
        }

        // Check if daily (0 MIN HOUR * * *)
        const dailyMatch = value.match(/^0 (\d+) (\d+) \* \* \*$/);
        if (dailyMatch) {
            setActiveTab("daily");
            setDailyTime(`${dailyMatch[2].padStart(2, '0')}:${dailyMatch[1].padStart(2, '0')} `);
            return;
        }

        // Check if weekly (0 MIN HOUR * * DAY)
        const weeklyMatch = value.match(/^0 (\d+) (\d+) \* \* (\d+)$/);
        if (weeklyMatch) {
            setActiveTab("weekly");
            setWeeklyTime(`${weeklyMatch[2].padStart(2, '0')}:${weeklyMatch[1].padStart(2, '0')} `);
            setWeeklyDay(parseInt(weeklyMatch[3]));
            return;
        }

        // Default to advanced/current if not matched
    }, []);

    const handlePresetChange = (e: any) => {
        onChange(e.target.value);
    };

    const updateInterval = (minutes: number) => {
        if (minutes < 1) minutes = 1;
        setIntervalMinutes(minutes);
        onChange(`0 */${minutes} * * * *`);
    };

    const updateDaily = (time: string) => {
        setDailyTime(time);
        const [optsHour, optsMinute] = time.split(":");
        onChange(`0 ${parseInt(optsMinute)} ${parseInt(optsHour)} * * *`);
    };

    const updateWeekly = (day: number, time: string) => {
        setWeeklyDay(day);
        setWeeklyTime(time);
        const [optsHour, optsMinute] = time.split(":");
        onChange(`0 ${parseInt(optsMinute)} ${parseInt(optsHour)} * * ${day}`);
    };

    return (
        <div className="cron-input">
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} aria-label="cron input tabs">
                    <Tab label="Presets" value="presets" />
                    <Tab label="Interval" value="interval" />
                    <Tab label="Daily" value="daily" />
                    <Tab label="Weekly" value="weekly" />
                    <Tab label="Advanced" value="advanced" />
                </Tabs>
            </Box>

            {activeTab === "presets" && (
                <FormControl fullWidth variant="outlined">
                    <InputLabel id="preset-label">Frequency</InputLabel>
                    <Select
                        labelId="preset-label"
                        value={value}
                        onChange={handlePresetChange}
                        label="Frequency"
                        native={false}
                    >
                        <MenuItem value=""><em>Select a preset...</em></MenuItem>
                        {PRESETS.map((p) => (
                            <MenuItem key={p.value} value={p.value}>
                                {p.label}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            )}

            {activeTab === "interval" && (
                <Box>
                    <Typography variant="subtitle2" gutterBottom>Run every X minutes</Typography>
                    <Grid container spacing={2} alignItems="center">
                        <Grid>
                            <Typography>Every</Typography>
                        </Grid>
                        <Grid size={{ xs: 3 }}>
                            <TextField
                                type="number"
                                variant="outlined"
                                size="small"
                                inputProps={{ min: 1 }}
                                value={intervalMinutes}
                                onChange={(e) => updateInterval(parseInt(e.target.value) || 1)}
                            />
                        </Grid>
                        <Grid>
                            <Typography>minutes</Typography>
                        </Grid>
                    </Grid>
                    <FormHelperText>
                        Task will run at 0 seconds past every {intervalMinutes}th minute.
                    </FormHelperText>
                </Box>
            )}

            {activeTab === "daily" && (
                <FormControl component="fieldset">
                    <Typography variant="subtitle2" gutterBottom>Time of Day</Typography>
                    <TextField
                        type="time"
                        variant="outlined"
                        value={dailyTime}
                        onChange={(e) => updateDaily(e.target.value)}
                    />
                </FormControl>
            )}

            {activeTab === "weekly" && (
                <Grid container spacing={2}>
                    <Grid size={{ xs: 6 }}>
                        <FormControl fullWidth variant="outlined">
                            <InputLabel id="dow-label">Day of Week</InputLabel>
                            <Select
                                labelId="dow-label"
                                value={weeklyDay}
                                onChange={(e) => updateWeekly(e.target.value as number, weeklyTime)}
                                label="Day of Week"
                            >
                                {DAYS.map(d => (
                                    <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                        <TextField
                            fullWidth
                            label="Time"
                            type="time"
                            variant="outlined"
                            value={weeklyTime}
                            onChange={(e) => updateWeekly(weeklyDay, e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Grid>
                </Grid>
            )}

            {activeTab === "advanced" && (
                <Box>
                    <TextField
                        fullWidth
                        label="Cron Expression"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="0 0 3 * * *"
                        helperText="Format: Seconds Minutes Hours DayOfMonth Month DayOfWeek"
                    />
                </Box>
            )}

            {activeTab !== "advanced" && (
                <Box mt={2}>
                    <Typography variant="caption" color="textSecondary">
                        Resulting Cron: <code>{value}</code>
                    </Typography>
                </Box>
            )}
        </div>
    );
};
