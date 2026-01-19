import React from 'react';
import { Helmet } from 'react-helmet';
import { Container, Grid, Typography, Box, Button, Card, CardHeader, CardContent, Slider } from '@mui/material';
import { FormattedMessage } from 'react-intl';
import RefreshIcon from '@mui/icons-material/Refresh';
import { RecommendationSource, useRebuildContentProfileMutation } from '../../core/generated-graphql';
import { ContentProfileCard } from './ContentProfileCard';
import { RecommendationCarousel } from './RecommendationCarousel';
import { PerformerRecommendationRow } from './PerformerRecommendationRow';
import { useToast } from 'src/hooks/Toast';
import { LoadingIndicator } from 'src/components/Shared/LoadingIndicator';
import { useState } from 'react';

export const DiscoverPage: React.FC = () => {
    const [rebuildProfile, { loading: rebuilding }] = useRebuildContentProfileMutation();
    const Toaster = useToast();

    // Tuning Weights State
    const [tagWeight, setTagWeight] = useState<number>(0.5);
    const [performerWeight, setPerformerWeight] = useState<number>(0.3);
    const [studioWeight, setStudioWeight] = useState<number>(0.2);

    const onRebuild = async () => {
        try {
            await rebuildProfile();
            Toaster.success("Rebuilding profile and scanning StashDB in background...");
        } catch (e) {
            Toaster.error(e);
        }
    };

    return (
        <Box
            sx={{
                bgcolor: "background.default",
                minHeight: "100vh",
                position: "relative",
                width: "100vw",
                marginLeft: "calc(50% - 50vw)",
                marginRight: "calc(50% - 50vw)",
                maxWidth: "none",
                overflowX: "hidden",
                "& > *": { maxWidth: "none" },
            }}
        >
            <Helmet>
                <title>Discover</title>
            </Helmet>

            {/* Content Container for Header & Dashboard */}
            <Box sx={{ px: { xs: 2, md: 6 }, pt: 4 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                    <Typography variant="h4" component="h1" className="text-primary font-bold">
                        <FormattedMessage id="discover your content" defaultMessage="Discover Your Content" />
                    </Typography>
                    <Button
                        variant="contained"
                        onClick={onRebuild}
                        disabled={rebuilding}
                        startIcon={rebuilding ? <LoadingIndicator /> : <RefreshIcon />}
                    >
                        <FormattedMessage id="rebuild_profile" defaultMessage="Refresh Recommendations" />
                    </Button>
                </Box>
                {/* Dashboard Banner */}
                <Box sx={{ mb: 6 }}>
                    <Grid container spacing={3}>
                        {/* Content Profile Summary */}
                        <Grid size={{ xs: 12, md: 6 }}>
                            <ContentProfileCard />
                        </Grid>

                        {/* Tuning Controls */}
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Card sx={{ height: '100%' }}>
                                <CardHeader
                                    title="Recommendation Tuning"
                                    subheader="Adjust how much influence each factor has on your recommendations"
                                />
                                <CardContent>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                        <Box>
                                            <Box display="flex" justifyContent="space-between">
                                                <Typography variant="subtitle2">Tags</Typography>
                                                <Typography variant="caption" color="text.secondary">{(tagWeight * 100).toFixed(0)}%</Typography>
                                            </Box>
                                            <Slider
                                                value={tagWeight}
                                                onChange={(_, v) => setTagWeight(v as number)}
                                                step={0.1}
                                                min={0}
                                                max={1}
                                                marks
                                                valueLabelDisplay="auto"
                                            />
                                        </Box>
                                        <Box>
                                            <Box display="flex" justifyContent="space-between">
                                                <Typography variant="subtitle2">Performers</Typography>
                                                <Typography variant="caption" color="text.secondary">{(performerWeight * 100).toFixed(0)}%</Typography>
                                            </Box>
                                            <Slider
                                                value={performerWeight}
                                                onChange={(_, v) => setPerformerWeight(v as number)}
                                                step={0.1}
                                                min={0}
                                                max={1}
                                                marks
                                                valueLabelDisplay="auto"
                                            />
                                        </Box>
                                        <Box>
                                            <Box display="flex" justifyContent="space-between">
                                                <Typography variant="subtitle2">Studios</Typography>
                                                <Typography variant="caption" color="text.secondary">{(studioWeight * 100).toFixed(0)}%</Typography>
                                            </Box>
                                            <Slider
                                                value={studioWeight}
                                                onChange={(_, v) => setStudioWeight(v as number)}
                                                step={0.1}
                                                min={0}
                                                max={1}
                                                marks
                                                valueLabelDisplay="auto"
                                            />
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>
                </Box>
            </Box>

            {/* Full Width Recommendations */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 6, pb: 8 }}>

                {/* Top Performers (StashDB) */}
                <PerformerRecommendationRow
                    title="Recommended Performers (StashDB - Based on User Weightings)"
                    source={RecommendationSource.Stashdb}
                    limit={20}
                    tagWeight={tagWeight}
                    performerWeight={performerWeight}
                    studioWeight={studioWeight}
                />

                {/* StashDB Visual Match */}
                <PerformerRecommendationRow
                    title="Recommended Performers (StashDB - Visual Match)"
                    source={RecommendationSource.Stashdb}
                    limit={20}
                    tagWeight={tagWeight}
                    performerWeight={0.0} // Suggest Attribute preference
                    studioWeight={studioWeight}
                />

                {/* StashDB Scenes */}
                <RecommendationCarousel
                    title="Recommended Scenes (StashDB - Based on User Weightings)"
                    source={RecommendationSource.Stashdb}
                    limit={40}
                    excludeOwned={true}
                    tagWeight={tagWeight}
                    performerWeight={performerWeight}
                    studioWeight={studioWeight}
                />

                {/* Attribute Match: Performers (Visual Match) */}
                <PerformerRecommendationRow
                    title="Recommended Performers (Local - Visual Match)"
                    limit={20}
                    source={RecommendationSource.Local}
                    tagWeight={tagWeight}
                    performerWeight={0.0} // Force 0.0 to maximize Attribute weight
                    studioWeight={studioWeight}
                />

                {/* Local Gems: Performers (User Controlled) */}
                <PerformerRecommendationRow
                    title="Local Performers (Based on User Weightings)"
                    limit={20}
                    source={RecommendationSource.Local}
                    tagWeight={tagWeight}
                    performerWeight={performerWeight}
                    studioWeight={studioWeight}
                />



                {/* Local Gems: Scenes */}
                <RecommendationCarousel
                    title="Local Scenes (Based on User Weightings)"
                    source={RecommendationSource.Local}
                    limit={40}
                    excludeOwned={false}
                    tagWeight={tagWeight}
                    performerWeight={performerWeight}
                    studioWeight={studioWeight}
                />
            </Box>
        </Box>
    );
};

export default DiscoverPage;
