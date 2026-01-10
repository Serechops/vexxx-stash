import React, { useState, useEffect } from "react";
import { Form, Row, Col, Nav, Tab } from "react-bootstrap";

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
            setDailyTime(`${dailyMatch[2].padStart(2, '0')}:${dailyMatch[1].padStart(2, '0')}`);
            return;
        }

        // Check if weekly (0 MIN HOUR * * DAY)
        const weeklyMatch = value.match(/^0 (\d+) (\d+) \* \* (\d+)$/);
        if (weeklyMatch) {
            setActiveTab("weekly");
            setWeeklyTime(`${weeklyMatch[2].padStart(2, '0')}:${weeklyMatch[1].padStart(2, '0')}`);
            setWeeklyDay(parseInt(weeklyMatch[3]));
            return;
        }

        // Default to advanced/current if not matched
    }, []);

    const handlePresetChange = (e: React.ChangeEvent<any>) => {
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
            <Tab.Container activeKey={activeTab} onSelect={(k) => setActiveTab(k || "advanced")}>
                <Nav variant="tabs" className="mb-3">
                    <Nav.Item>
                        <Nav.Link eventKey="presets">Presets</Nav.Link>
                    </Nav.Item>
                    <Nav.Item>
                        <Nav.Link eventKey="interval">Interval</Nav.Link>
                    </Nav.Item>
                    <Nav.Item>
                        <Nav.Link eventKey="daily">Daily</Nav.Link>
                    </Nav.Item>
                    <Nav.Item>
                        <Nav.Link eventKey="weekly">Weekly</Nav.Link>
                    </Nav.Item>
                    <Nav.Item>
                        <Nav.Link eventKey="advanced">Advanced</Nav.Link>
                    </Nav.Item>
                </Nav>

                <Tab.Content>
                    <Tab.Pane eventKey="presets">
                        <Form.Group>
                            <Form.Label>Frequency</Form.Label>
                            <Form.Control as="select" value={value} onChange={handlePresetChange}>
                                <option value="">Select a preset...</option>
                                {PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {p.label}
                                    </option>
                                ))}
                            </Form.Control>
                        </Form.Group>
                    </Tab.Pane>

                    <Tab.Pane eventKey="interval">
                        <Form.Group>
                            <Form.Label>Run every X minutes</Form.Label>
                            <Form.Group as={Row} className="align-items-center">
                                <Col xs="auto">
                                    <Form.Label className="visually-hidden">Minutes</Form.Label>
                                    Every
                                </Col>
                                <Col xs={3}>
                                    <Form.Control
                                        type="number"
                                        min="1"
                                        value={intervalMinutes}
                                        onChange={(e) => updateInterval(parseInt(e.target.value) || 1)}
                                    />
                                </Col>
                                <Col xs="auto">
                                    minutes
                                </Col>
                            </Form.Group>
                            <Form.Text className="text-muted">
                                Task will run at 0 seconds past every {intervalMinutes}th minute.
                            </Form.Text>
                        </Form.Group>
                    </Tab.Pane>

                    <Tab.Pane eventKey="daily">
                        <Form.Group>
                            <Form.Label>Time of Day</Form.Label>
                            <Form.Control
                                type="time"
                                value={dailyTime}
                                onChange={(e) => updateDaily(e.target.value)}
                            />
                        </Form.Group>
                    </Tab.Pane>

                    <Tab.Pane eventKey="weekly">
                        <Row>
                            <Col>
                                <Form.Group>
                                    <Form.Label>Day of Week</Form.Label>
                                    <Form.Control
                                        as="select"
                                        value={weeklyDay}
                                        onChange={(e) => updateWeekly(parseInt(e.target.value), weeklyTime)}
                                    >
                                        {DAYS.map(d => (
                                            <option key={d.value} value={d.value}>{d.label}</option>
                                        ))}
                                    </Form.Control>
                                </Form.Group>
                            </Col>
                            <Col>
                                <Form.Group>
                                    <Form.Label>Time</Form.Label>
                                    <Form.Control
                                        type="time"
                                        value={weeklyTime}
                                        onChange={(e) => updateWeekly(weeklyDay, e.target.value)}
                                    />
                                </Form.Group>
                            </Col>
                        </Row>
                    </Tab.Pane>

                    <Tab.Pane eventKey="advanced">
                        <Form.Group>
                            <Form.Label>Cron Expression</Form.Label>
                            <Form.Control
                                type="text"
                                value={value}
                                onChange={(e) => onChange(e.target.value)}
                                placeholder="0 0 3 * * *"
                            />
                            <Form.Text className="text-muted">
                                Format: Seconds Minutes Hours DayOfMonth Month DayOfWeek
                            </Form.Text>
                        </Form.Group>
                    </Tab.Pane>
                </Tab.Content>
            </Tab.Container>

            {activeTab !== "advanced" && (
                <div className="mt-2">
                    <small className="text-muted">Resulting Cron: <code>{value}</code></small>
                </div>
            )}
        </div>
    );
};
