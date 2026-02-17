import React, { useEffect, useState, useMemo, useRef } from "react";
import { useHistory } from "react-router-dom";
import Mousetrap from "mousetrap";
import debounce from "lodash-es/debounce";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { Box } from "@mui/material";
import { GlobalSearchResults } from "./GlobalSearchResults";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { QuickSettings } from "./QuickSettings";

export const GlobalSearch: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [activeTab, setActiveTab] = useState<"search" | "settings">("search");
    const [debouncedTerm, setDebouncedTerm] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const history = useHistory();
    const intl = useIntl();

    // Handle opening/closing with hotkey
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            e.preventDefault();
            setIsOpen((prev) => !prev);
        };

        Mousetrap.bind("mod+k", handler);

        return () => {
            Mousetrap.unbind("mod+k");
        };
    }, []);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            // Small timeout to allow render
            setTimeout(() => {
                inputRef.current?.focus();
            }, 50);
        } else {
            setSearchTerm("");
            setDebouncedTerm("");
            setSelectedIndex(0);
        }
    }, [isOpen]);

    // Debounce search term update
    const updateDebouncedTerm = useMemo(
        () =>
            debounce((val: string) => {
                setDebouncedTerm(val);
            }, 300),
        []
    );

    const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        updateDebouncedTerm(e.target.value);
        setSelectedIndex(0); // Reset selection on new search
    };

    // Perform Query
    const { data, loading } = GQL.useGlobalSearchQuery({
        variables: { term: debouncedTerm, per_page: 5 },
        skip: !debouncedTerm || debouncedTerm.length < 2,
        fetchPolicy: "network-only", // Always get fresh results
    });

    const hasResults = useMemo(() => {
        if (!data) return false;
        return (
            (data.scenes?.scenes?.length ?? 0) > 0 ||
            (data.performers?.performers?.length ?? 0) > 0 ||
            (data.images?.images?.length ?? 0) > 0 ||
            (data.galleries?.galleries?.length ?? 0) > 0 ||
            (data.studios?.studios?.length ?? 0) > 0 ||
            (data.tags?.tags?.length ?? 0) > 0
        );
    }, [data]);

    // Calculate total items for keyboard navigation limits
    const totalItems = useMemo(() => {
        if (!data) return 0;
        return (
            (data.scenes?.scenes?.length ?? 0) +
            (data.performers?.performers?.length ?? 0) +
            (data.images?.images?.length ?? 0) +
            (data.galleries?.galleries?.length ?? 0) +
            (data.studios?.studios?.length ?? 0) +
            (data.tags?.tags?.length ?? 0)
        );
    }, [data]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, totalItems - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            // Logic to find the selected item is handled in Results or we need to duplicate logic here.
            // Ideally, the Results component could expose a ref or we do the flattening here.
            // For simplicity, let's trigger a click on the active item in the DOM.
            const activeLink = document.querySelector('[data-search-results] [data-active]') as HTMLElement;
            if (activeLink) {
                activeLink.click();
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            setIsOpen(false);
        }
    };

    const handleClose = (e: React.MouseEvent) => {
        // Close if clicking the backdrop
        if (e.target === e.currentTarget) {
            setIsOpen(false);
        }
    };

    const onSelect = () => {
        setIsOpen(false);
    }

    const handleTabClick = (tab: "search" | "settings") => {
        setActiveTab(tab);
        if (tab === "search") {
            // Re-focus input when switching back to search
            setTimeout(() => {
                inputRef.current?.focus();
            }, 50);
        }
    }

    if (!isOpen) return null;

    const tabSx = (isActive: boolean) => ({
        flex: 1,
        p: '1rem',
        textAlign: 'center',
        cursor: 'pointer',
        fontWeight: 500,
        color: isActive ? 'white' : 'rgba(255, 255, 255, 0.5)',
        transition: 'all 0.2s',
        borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent',
        background: isActive ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
        '&:hover': {
            color: 'rgba(255, 255, 255, 0.8)',
            background: 'rgba(255, 255, 255, 0.05)',
        },
    });

    return (
        <Box
            sx={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                background: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(12px)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                pt: '5vh',
                animation: 'fadeIn 0.15s ease-out',
                '@keyframes fadeIn': {
                    from: { opacity: 0, transform: 'scale(0.99)' },
                    to: { opacity: 1, transform: 'scale(1)' },
                },
                '& .modal-content': {
                    background: 'transparent',
                    border: 'none',
                    boxShadow: 'none',
                },
            }}
            onMouseDown={handleClose}
        >
            <Box
                sx={{
                    background: 'rgba(30, 30, 40, 0.95)',
                    width: '90vw',
                    maxWidth: 1000,
                    height: '85vh',
                    borderRadius: '12px',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                        background: 'rgba(0, 0, 0, 0.2)',
                    }}
                >
                    <Box
                        sx={tabSx(activeTab === "search")}
                        onClick={() => handleTabClick("search")}
                    >
                        <FormattedMessage id="search" defaultMessage="Search" />
                    </Box>
                    <Box
                        sx={tabSx(activeTab === "settings")}
                        onClick={() => handleTabClick("settings")}
                    >
                        <FormattedMessage id="settings" defaultMessage="Quick Settings" />
                    </Box>
                </Box>

                {activeTab === "search" ? (
                    <>
                        <Box
                            sx={{
                                p: '1.5rem',
                                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                flexShrink: 0,
                                '& svg': {
                                    color: '#999',
                                    width: 24,
                                    height: 24,
                                },
                            }}
                        >
                            <FontAwesomeIcon icon={faSearch} />
                            <Box
                                component="input"
                                ref={inputRef}
                                type="text"
                                sx={{
                                    background: 'transparent',
                                    border: 'none',
                                    width: '100%',
                                    fontSize: '1.5rem',
                                    color: 'white',
                                    outline: 'none',
                                    fontWeight: 300,
                                    '&::placeholder': {
                                        color: 'rgba(255, 255, 255, 0.3)',
                                    },
                                }}
                                placeholder={intl.formatMessage({ id: "search", defaultMessage: "Search..." })}
                                value={searchTerm}
                                onChange={handleInput}
                                onKeyDown={handleKeyDown}
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                        </Box>
                        {debouncedTerm.length >= 2 && data ? (
                            <GlobalSearchResults
                                data={data}
                                selectedIndex={selectedIndex}
                                setSelectedIndex={setSelectedIndex}
                                onSelect={onSelect}
                            />
                        ) : null}
                    </>
                ) : (
                    <QuickSettings onClose={() => setIsOpen(false)} />
                )}
            </Box>
        </Box>
    );
};
