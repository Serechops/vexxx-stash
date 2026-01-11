import React, { useEffect, useState, useMemo, useRef } from "react";
import { useHistory } from "react-router-dom";
import Mousetrap from "mousetrap";
import debounce from "lodash-es/debounce";
import { useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { GlobalSearchResults } from "./GlobalSearchResults";
import styles from "./GlobalSearch.module.scss";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch } from "@fortawesome/free-solid-svg-icons";

export const GlobalSearch: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
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
            const activeLink = document.querySelector(`.${styles.results} .${styles.active}`) as HTMLElement;
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

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onMouseDown={handleClose}>
            <div className={styles.container}>
                <div className={styles.inputWrapper}>
                    <FontAwesomeIcon icon={faSearch} />
                    <input
                        ref={inputRef}
                        type="text"
                        className={styles.input}
                        placeholder={intl.formatMessage({ id: "search", defaultMessage: "Search..." })}
                        value={searchTerm}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck="false"
                    />
                </div>
                {debouncedTerm.length >= 2 && data ? (
                    <GlobalSearchResults
                        data={data}
                        selectedIndex={selectedIndex}
                        setSelectedIndex={setSelectedIndex}
                        onSelect={onSelect}
                    />
                ) : null}
            </div>
        </div>
    );
};
