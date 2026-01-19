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
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Helmet>
                <title>Discover</title>
            </Helmet>

            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" component="h1" className="text-primary font-bold">
                    <FormattedMessage id="discover" defaultMessage="Discover" />
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

            <Grid container spacing={4}>
                {/* Left Column: Content Profile */}
                <Grid size={{ xs: 12, md: 4, lg: 3 }}>
                    <Box sx={{ position: 'sticky', top: 20 }}>
                        <ContentProfileCard />

                        {/* Tuning Controls */}
                        <Card sx={{ mt: 3 }}>
                            <CardHeader title="Tuning" />
                            <CardContent>
                                <Box mb={2}>
                                    <Typography gutterBottom>Tags: {(tagWeight * 100).toFixed(0)}%</Typography>
                                    <Slider
                                        value={tagWeight}
                                        onChange={(_, v) => setTagWeight(v as number)}
                                        step={0.1}
                                        min={0}
                                        max={1}
                                        marks
                                    />
                                </Box>
                                <Box mb={2}>
                                    <Typography gutterBottom>Performers: {(performerWeight * 100).toFixed(0)}%</Typography>
                                    <Slider
                                        value={performerWeight}
                                        onChange={(_, v) => setPerformerWeight(v as number)}
                                        step={0.1}
                                        min={0}
                                        max={1}
                                        marks
                                    />
                                </Box>
                                <Box>
                                    <Typography gutterBottom>Studio: {(studioWeight * 100).toFixed(0)}%</Typography>
                                    <Slider
                                        value={studioWeight}
                                        onChange={(_, v) => setStudioWeight(v as number)}
                                        step={0.1}
                                        min={0}
                                        max={1}
                                        marks
                                    />
                                </Box>
                            </CardContent>
                        </Card>
                    </Box>
                </Grid>

                {/* Right Column: Recommendations */}
                <Grid size={{ xs: 12, md: 8, lg: 9 }}>

                    {/* Top Performers (StashDB) */}
                    <PerformerRecommendationRow
                        title="Top Performers (StashDB)"
                        source={RecommendationSource.Stashdb}
                        limit={20}
                        tagWeight={tagWeight}
                        performerWeight={performerWeight}
                        studioWeight={studioWeight}
                    />

                    {/* StashDB Scenes */}
                    <RecommendationCarousel
                        title="Recommended Scenes (StashDB)"
                        source={RecommendationSource.Stashdb}
                        limit={40}
                        excludeOwned={true}
                        tagWeight={tagWeight}
                        performerWeight={performerWeight}
                        studioWeight={studioWeight}
                    />

                    {/* Local Gems: Performers */}
                    <PerformerRecommendationRow
                        title="Local Performers (Rediscover Your Collection)"
                        limit={20}
                        source={RecommendationSource.Local}
                        tagWeight={tagWeight}
                        performerWeight={performerWeight}
                        studioWeight={studioWeight}
                    />

                    {/* Local Gems: Scenes */}
                    <RecommendationCarousel
                        title="Local Scenes (Rediscover)"
                        source={RecommendationSource.Local}
                        limit={40}
                        excludeOwned={false}
                        tagWeight={tagWeight}
                        performerWeight={performerWeight}
                        studioWeight={studioWeight}
                    />

                </Grid>
            </Grid>
        </Container>
    );
};

export default DiscoverPage;
