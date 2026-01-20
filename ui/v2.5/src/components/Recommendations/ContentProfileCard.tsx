import React, { useState } from 'react';
import { Card, CardHeader, CardContent, Button, Divider, Typography, Chip, Avatar, Tooltip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { Refresh, HelpOutline } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { useContentProfileQuery, useRebuildContentProfileMutation } from '../../core/generated-graphql';
import { LoadingIndicator } from '../Shared/LoadingIndicator';
import { AlertModal as Alert } from '../Shared/Alert';

export const ContentProfileCard: React.FC = () => {
    const { data, loading, error, refetch } = useContentProfileQuery();
    const [rebuildProfile, { loading: rebuilding }] = useRebuildContentProfileMutation();
    const [showInfo, setShowInfo] = useState(false);

    const handleRebuild = async () => {
        try {
            await rebuildProfile();
            refetch();
        } catch (e) {
            console.error(e);
        }
    };

    if (loading) return <LoadingIndicator />;
    if (error) return <Alert text={error.message} show onConfirm={() => { }} onCancel={() => { }} />;

    const profile = data?.userContentProfile;
    if (!profile) return <Alert text="No content profile found. Click rebuild to generate." show onConfirm={() => { }} onCancel={() => { }} />;

    return (
        <Card className="content-profile-card">
            <CardHeader
                title="Content Profile"
                subheader={`Last updated: ${new Date(profile.updated_at).toLocaleDateString()}`}
                action={
                    <div className="profile-action-container">
                        <IconButton
                            onClick={() => setShowInfo(true)}
                            size="small"
                        >
                            <HelpOutline />
                        </IconButton>
                        <Button
                            startIcon={<Refresh />}
                            onClick={handleRebuild}
                            disabled={rebuilding}
                            variant="outlined"
                            size="small"
                        >
                            {rebuilding ? 'Rebuilding...' : 'Rebuild'}
                        </Button>
                    </div>
                }
            />
            <Divider />
            <CardContent>
                <div className="profile-section">
                    <Typography variant="subtitle2" gutterBottom>Top Tags</Typography>
                    <div className="tags-container profile-tags-container">
                        {profile.topTags.map((t) => (
                            <Link key={t.tag.id} to={`/tags/${t.tag.id}`} className="profile-link">
                                <Tooltip title={`Weight: ${t.weight.toFixed(2)}`}>
                                    <Chip label={t.tag.name} size="small" clickable />
                                </Tooltip>
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="profile-section">
                    <Typography variant="subtitle2" gutterBottom>Top Performers</Typography>
                    <div className="performers-container profile-performers-container">
                        {profile.topPerformers.map((p) => (
                            <Link key={p.performer.id} to={`/performers/${p.performer.id}`}>
                                <Tooltip title={`${p.performer.name} (${p.weight.toFixed(2)})`}>
                                    <Avatar
                                        src={p.performer.image_path || undefined}
                                        alt={p.performer.name}
                                        className="profile-performer-avatar"
                                    />
                                </Tooltip>
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="profile-section">
                    <Typography variant="subtitle2" gutterBottom>Top Studios</Typography>
                    <div className="studios-container profile-studios-container">
                        {profile.topStudios.map((s) => (
                            <Link key={s.studio.id} to={`/studios/${s.studio.id}`}>
                                <Tooltip title={`${s.studio.name} (${s.weight.toFixed(2)})`}>
                                    <Avatar
                                        src={s.studio.image_path || undefined}
                                        alt={s.studio.name}
                                        variant="rounded"
                                        className="profile-studio-avatar"
                                    />
                                </Tooltip>
                            </Link>
                        ))}
                    </div>
                </div>
            </CardContent>

            <Dialog open={showInfo} onClose={() => setShowInfo(false)} maxWidth="sm">
                <DialogTitle>How Recommendations Work</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="h6" gutterBottom>Generation</Typography>
                    <Typography paragraph variant="body2">
                        Your Content Profile is built by analyzing your local library usage. It looks at your most watched scenes, highest rated content, and recurring tags/performers to build a "fingerprint" of your preferences.
                    </Typography>

                    <Typography variant="h6" gutterBottom>Tuning Weights</Typography>
                    <Typography paragraph variant="body2">
                        The sliders on the dashboard allow you to control how much influence each factor has:
                        <ul>
                            <li><strong>Tags:</strong> Prioritizes content matching your top tags (e.g., "Blonde", "Outdoor").</li>
                            <li><strong>Performers:</strong> Prioritizes your favorite performers.</li>
                            <li><strong>Studios:</strong> Prioritizes content from your preferred studios.</li>
                        </ul>
                    </Typography>

                    <Typography variant="h6" gutterBottom>Scoring Logic</Typography>
                    <Typography variant="subtitle2">Scene Recommendations</Typography>
                    <Typography paragraph variant="body2">
                        Score = (Visual Match % × .50) + (Profile Affinity % × .50)
                        <br />
                        <span className="scoring-logic-note">Combines how well the scene matches your tags/performers with your historical preference for that studio/category.</span>
                    </Typography>
                    <Typography variant="subtitle2">Performer Recommendations</Typography>
                    <Typography paragraph variant="body2">
                        Score = (History % × Weight) + (Attribute Match % × (1 - Weight))
                        <br />
                        <span className="scoring-logic-note">
                            <strong>Local Performers:</strong> Balances your Viewing History (Favorites) with Attribute Matching (Lookalikes).
                            <br />
                            <strong>Visual Match:</strong> Ignores history and finds performers who strictly match your physical preference (Hair, Eyes, Ethnicity).
                        </span>
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowInfo(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </Card>
    );
};
