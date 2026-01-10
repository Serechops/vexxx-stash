import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { FilterMode } from "src/core/generated-graphql";

interface ZoomContextType {
    getZoom: (mode: FilterMode) => number;
    setZoom: (mode: FilterMode, zoomIndex: number) => void;
}

const defaultZoom = 1;

const ZoomContext = createContext<ZoomContextType>({
    getZoom: () => defaultZoom,
    setZoom: () => { },
});

interface ZoomProviderProps {
    children: ReactNode;
}

export const ZoomProvider: React.FC<ZoomProviderProps> = ({ children }) => {
    const [zoomState, setZoomState] = useState<Record<string, number>>({});

    const getZoom = useCallback((mode: FilterMode): number => {
        return zoomState[mode] ?? defaultZoom;
    }, [zoomState]);

    const setZoom = useCallback((mode: FilterMode, zoomIndex: number) => {
        setZoomState(prev => {
            if (prev[mode] === zoomIndex) return prev;
            return { ...prev, [mode]: zoomIndex };
        });
    }, []);

    return (
        <ZoomContext.Provider value={{ getZoom, setZoom }}>
            {children}
        </ZoomContext.Provider>
    );
};

export const useZoomContext = () => useContext(ZoomContext);
