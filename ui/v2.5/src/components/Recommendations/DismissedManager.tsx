import React, { useState } from 'react';
import {
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    List,
    ListItem,
    ListItemText,
    Tab,
    Tabs,
    Tooltip,
    Typography,
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import {
    useListDismissedRecommendationsQuery,
    useUndismissRecommendationMutation,
} from '../../core/generated-graphql';

interface DismissedManagerProps {
    open: boolean;
    onClose: () => void;
}

function DismissedList({ entityType }: { entityType: string }) {
    const { data, loading, refetch } = useListDismissedRecommendationsQuery({
        variables: { entity_type: entityType },
        fetchPolicy: 'network-only',
    });

    const [undismiss] = useUndismissRecommendationMutation();

    const handleUndo = async (entityKey: string) => {
        await undismiss({ variables: { entity_type: entityType, entity_key: entityKey } }).catch(() => {});
        refetch();
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" py={4}>
                <CircularProgress size={24} />
            </Box>
        );
    }

    const items = data?.listDismissedRecommendations ?? [];

    if (items.length === 0) {
        return (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                No dismissed {entityType}s.
            </Typography>
        );
    }

    return (
        <List dense disablePadding>
            {items.map((item) => {
                const dismissedDate = new Date(item.dismissed_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                });
                // Display the key without the internal prefix (local:123 → 123, stashdb:xxx → xxx)
                const displayKey = item.entity_key.replace(/^(local:|stashdb:)/, '');
                const source = item.entity_key.startsWith('stashdb:') ? 'StashDB' : 'Local';

                return (
                    <ListItem
                        key={item.entity_key}
                        secondaryAction={
                            <Tooltip title="Restore this item">
                                <IconButton
                                    edge="end"
                                    size="small"
                                    onClick={() => handleUndo(item.entity_key)}
                                >
                                    <UndoIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        }
                    >
                        <ListItemText
                            primary={
                                <Typography variant="body2" noWrap>
                                    {source}: {displayKey}
                                </Typography>
                            }
                            secondary={`Dismissed ${dismissedDate}`}
                        />
                    </ListItem>
                );
            })}
        </List>
    );
}

export const DismissedManager: React.FC<DismissedManagerProps> = ({ open, onClose }) => {
    const [tab, setTab] = useState(0);
    const entityType = tab === 0 ? 'scene' : 'performer';

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Manage Dismissed Recommendations</DialogTitle>
            <DialogContent dividers sx={{ p: 0 }}>
                <Tabs
                    value={tab}
                    onChange={(_, v) => setTab(v)}
                    sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
                >
                    <Tab label="Scenes" />
                    <Tab label="Performers" />
                </Tabs>
                <Box sx={{ maxHeight: 400, overflowY: 'auto', px: 2, py: 1 }}>
                    <DismissedList key={entityType} entityType={entityType} />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};
