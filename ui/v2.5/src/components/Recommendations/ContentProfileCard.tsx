import React from 'react';
import { Card, CardHeader, CardContent, Button, Divider, Typography, Chip, Avatar, Tooltip } from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { useContentProfileQuery, useRebuildContentProfileMutation } from '../../core/generated-graphql';
import { LoadingIndicator } from '../Shared/LoadingIndicator';
import { AlertModal as Alert } from '../Shared/Alert';

export const ContentProfileCard: React.FC = () => {
    const { data, loading, error, refetch } = useContentProfileQuery();
    const [rebuildProfile, { loading: rebuilding }] = useRebuildContentProfileMutation();

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
                    <Button
                        startIcon={<Refresh />}
                        onClick={handleRebuild}
                        disabled={rebuilding}
                        variant="outlined"
                        size="small"
                    >
                        {rebuilding ? 'Rebuilding...' : 'Rebuild'}
                    </Button>
                }
            />
            <Divider />
            <CardContent>
                <div className="profile-section">
                    <Typography variant="subtitle2" gutterBottom>Top Tags</Typography>
                    <div className="tags-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                        {profile.topTags.map((t) => (
                            <Link key={t.tag.id} to={`/tags/${t.tag.id}`} style={{ textDecoration: 'none' }}>
                                <Tooltip title={`Weight: ${t.weight.toFixed(2)}`}>
                                    <Chip label={t.tag.name} size="small" clickable />
                                </Tooltip>
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="profile-section">
                    <Typography variant="subtitle2" gutterBottom>Top Performers</Typography>
                    <div className="performers-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                        {profile.topPerformers.map((p) => (
                            <Link key={p.performer.id} to={`/performers/${p.performer.id}`}>
                                <Tooltip title={`${p.performer.name} (${p.weight.toFixed(2)})`}>
                                    <Avatar
                                        src={p.performer.image_path || undefined}
                                        alt={p.performer.name}
                                        sx={{ width: 64, height: 64 }}
                                    />
                                </Tooltip>
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="profile-section">
                    <Typography variant="subtitle2" gutterBottom>Top Studios</Typography>
                    <div className="studios-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {profile.topStudios.map((s) => (
                            <Link key={s.studio.id} to={`/studios/${s.studio.id}`}>
                                <Tooltip title={`${s.studio.name} (${s.weight.toFixed(2)})`}>
                                    <Avatar
                                        src={s.studio.image_path || undefined}
                                        alt={s.studio.name}
                                        variant="rounded"
                                        sx={{ width: 80, height: 60 }}
                                        imgProps={{ style: { objectFit: 'contain' } }}
                                    />
                                </Tooltip>
                            </Link>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
